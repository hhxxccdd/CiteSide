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
  WebPageReadError,
} from "./tools/read-web-page.tool";
import { webSourceId } from "./research-sources";

export interface ToolAnswer {
  answer: string;
  webSources: WebSearchSource[];
  webSearchFailed: boolean;
  readPage: ReadWebPageResult | null;
  webPageReadFailed: boolean;
  webPageReadError?: WebPageReadError;
}

interface WebSearchStep {
  sources: WebSearchSource[];
  failed: boolean;
}

interface PageAnswer {
  answer: string;
  readPage: ReadWebPageResult | null;
  webPageReadFailed: boolean;
  webPageReadError?: WebPageReadError;
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
        answer: await this.qwen.chat(messages), webSources: [], webSearchFailed: false,
        readPage: null, webPageReadFailed: false,
      };
    }
    const decision = await this.qwen.chatWithTools(messages, [
      WEB_SEARCH_DEFINITION,
    ]);
    if (!decision.tool_calls?.length) {
      return {
        answer: this.requireAnswer(decision),
        webSources: [],
        webSearchFailed: false,
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
      webPageReadError: pageAnswer.webPageReadError,
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
        answer: await this.qwen.chat(messages),
        readPage: null,
        webPageReadFailed: false,
      };
    }

    const decision = await this.qwen.chatWithTools(messages, [
      this.pageReadToolFor(sources),
    ]);
    if (!decision.tool_calls?.length) {
      return {
        answer: this.requireAnswer(decision),
        readPage: null,
        webPageReadFailed: false,
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
    let webPageReadError: WebPageReadError | undefined;
    let readAttempted = false;

    for (const call of toolCalls) {
      let toolResult: unknown;
      if (call.function.name !== "read_web_page") {
        toolResult = { error: "不支持这个工具" };
      } else if (readAttempted) {
        toolResult = { error: "本次问答最多阅读一篇网页" };
      } else {
        readAttempted = true;
        let source: WebSearchSource | undefined;
        try {
          const sourceIndex = this.parseSourceIndex(call, sources.length);
          source = sources[sourceIndex - 1];
          readPage = await this.readWebPage.execute({
            url: source.url,
            allowedUrls: sources.map((source) => source.url),
          });
          toolResult = { ...readPage, sourceId: webSourceId(sourceIndex - 1) };
        } catch (error) {
          webPageReadError = {
            title: source?.title ?? "本次网页",
            url: source?.url ?? "",
            reason: error instanceof Error ? error.message : "网页读取发生未知错误",
          };
          this.logger.warn(
            `read_web_page failed: ${webPageReadError.url} — ${webPageReadError.reason}`,
          );
          webPageReadFailed = true;
          toolResult = {
            ...webPageReadError,
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
      answer: await this.qwen.chat(messages),
      readPage,
      webPageReadFailed,
      webPageReadError,
    };
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
