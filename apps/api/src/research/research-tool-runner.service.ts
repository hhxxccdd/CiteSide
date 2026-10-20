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
import { ResearchExecution, researchStep } from "./research-execution";

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

  async answer(messages: QwenMessage[], allowWebSearch = false, execution?: ResearchExecution): Promise<ToolAnswer> {
    // 关闭联网时，直接走无工具请求；模型没有进入联网执行分支的机会。
    if (allowWebSearch !== true) {
      return {
        answer: await this.generateAnswer(messages, execution), webSources: [], webSearchFailed: false,
        readPage: null, webPageReadFailed: false,
      };
    }
    const decision = await researchStep(execution, "判断是否需要联网", () => this.qwen.chatWithTools(messages, [
      WEB_SEARCH_DEFINITION,
    ], execution?.answerOptions()), (result) => result.tool_calls?.length
      ? "模型请求调用工具，接下来校验并执行"
      : "模型未请求联网搜索，本次直接作答");
    if (!decision.tool_calls?.length) {
      return {
        answer: this.requireAnswer(decision),
        webSources: [],
        webSearchFailed: false,
        readPage: null,
        webPageReadFailed: false,
      };
    }

    execution?.emit({ type: "answer.reset" });
    const search = await this.runWebSearchCalls(messages, decision, execution);
    const pageAnswer = await this.answerWithOptionalPageRead(
      messages,
      search.sources,
      execution,
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
    execution?: ResearchExecution,
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
          const query = this.parseSearchQuery(call);
          const result = await researchStep(execution, "联网搜索", () => this.performWebSearch(query, execution?.signal),
            (result) => ({ detail: `搜索“${query}”，返回 ${result.sources.length} 条结果`, links: result.sources }),
            { detail: `搜索：${query}` });
          sources = result.sources;
          toolResult = {
            ...result,
            sources: result.sources.map((source, index) => ({ ...source, sourceId: webSourceId(index) })),
          };
        } catch {
          execution?.signal.throwIfAborted();
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

  private async performWebSearch(query: string, signal?: AbortSignal): Promise<WebSearchResult> {
    return this.webSearch.execute({ query }, signal);
  }

  private async answerWithOptionalPageRead(
    messages: QwenMessage[],
    sources: WebSearchSource[],
    execution?: ResearchExecution,
  ): Promise<PageAnswer> {
    if (!sources.length) {
      return {
        answer: await this.generateAnswer(messages, execution),
        readPage: null,
        webPageReadFailed: false,
      };
    }

    messages.push({ role: "user", content:
      "请继续完成上面的原问题。当前步骤是核对搜索结果：从提供的结果中选择一篇最相关的网页，调用 read_web_page 阅读正文，再作答。" +
      "搜索摘要和标题只是线索，不能直接证明具体网站或项目的实现细节。" +
      "如果这些结果全都无关，可以直接说明没有可核对的资料；不要根据摘要直接列出项目实现、网址或数字。",
    });
    const decision = await researchStep(execution, "判断是否需要阅读原文", () => this.qwen.chatWithTools(messages, [
      this.pageReadToolFor(sources),
    ], execution?.answerOptions()));
    if (!decision.tool_calls?.length) {
      return {
        answer: this.requireAnswer(decision),
        readPage: null,
        webPageReadFailed: false,
      };
    }

    const toolCalls = decision.tool_calls;
    execution?.emit({ type: "answer.reset" });
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
          const selectedSource = sources[sourceIndex - 1];
          source = selectedSource;
          readPage = await researchStep(execution, "读取网页原文", async () => {
            return this.readWebPage.execute({
              url: selectedSource.url,
              allowedUrls: sources.map((source) => source.url),
            }, execution?.signal);
          }, (page) => page.title, { links: [source] });
          toolResult = { ...readPage, sourceId: webSourceId(sourceIndex - 1) };
        } catch (error) {
          execution?.signal.throwIfAborted();
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
      answer: await this.generateAnswer(messages, execution),
      readPage,
      webPageReadFailed,
      webPageReadError,
    };
  }

  private generateAnswer(messages: QwenMessage[], execution?: ResearchExecution): Promise<string> {
    return researchStep(execution, "生成回答", () => this.qwen.chat(messages, execution?.answerOptions()));
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
