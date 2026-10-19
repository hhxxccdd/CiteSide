import { Injectable, Logger } from "@nestjs/common";
import MarkdownIt = require("markdown-it");
import { QwenClient, type QwenMessage } from "../llm/qwen.client";
import type { ResearchSource } from "./research-sources";
import { INSUFFICIENT_EVIDENCE_ANSWER, isPendingToolRequest } from "./research-answer-policy";

@Injectable()
export class ResearchCitationsService {
  private readonly logger = new Logger(ResearchCitationsService.name);
  private readonly markdown = new MarkdownIt({ html: false });

  constructor(private readonly qwen: QwenClient) {}

  async ensureCitations(answer: string, messages: QwenMessage[], sources: ResearchSource[]): Promise<string> {
    const fallback = isPendingToolRequest(answer) ? INSUFFICIENT_EVIDENCE_ANSWER : answer;
    if (!sources.length || this.hasCitation(answer, sources)) return fallback;

    // 只尝试一次；缺少标记不等于可以把任意资料硬接到原回答上。
    try {
      const revised = await this.qwen.chat([
        ...messages,
        { role: "assistant", content: answer },
        { role: "system", content:
          "上一份回答没有可识别的正文引用。请依据前文实际取得的正文、笔记和工具结果重新整理回答。" +
          "当前只是引用整理阶段，工具执行已经结束。不能要求再搜索、调用工具或让用户替你执行搜索。" +
          "核心事实使用自然文字引用，格式必须为 [有来源支持的结论][sourceId]，例如 [类型收窄][S1]，不能只写来源编号。" +
          "不要仅为满足格式把来源硬贴到旧句子上；找不到支持的统计数字、百分比、薪资或具体招聘结论，应删除并说明无法确认。" +
          "只读取到了文章或搜索摘要，不代表核实了行业统计；不能声称全部结论已经核实。" +
          "不要编造引用、网址、报告名称或权威性。搜索结果未读原文时明确说明只取得摘要。" +
          "如果现有资料都不能支持问题，就直接说明资料不足，无需强行引用。只输出最终回答。" +
          "可用来源标识及阅读状态：" + JSON.stringify(sources.map(({ id, title, evidence }) => ({ sourceId: id, title, evidence }))),
        },
      ]);
      if (revised.trim() && !isPendingToolRequest(revised)) return revised;
    } catch {
      this.logger.warn("回答引用整理未完成，保留原回答，由界面提示缺少正文引用");
    }
    return fallback;
  }

  private hasCitation(answer: string, sources: ResearchSource[]): boolean {
    const ids = new Set(sources.map((source) => source.id).filter((id) => /^[SNW][1-9]\d*$/.test(id)));
    // 这里只解析 Markdown，不请求这些地址。先提供受信任定义，忽略代码块里的示例标记。
    const definitions = [...ids].map((id) => `[${id}]: <https://researchflow.invalid/citation/${id}> "rf-source:${id}"`).join("\n");
    return this.markdown.parse(`${definitions}\n\n${answer}`, {}).some((block) =>
      block.children?.some((token) => {
        const id = String(token.attrGet("title") ?? "").replace(/^rf-source:/, "");
        return token.type === "link_open" && ids.has(id) && token.attrGet("href") === `https://researchflow.invalid/citation/${id}`;
      }));
  }
}
