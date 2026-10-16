export interface CreateKnowledgeInput {
  title: string;
  content: string;
  originalQuestion: string;
  sourceTitle: string;
  sourceUrl: string;
}

export async function createKnowledgeEntry(
  input: CreateKnowledgeInput,
): Promise<string> {
  const response = await fetch("http://127.0.0.1:3000/api/knowledge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(response.status >= 500
      ? "保存失败，请检查本地服务和向量模型配置后重试。"
      : "笔记内容或来源不完整，请检查后重试。",
    );
  }

  const result: unknown = await response.json();
  if (!result || typeof result !== "object" ||
      !("id" in result) || typeof result.id !== "string") {
    throw new Error("保存结果格式不正确，请检查知识库后再尝试保存。");
  }
  return result.id;
}
