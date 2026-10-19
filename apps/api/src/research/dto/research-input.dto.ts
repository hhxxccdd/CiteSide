import { BadRequestException } from "@nestjs/common";
import type { CurrentPageContext } from "../tools/read-current-context.tool";

export interface ResearchOptions { searchKnowledgeBase: boolean; allowWebSearch: boolean }
export interface ResearchInput {
  question: string;
  materials: { pages: CurrentPageContext[]; noteIds: string[] };
  options: ResearchOptions;
}

function parsePage(value: unknown): CurrentPageContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("网页正文格式不正确");
  const page = value as Record<string, unknown>;
  if (typeof page.title !== "string" || !page.title.trim() || page.title.length > 2000 ||
      typeof page.url !== "string" || page.url.length > 8000 ||
      typeof page.text !== "string" || !page.text.trim()) {
    throw new BadRequestException("网页标题、网址或正文不正确，请重新读取");
  }
  if (page.completeness !== "full") throw new BadRequestException("网页正文尚未完整读取，请重新读取");
  try {
    if (!["http:", "https:"].includes(new URL(page.url).protocol)) throw new Error();
  } catch { throw new BadRequestException("只支持普通 HTTP/HTTPS 网页"); }
  if (typeof page.capturedAt !== "string" || !Number.isFinite(Date.parse(page.capturedAt))) {
    throw new BadRequestException("网页读取时间不正确，请重新读取");
  }
  return { title: page.title.trim(), url: page.url, text: page.text, completeness: "full", capturedAt: page.capturedAt };
}

export function parseResearchInput(value: unknown): ResearchInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("提问格式不正确");
  const input = value as Record<string, unknown>;
  if (typeof input.question !== "string" || !input.question.trim() || input.question.length > 4000) {
    throw new BadRequestException("问题不能为空，且不能超过 4,000 字符");
  }
  const options: ResearchOptions = { searchKnowledgeBase: true, allowWebSearch: false };
  if (input.options !== undefined) {
    if (!input.options || typeof input.options !== "object" || Array.isArray(input.options)) throw new BadRequestException("资料范围格式不正确");
    const scope = input.options as Record<string, unknown>;
    if (typeof scope.searchKnowledgeBase !== "boolean" || typeof scope.allowWebSearch !== "boolean") throw new BadRequestException("知识库和联网开关必须是布尔值");
    options.searchKnowledgeBase = scope.searchKnowledgeBase;
    options.allowWebSearch = scope.allowWebSearch;
  }
  let pages: CurrentPageContext[];
  let noteIds: string[] = [];
  if (input.materials !== undefined) {
    if (input.context !== undefined) throw new BadRequestException("materials 与旧版 context 不能同时提供");
    if (!input.materials || typeof input.materials !== "object" || Array.isArray(input.materials)) throw new BadRequestException("指定资料格式不正确");
    const materials = input.materials as Record<string, unknown>;
    if (!Array.isArray(materials.pages) || materials.pages.length > 3 || !Array.isArray(materials.noteIds) || materials.noteIds.length > 3) {
      throw new BadRequestException("最多提供 3 篇网页和 3 条指定笔记");
    }
    pages = materials.pages.map(parsePage);
    if (!materials.noteIds.every((id: unknown) => typeof id === "string" && /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n)) {
      throw new BadRequestException("指定笔记 ID 不正确");
    }
    noteIds = [...new Set(materials.noteIds as string[])];
  } else {
    // 兼容此前的 Apifox 单篇请求。
    pages = input.context == null ? [] : [parsePage(input.context)];
  }
  const uniquePages = new Map<string, CurrentPageContext>();
  for (const page of pages) { const url = new URL(page.url); url.hash = ""; if (!uniquePages.has(url.href)) uniquePages.set(url.href, page); }
  pages = [...uniquePages.values()];
  if (pages.reduce((size, page) => size + Buffer.byteLength(page.text, "utf8"), 0) > 8 * 1024 * 1024) {
    throw new BadRequestException("网页正文合计超过单次 8 MiB 传输容量");
  }
  if (!pages.length && !noteIds.length && !options.searchKnowledgeBase && !options.allowWebSearch) throw new BadRequestException("请添加资料，或开启知识库搜索、联网中的至少一项");
  return { question: input.question.trim(), materials: { pages, noteIds }, options };
}
