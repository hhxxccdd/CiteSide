import type { ResearchContext, ResearchResult } from "./researchApi";

export interface CompletedResearch {
  question: string;
  context: ResearchContext;
  result: ResearchResult;
}

async function sessionKey(): Promise<string> {
  const window = await chrome.windows.getCurrent();
  if (window.id === undefined) throw new Error("无法确定当前浏览器窗口");
  return `completedPageResearch:v2:${window.id}`;
}

export async function loadCompletedResearch(): Promise<CompletedResearch | null> {
  const key = await sessionKey();
  const saved = (await chrome.storage.session.get(key))[key] as CompletedResearch | undefined;
  if (!saved || typeof saved.question !== "string" ||
      typeof saved.context?.text !== "string" || typeof saved.context?.url !== "string" ||
      saved.context.completeness !== "full" || typeof saved.context.capturedAt !== "string" ||
      typeof saved.result?.answer !== "string") return null;
  return saved;
}

export async function saveCompletedResearch(value: CompletedResearch): Promise<void> {
  await chrome.storage.session.set({ [await sessionKey()]: value });
}
