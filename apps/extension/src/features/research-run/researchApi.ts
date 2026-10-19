export interface ResearchContext {
  title: string;
  url: string;
  text: string;
  completeness: "full";
  capturedAt: string;
}

export interface ResearchResult {
  runId: string;
  options: ResearchOptions;
  specifiedNotes?: Array<{ id: string; title: string; content: string; sourceTitle: string; sourceUrl: string }>;
  answer: string;
  sources: ResearchSource[];
  retrievedNotes: Array<{
    id: string;
    title: string;
    content: string;
    sourceTitle: string;
    sourceUrl: string;
    similarity: number;
  }>;
  knowledgeSearchFailed: boolean;
  webSources: Array<{ title: string; url: string }>;
  webSearchFailed: boolean;
  readPage: { title: string; url: string; text: string } | null;
  webPageReadFailed: boolean;
}

export interface ResearchSource {
  id: string;
  kind: "page" | "note" | "web";
  title: string;
  url: string;
  excerpt: string;
  evidence: "note" | "search-result" | "page-text";
  noteId?: string;
}

export interface ResearchOptions {
  searchKnowledgeBase: boolean;
  allowWebSearch: boolean;
}

export interface ResearchMaterials { pages: ResearchContext[]; noteIds: string[] }

export async function runResearch(
  question: string,
  materials: ResearchMaterials,
  options: ResearchOptions,
  signal: AbortSignal,
): Promise<ResearchResult> {
  const response = await fetch("http://127.0.0.1:3000/api/research/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, materials, options }),
    signal,
  });

  if (!response.ok) {
    const details: unknown = await response.json().catch(() => null);
    const message = details && typeof details === "object" && "message" in details &&
      typeof details.message === "string" ? details.message : null;
    throw new Error(
      message ?? (response.status >= 500
        ? "本地服务处理失败，请检查后端是否正常运行。"
        : "问题或网页正文未通过检查，请重新读取网页后重试。"),
    );
  }

  const result: unknown = await response.json();
  if (!result || typeof result !== "object" ||
      !("answer" in result) || typeof result.answer !== "string") {
    throw new Error("本地服务返回的回答格式不正确。请重试。");
  }

  return { ...result, sources: "sources" in result && Array.isArray(result.sources) ? result.sources : [] } as ResearchResult;
}
