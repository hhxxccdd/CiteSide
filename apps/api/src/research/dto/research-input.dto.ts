import { BadRequestException } from "@nestjs/common";
import type { CurrentPageContext } from "../tools/read-current-context.tool";

export interface ResearchInput {
  question: string;
  context: CurrentPageContext;
}

// 当前是单篇全文接口；@ 多资料接入时再迁移为 materials 列表。
export function parseResearchInput(value: unknown): ResearchInput {
  if (!value || typeof value !== "object") throw new BadRequestException("提问格式不正确");
  const input = value as Record<string, unknown>;
  if (typeof input.question !== "string" || !input.question.trim() || input.question.length > 4000) {
    throw new BadRequestException("问题不能为空，且不能超过 4,000 字符");
  }
  if (!input.context || typeof input.context !== "object") {
    throw new BadRequestException("尚未取得网页正文，请重新读取");
  }
  const page = input.context as Record<string, unknown>;
  if (typeof page.title !== "string" || !page.title.trim() || page.title.length > 2000 ||
      typeof page.url !== "string" || page.url.length > 8000 ||
      typeof page.text !== "string" || !page.text.trim()) {
    throw new BadRequestException("网页标题、网址或正文不正确，请重新读取");
  }
  if (page.completeness !== "full") {
    throw new BadRequestException("网页正文尚未完整读取，请重新读取");
  }
  if (Buffer.byteLength(page.text, "utf8") > 8 * 1024 * 1024) {
    throw new BadRequestException("网页正文超过单次 8 MiB 的传输容量，暂时无法提交；这与模型上下文容量是不同的限制");
  }
  try {
    if (!["http:", "https:"].includes(new URL(page.url).protocol)) throw new Error();
  } catch {
    throw new BadRequestException("只支持普通 HTTP/HTTPS 网页");
  }
  if (typeof page.capturedAt !== "string" || !Number.isFinite(Date.parse(page.capturedAt))) {
    throw new BadRequestException("网页读取时间不正确，请重新读取");
  }
  return {
    question: input.question.trim(),
    context: { title: page.title.trim(), url: page.url, text: page.text,
      completeness: "full", capturedAt: page.capturedAt },
  };
}
