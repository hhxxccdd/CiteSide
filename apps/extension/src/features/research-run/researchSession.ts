import type { PageSelection } from "../page-context/useSelectionPreview";
import type { ResearchResult } from "./researchApi";

export interface CompletedResearch {
  question: string;
  context: PageSelection;
  result: ResearchResult;
}

async function sessionKey(): Promise<string> {
  const window = await chrome.windows.getCurrent();
  if (window.id === undefined) throw new Error("无法确定当前浏览器窗口");
  return `completedResearch:${window.id}`;
}

export async function loadCompletedResearch(): Promise<CompletedResearch | null> {
  const key = await sessionKey();
  const saved = (await chrome.storage.session.get(key))[key] as CompletedResearch | undefined;
  if (!saved || typeof saved.question !== "string" ||
      typeof saved.context?.text !== "string" || typeof saved.context?.url !== "string" ||
      typeof saved.result?.answer !== "string") return null;
  return saved;
}

export async function saveCompletedResearch(value: CompletedResearch): Promise<void> {
  await chrome.storage.session.set({ [await sessionKey()]: value });
}
