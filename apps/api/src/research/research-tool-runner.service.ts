import { Injectable, Logger } from "@nestjs/common";
import {
  QwenAssistantMessage,
  QwenClient,
  QwenMessage,
  QwenToolCall,
  QwenToolDefinition,
} from "../llm/qwen.client";
import {
  WEB_SEARCH_DEFINITION,
  WebSearchResult,
  WebSearchSource,
  WebSearchTool,
} from "./tools/web-search.tool";
import {
  READ_WEB_PAGE_DEFINITION,
  ReadWebPageResult,
  ReadWebPageTool,
} from "./tools/read-web-page.tool";
import { webSourceId } from "./research-sources";
import { finalAnswerMessages, INSUFFICIENT_EVIDENCE_ANSWER, isPendingToolRequest } from "./research-answer-policy";

export interface ToolAnswer {
  answer: string;
  webSources: WebSearchSource[];
  webSearchFailed: boolean;
  readPage: ReadWebPageResult | null;
  webPageReadFailed: boolean;
}

interface WebSearchStep {
  sources: WebSearchSource[];
  failed: boolean;
}

interface PageAnswer {
  answer: string;
  readPage: ReadWebPageResult | null;
  webPageReadFailed: boolean;
}

@Injectable()
export class ResearchToolRunner {
  private readonly logger = new Logger(ResearchToolRunner.name);

  constructor(
    private readonly qwen: QwenClient,
    private readonly webSearch: WebSearchTool,
    private readonly readWebPage: ReadWebPageTool,
  ) {}

  async answer(messages: QwenMessage[], allowWebSearch = false): Promise<ToolAnswer> {
    // 关闭联网时，直接走无工具请求；模型没有进入联网执行分支的机会。
    if (allowWebSearch !== true) {
      return {
        answer: await this.finalAnswer(messages), webSources: [], webSearchFailed: false,
        readPage: null, webPageReadFailed: false,
      };
    }
    const decision = await this.chooseTool(messages, WEB_SEARCH_DEFINITION);
    if (!decision.tool_calls?.length) {
      return {
        answer: isPendingToolRequest(decision.content) ? INSUFFICIENT_EVIDENCE_ANSWER : this.requireAnswer(decision),
        webSources: [],
        webSearchFailed: isPendingToolRequest(decision.content),
        readPage: null,
        webPageReadFailed: false,
      };
    }

    const search = await this.runWebSearchCalls(messages, decision);
    const pageAnswer = await this.answerWithOptionalPageRead(
      messages,
      search.sources,
    );
    return {
      answer: pageAnswer.answer,
      webSources: search.sources,
      webSearchFailed: search.failed,
      readPage: pageAnswer.readPage,
      webPageReadFailed: pageAnswer.webPageReadFailed,
    };
  }

  private async runWebSearchCalls(
    messages: QwenMessage[],
    decision: QwenAssistantMessage,
  ): Promise<WebSearchStep> {
    const toolCalls = decision.tool_calls ?? [];
    messages.push({
      role: "assistant",
      content: decision.content ?? null,
      tool_calls: toolCalls,
    });

    let sources: WebSearchSource[] = [];
    let failed = false;
    let searched = false;

    for (const call of toolCalls) {
      let toolResult: unknown;
      if (call.function.name !== "web_search") {
        toolResult = { error: "不支持这个工具" };
      } else if (searched) {
        toolResult = { error: "本次问答最多搜索一次" };
      } else {
        searched = true;
        try {
          const result = await this.performWebSearch(call);
          sources = result.sources;
          toolResult = {
            ...result,
            sources: result.sources.map((source, index) => ({ ...source, sourceId: webSourceId(index) })),
          };
        } catch {
          failed = true;
          toolResult = { error: "联网搜索失败，请根据已有资料回答并说明限制" };
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(toolResult),
      });
    }
    return { sources, failed };
  }

  private async performWebSearch(call: QwenToolCall): Promise<WebSearchResult> {
    const query = this.parseSearchQuery(call);
    return this.webSearch.execute({ query });
  }

  private async answerWithOptionalPageRead(
    messages: QwenMessage[],
    sources: WebSearchSource[],
  ): Promise<PageAnswer> {
    if (!sources.length) {
      return {
        answer: await this.finalAnswer(messages),
        readPage: null,
        webPageReadFailed: false,
      };
    }

    const decision = await this.chooseTool(messages, this.pageReadToolFor(sources));
    if (!decision.tool_calls?.length) {
      return {
        answer: isPendingToolRequest(decision.content) ? INSUFFICIENT_EVIDENCE_ANSWER : this.requireAnswer(decision),
        readPage: null,
        webPageReadFailed: isPendingToolRequest(decision.content),
      };
    }

    const toolCalls = decision.tool_calls;
    messages.push({
      role: "assistant",
      content: decision.content ?? null,
      tool_calls: toolCalls,
    });

    let readPage: ReadWebPageResult | null = null;
    let webPageReadFailed = false;
    let readAttempted = false;

    for (const call of toolCalls) {
      let toolResult: unknown;
      if (call.function.name !== "read_web_page") {
        toolResult = { error: "不支持这个工具" };
      } else if (readAttempted) {
        toolResult = { error: "本次问答最多阅读一篇网页" };
      } else {
        readAttempted = true;
        try {
          const sourceIndex = this.parseSourceIndex(call, sources.length);
          const url = sources[sourceIndex - 1].url;
          readPage = await this.readWebPage.execute({
            url,
            allowedUrls: sources.map((source) => source.url),
          });
          toolResult = { ...readPage, sourceId: webSourceId(sourceIndex - 1) };
        } catch (error) {
          this.logger.warn(
            "read_web_page failed: " +
              (error instanceof Error ? error.message : String(error)),
          );
          webPageReadFailed = true;
          toolResult = {
            error:
              "网页阅读失败。搜索摘要未经核实，不要据此断言事实；" +
              "仅根据网页正文和个人笔记回答，不足时说明无法确认。",
          };
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(toolResult),
      });
    }

    return {
      answer: await this.finalAnswer(messages),
      readPage,
      webPageReadFailed,
    };
  }

  private async chooseTool(messages: QwenMessage[], tool: QwenToolDefinition): Promise<QwenAssistantMessage> {
    const decision = await this.qwen.chatWithTools(messages, [tool]);
    if (decision.tool_calls?.length || !isPendingToolRequest(decision.content)) return decision;
    this.logger.warn(`${tool.function.name}: 模型返回执行指令但没有 tool_calls，补一次工具请求`);
    try {
      return await this.qwen.chatWithTools([
        ...messages,
        { role: "assistant", content: decision.content ?? null },
        { role: "system", content: "你刚才表示需要执行工具，却只输出了文字。本次请返回指定工具的 tool_calls 与合法参数，不要要求用户替你执行。" },
      ], [tool], { type: "function", function: { name: tool.function.name } });
    } catch {
      // 补请求失败也不能把原来的执行指令当成已经完成的回答。
      return decision;
    }
  }

  private async finalAnswer(messages: QwenMessage[]): Promise<string> {
    const answer = await this.qwen.chat(finalAnswerMessages(messages));
    return isPendingToolRequest(answer) ? INSUFFICIENT_EVIDENCE_ANSWER : answer;
  }

  private pageReadToolFor(sources: WebSearchSource[]): QwenToolDefinition {
    return {
      ...READ_WEB_PAGE_DEFINITION,
      function: {
        ...READ_WEB_PAGE_DEFINITION.function,
        description:
          READ_WEB_PAGE_DEFINITION.function.description +
          "。可选结果：" +
          sources
            .map((source, index) =>
              String(index + 1) + ". " + source.title + " (" + source.url + ")",
            )
            .join("；"),
        parameters: {
          ...READ_WEB_PAGE_DEFINITION.function.parameters,
          properties: {
            sourceIndex: {
              ...READ_WEB_PAGE_DEFINITION.function.parameters.properties.sourceIndex,
              enum: sources.map((_source, index) => index + 1),
            },
          },
        },
      },
    };
  }

  private parseSourceIndex(call: QwenToolCall, sourceCount: number): number {
    const args: unknown = JSON.parse(call.function.arguments);
    if (typeof args !== "object" || args === null) {
      throw new Error("工具参数不正确");
    }
    const index = (args as Record<string, unknown>).sourceIndex;
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 1 ||
      index > sourceCount
    ) {
      throw new Error("搜索结果序号不正确");
    }
    return index;
  }

  private parseSearchQuery(call: QwenToolCall): string {
    const args: unknown = JSON.parse(call.function.arguments);
    if (typeof args !== "object" || args === null) {
      throw new Error("工具参数不正确");
    }
    const value = (args as Record<string, unknown>).query;
    if (typeof value !== "string" || !value.trim() || value.length > 200) {
      throw new Error("工具参数不正确");
    }
    return value.trim();
  }

  private requireAnswer(message: QwenAssistantMessage): string {
    if (!message.content?.trim()) {
      throw new Error("Qwen 没有返回回答");
    }
    return message.content;
  }
}
