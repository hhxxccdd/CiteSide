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
  if (page.completeness !== "full" || page.text.length > 30_000) {
    throw new BadRequestException("需要完整网页正文；当前仅支持不超过 30,000 字符的文章");
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
