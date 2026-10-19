export interface CreateKnowledgeInput {
  title: string;
  content: string;
  originalQuestion: string;
  sourceTitle: string;
  sourceUrl: string;
}

export interface KnowledgeEntry extends CreateKnowledgeInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

async function readResponse<T>(response: Response, action: string): Promise<T> {
  if (!response.ok) {
    throw new Error(response.status === 404
      ? "这条笔记已经不存在，请刷新列表。"
      : `${action}失败，请检查本地服务后重试。`);
  }
  return response.json() as Promise<T>;
}

async function fetchKnowledge(url: string, options?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...options, signal: options?.signal ?? AbortSignal.timeout(90_000) });
  } catch (cause) {
    if (options?.signal?.aborted) throw cause;
    throw new Error("无法连接本地知识库服务，请确认后端已启动，再点击重试。");
  }
}

export async function listKnowledgeEntries(filter = ""): Promise<KnowledgeEntry[]> {
  const params = new URLSearchParams();
  if (filter.trim()) params.set("q", filter.trim());
  const query = params.toString();
  const response = await fetchKnowledge(
    `http://127.0.0.1:3000/api/knowledge${query ? `?${query}` : ""}`,
  );
  return readResponse<KnowledgeEntry[]>(response, "读取笔记");
}

export async function getKnowledgeEntry(id: string): Promise<KnowledgeEntry> {
  const response = await fetchKnowledge(`http://127.0.0.1:3000/api/knowledge/${encodeURIComponent(id)}`);
  return readResponse<KnowledgeEntry>(response, "读取笔记");
}

export async function updateKnowledgeEntry(
  id: string,
  input: { title: string; content: string },
): Promise<KnowledgeEntry> {
  const response = await fetchKnowledge(`http://127.0.0.1:3000/api/knowledge/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readResponse<KnowledgeEntry>(response, "修改笔记");
}

export async function deleteKnowledgeEntry(id: string): Promise<void> {
  const response = await fetchKnowledge(`http://127.0.0.1:3000/api/knowledge/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await readResponse<{ deleted: true }>(response, "删除笔记");
}

export async function createKnowledgeEntry(
  input: CreateKnowledgeInput,
): Promise<string> {
  const response = await fetchKnowledge("http://127.0.0.1:3000/api/knowledge", {
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
