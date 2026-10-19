import type { PageSnapshot } from "../page-context/pageContext.types";
import type { ResearchOptions, ResearchResult } from "./researchApi";

export interface CompletedResearch {
  question: string;
  pages: PageSnapshot[];
  usedCurrentPage: boolean;
  options?: ResearchOptions;
  result: ResearchResult;
}

async function keys(): Promise<{ current: string; legacy: string }> {
  const window = await chrome.windows.getCurrent();
  if (window.id === undefined) throw new Error("无法确定当前浏览器窗口");
  return { current: `completedResearch:v3:${window.id}`, legacy: `completedPageResearch:v2:${window.id}` };
}

export async function loadCompletedResearch(): Promise<CompletedResearch | null> {
  const key = await keys();
  const values = await chrome.storage.session.get([key.current, key.legacy]);
  const saved = (values[key.current] ?? values[key.legacy]) as CompletedResearch & { context?: PageSnapshot | null } | undefined;
  if (!saved || typeof saved.question !== "string" || typeof saved.result?.answer !== "string") return null;
  if (saved.context && typeof saved.context.text !== "string") return null;
  const pages = Array.isArray(saved.pages) ? saved.pages : saved.context ? [{ ...saved.context,
    id: crypto.randomUUID(), tabId: -1, totalCharacters: saved.context.text.length, extraction: "article" as const }] : [];
  if (!pages.every((page) => page && typeof page.text === "string" && typeof page.url === "string" && page.completeness === "full")) return null;
  if (saved.options && (typeof saved.options.searchKnowledgeBase !== "boolean" || typeof saved.options.allowWebSearch !== "boolean")) return null;
  return { question: saved.question, pages, usedCurrentPage: saved.usedCurrentPage ?? Boolean(saved.context), options: saved.options, result: saved.result };
}

export async function saveCompletedResearch(value: CompletedResearch): Promise<void> {
  await chrome.storage.session.set({ [(await keys()).current]: value });
}
