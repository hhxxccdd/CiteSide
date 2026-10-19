import MarkdownIt = require("markdown-it");
import type { QwenMessage } from "../llm/qwen.client";

const markdown = new MarkdownIt();
export const INSUFFICIENT_EVIDENCE_ANSWER = "本次没有取得足以支持结论的资料，无法可靠回答这个问题。不会把尚未执行的搜索当成已经完成，也不会编造统计数据。";

// 识别常见的“要用工具却只输出了执行指令”，不把代码块、引用或正常正文中的工具介绍当成请求。
export function isPendingToolRequest(content: string | null | undefined): boolean {
  const first = markdown.parse(content ?? "", {}).find((token) => token.type === "inline" && token.level === 1);
  const text = first?.children?.map((token) => token.type === "text" || token.type === "code_inline" ? token.content : " ").join("").trim() ?? "";
  return /^(?:(?:是的|好的)[，,。！!]?\s*)?(?:需要(?:你)?(?:立即)?(?:执行|进行|调用)|我(?:将|会|需要)(?:立即)?(?:执行|进行|调用)|请(?:你)?(?:先|立即)?(?:使用|调用|执行|进行))[\s\S]{0,180}(?:web_search|read_web_page|联网搜索|网络搜索|该搜索|搜索工具|阅读网页)/i.test(text);
}

export function finalAnswerMessages(messages: QwenMessage[]): QwenMessage[] {
  return [...messages, { role: "system", content:
    "本次工具选择与执行阶段已经结束，现在只输出给用户的最终回答。" +
    "只能使用已提交的正文、笔记和实际工具结果；不能再请求调用工具、要求用户替你执行搜索，或把执行计划当作答案。" +
    "未取得可靠的最新数据或统计比例时，明确说明无法确认；不能声称未执行的检索已经完成，也不编造精确数字。",
  }];
}
