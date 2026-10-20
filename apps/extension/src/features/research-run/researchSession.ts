import type { PageSnapshot } from "../page-context/pageContext.types";
import type { ResearchOptions, ResearchResult } from "./researchApi";
import type { ResearchMaterial } from "../research-materials/material.types";
import type { KnowledgeDraft } from "../knowledge-base/knowledgeDraft.types";

export interface CompletedResearch {
  question: string;
  pages: PageSnapshot[];
  usedCurrentPage: boolean;
  options?: ResearchOptions;
  result: ResearchResult;
}

export interface ResearchDraft {
  question: string;
  useCurrentPage: boolean;
  options: ResearchOptions;
  materials: ResearchMaterial[];
}

export interface ResearchAttempt {
  question: string;
  pages: PageSnapshot[];
  noteIds: string[];
  usedCurrentPage: boolean;
  options: ResearchOptions;
}

export interface ResearchWorkspace {
  draft: ResearchDraft | null;
  completed: CompletedResearch | null;
  noteDraft: { runId: string; value: KnowledgeDraft } | null;
  unfinishedRun: boolean;
  attempt?: ResearchAttempt | null;
  attemptStatus?: "stopped" | "failed" | null;
}

type StoredMaterial = Exclude<ResearchMaterial, { kind: "page" }> |
  (Omit<Extract<ResearchMaterial, { kind: "page" }>, "snapshot"> & { snapshot: number | null });
interface StoredWorkspace {
  version: 1;
  snapshots: PageSnapshot[];
  draft: (Omit<ResearchDraft, "materials"> & { materials: StoredMaterial[] }) | null;
  completed: (Omit<CompletedResearch, "pages"> & { pages: number[] }) | null;
  noteDraft: ResearchWorkspace["noteDraft"];
  unfinishedRun: boolean;
  attempt?: (Omit<ResearchAttempt, "pages"> & { pages: number[] }) | null;
  attemptStatus?: "stopped" | "failed" | null;
}

async function keys() {
  const window = await chrome.windows.getCurrent();
  if (window.id === undefined) throw new Error("无法确定当前浏览器窗口");
  return { workspace: `researchWorkspace:v1:${window.id}`, current: `completedResearch:v3:${window.id}`, legacy: `completedPageResearch:v2:${window.id}` };
}

function isPage(value: unknown): value is PageSnapshot {
  if (!value || typeof value !== "object") return false;
  const page = value as PageSnapshot;
  return typeof page.id === "string" && Number.isInteger(page.tabId) && typeof page.title === "string" &&
    typeof page.text === "string" && typeof page.url === "string" && /^https?:\/\//.test(page.url) &&
    typeof page.capturedAt === "string" && page.completeness === "full";
}

function validOptions(value: ResearchOptions | undefined): boolean {
  return Boolean(value && typeof value.searchKnowledgeBase === "boolean" && typeof value.allowWebSearch === "boolean");
}

function decode(value: StoredWorkspace): ResearchWorkspace {
  if (value?.version !== 1 || !Array.isArray(value.snapshots) || !value.snapshots.every(isPage)) throw new Error("草稿格式不正确");
  const pageAt = (index: number) => {
    if (!Number.isInteger(index) || !value.snapshots[index]) throw new Error("草稿正文缺失");
    return value.snapshots[index];
  };
  const draft = value.draft;
  if (draft && (typeof draft.question !== "string" || typeof draft.useCurrentPage !== "boolean" ||
    !validOptions(draft.options) || !Array.isArray(draft.materials))) throw new Error("草稿格式不正确");
  const materials = draft?.materials.map((item): ResearchMaterial => {
    if (!item || typeof item.id !== "string" || typeof item.title !== "string") throw new Error("资料格式不正确");
    if (item.kind === "note" && /^[1-9]\d{0,18}$/.test(item.noteId)) return item;
    if (item.kind !== "page" || !item.page || !Number.isInteger(item.page.tabId) ||
      !/^https?:\/\//.test(item.page.url)) throw new Error("资料格式不正确");
    if (item.state === "reading") return { ...item, snapshot: null, state: "failed", error: "上次读取已中断，请重新读取或移除此资料。" };
    const snapshot = item.snapshot === null ? null : pageAt(item.snapshot);
    if (item.state === "ready" && !snapshot) throw new Error("草稿正文缺失");
    return { ...item, snapshot };
  }) ?? [];
  const completed = value.completed;
  if (completed && (typeof completed.result?.answer !== "string" || typeof completed.question !== "string" ||
    !Array.isArray(completed.pages))) throw new Error("回答格式不正确");
  const note = value.noteDraft;
  if (note && (typeof note.runId !== "string" || !note.value || typeof note.value.editing !== "boolean" ||
    typeof note.value.title !== "string" || typeof note.value.content !== "string" || typeof note.value.savedId !== "string")) throw new Error("笔记草稿格式不正确");
  const attempt = value.attempt;
  if (value.attemptStatus != null && !["stopped", "failed"].includes(value.attemptStatus)) throw new Error("任务状态不正确");
  if (attempt && (typeof attempt.question !== "string" || !Array.isArray(attempt.pages) ||
    !Array.isArray(attempt.noteIds) || !attempt.noteIds.every((id) => typeof id === "string" && /^[1-9]\d{0,18}$/.test(id)) ||
    typeof attempt.usedCurrentPage !== "boolean" || !validOptions(attempt.options))) throw new Error("重试资料格式不正确");
  return { draft: draft ? { ...draft, materials } : null,
    completed: completed ? { ...completed, pages: completed.pages.map(pageAt) } : null,
    noteDraft: note ?? null, unfinishedRun: value.unfinishedRun === true,
    attempt: attempt ? { ...attempt, pages: attempt.pages.map(pageAt) } : null,
    attemptStatus: value.attemptStatus ?? null };
}

// 同一份正文在草稿与完成结果中只保存一次，避免重复占用会话存储容量。
function encode(value: ResearchWorkspace): StoredWorkspace {
  const snapshots: PageSnapshot[] = [];
  const indexes = new Map<string, number>();
  const include = (page: PageSnapshot): number => {
    let index = indexes.get(page.id);
    if (index === undefined) { index = snapshots.length; indexes.set(page.id, index); snapshots.push(page); }
    return index;
  };
  const completed = value.completed ? { ...value.completed, pages: value.completed.pages.map(include) } : null;
  const draft = value.draft ? { ...value.draft, materials: value.draft.materials.map((item): StoredMaterial =>
    item.kind === "note" ? item : { ...item, snapshot: item.snapshot ? include(item.snapshot) : null }) } : null;
  const attempt = value.attempt ? { ...value.attempt, pages: value.attempt.pages.map(include) } : null;
  // 去除 Vue 的响应式代理，并固定本次写入的数据，后续修改不能改变排队中的旧写入。
  return JSON.parse(JSON.stringify({ version: 1, snapshots, completed, draft, attempt, attemptStatus: value.attemptStatus,
    noteDraft: value.noteDraft, unfinishedRun: value.unfinishedRun }));
}

export async function loadResearchWorkspace(): Promise<ResearchWorkspace | null> {
  const key = await keys();
  const values = await chrome.storage.session.get([key.workspace, key.current, key.legacy]);
  if (values[key.workspace] !== undefined) return decode(values[key.workspace] as StoredWorkspace);
  const saved = (values[key.current] ?? values[key.legacy]) as CompletedResearch & { context?: PageSnapshot | null } | undefined;
  if (!saved || typeof saved.question !== "string" || typeof saved.result?.answer !== "string") return null;
  if (saved.context && typeof saved.context.text !== "string") return null;
  const pages = Array.isArray(saved.pages) ? saved.pages : saved.context ? [{ ...saved.context,
    id: crypto.randomUUID(), tabId: -1, totalCharacters: saved.context.text.length, extraction: "article" as const }] : [];
  if (!pages.every((page) => page && typeof page.text === "string" && typeof page.url === "string" && page.completeness === "full")) return null;
  if (saved.options && (typeof saved.options.searchKnowledgeBase !== "boolean" || typeof saved.options.allowWebSearch !== "boolean")) return null;
  return { draft: null, noteDraft: null, unfinishedRun: false, completed: {
    question: saved.question, pages, usedCurrentPage: saved.usedCurrentPage ?? Boolean(saved.context), options: saved.options,
    result: { ...saved.result, runId: saved.result.runId || crypto.randomUUID() },
  } };
}

let writes: Promise<unknown> = Promise.resolve();
export function saveResearchWorkspace(value: ResearchWorkspace): Promise<void> {
  const encoded = encode(value);
  const next = writes.then(async () => {
    const key = await keys();
    await chrome.storage.session.set({ [key.workspace]: encoded });
    // 新格式写入成功后才清理旧格式；写入失败时旧回答仍可恢复。
    await chrome.storage.session.remove([key.current, key.legacy]);
  });
  writes = next.catch(() => undefined);
  return next;
}
