export interface ResearchContext {
  title: string;
  url: string;
  text: string;
  truncated: boolean;
}

export interface ResearchResult {
  answer: string;
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

export async function runResearch(
  question: string,
  context: ResearchContext,
  signal: AbortSignal,
): Promise<ResearchResult> {
  const response = await fetch("http://127.0.0.1:3000/api/research/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, context }),
    signal,
  });

  if (!response.ok) {
    throw new Error(
      response.status >= 500
        ? "本地服务处理失败，请检查后端是否正常运行。"
        : "提问内容未通过检查，请重新选择网页文字后重试。",
    );
  }

  const result: unknown = await response.json();
  if (!result || typeof result !== "object" ||
      !("answer" in result) || typeof result.answer !== "string") {
    throw new Error("本地服务返回的回答格式不正确。请重试。");
  }

  return result as ResearchResult;
}
