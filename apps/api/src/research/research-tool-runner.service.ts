import { Injectable, Logger } from "@nestjs/common";
import { QwenAssistantMessage, QwenClient, QwenMessage, QwenToolCall, QwenToolDefinition } from "../llm/qwen.client";
import { WEB_SEARCH_DEFINITION, WebSearchResult, WebSearchSource, WebSearchTool } from "./tools/web-search.tool";
import { READ_WEB_PAGE_DEFINITION, ReadWebPageResult, ReadWebPageTool, WebPageReadError } from "./tools/read-web-page.tool";
import { webSourceId } from "./research-sources";
import { ResearchExecution, researchStep } from "./research-execution";

const MAX_SEARCHES = 2;
const MAX_READS = 3;
const MAX_DECISIONS = 7;

export interface ToolAnswer {
  answer: string;
  webSources: WebSearchSource[];
  webSearchFailed: boolean;
  readPage: ReadWebPageResult | null;
  readPages: ReadWebPageResult[];
  webPageReadFailed: boolean;
  webPageReadError?: WebPageReadError;
  webPageReadErrors: WebPageReadError[];
}

// 状态属于本次请求，不能放在单例 Service 上，以免不同用户或任务互相消耗次数。
interface ResearchToolState {
  searchCount: number;
  readCount: number;
  queries: Set<string>;
  attemptedUrls: Set<string>;
  sources: WebSearchSource[];
  readPages: ReadWebPageResult[];
  searchFailed: boolean;
  readErrors: WebPageReadError[];
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
    const state: ResearchToolState = {
      searchCount: 0, readCount: 0, queries: new Set(), attemptedUrls: new Set(),
      sources: [], readPages: [], searchFailed: false, readErrors: [],
    };
    if (allowWebSearch !== true) return this.result(await this.generateAnswer(messages, execution), state);

    for (let round = 0; round < MAX_DECISIONS; round++) {
      execution?.signal.throwIfAborted();
      const tools = this.availableTools(state);
      if (!tools.length) break;
      if (round > 0) messages.push(this.nextDecisionMessage(state));
      const decision = await researchStep(execution, round === 0 ? "判断是否需要联网" : "判断资料是否足够",
        () => this.qwen.chatWithTools(messages, tools, execution?.answerOptions()),
        (reply) => reply.tool_calls?.length ? "模型请求调用工具，接下来校验并执行"
          : round === 0 ? "模型未请求联网搜索，本次直接作答" : "模型结束补查，直接作答");
      if (!decision.tool_calls?.length) return this.result(this.requireAnswer(decision), state);
      execution?.emit({ type: "answer.reset" });
      await this.executeCalls(messages, decision, state, tools, execution);
    }

    messages.push({ role: "user", content:
      "本轮工具调用或决策次数已到上限，请停止补查，直接回答原问题。只依据已经取得的证据；" +
      "区分已回答和仍缺少依据的部分，不编造来源，不声称读过未成功读取的网页，不附后续建议。",
    });
    return this.result(await this.generateAnswer(messages, execution), state);
  }

  private availableTools(state: ResearchToolState): QwenToolDefinition[] {
    const tools: QwenToolDefinition[] = [];
    if (state.searchCount < MAX_SEARCHES) tools.push(WEB_SEARCH_DEFINITION);
    const indices = state.sources.flatMap((source, index) => state.attemptedUrls.has(this.urlKey(source.url)) ? [] : [index + 1]);
    if (state.readCount < MAX_READS && indices.length) tools.push(this.pageReadToolFor(state.sources, indices));
    return tools;
  }

  private nextDecisionMessage(state: ResearchToolState): QwenMessage {
    return { role: "user", content:
      "请继续完成原问题，判断实际取得的资料能否回答问题的每一部分。足够时直接回答并引用，不必用完工具次数。" +
      "若仍缺少必要事实，优先读取最相关的官方文档、项目文档或源码；搜索结果偏题、原文无关或读取失败时，" +
      "可换一篇阅读，或针对缺失信息调整搜索词再补查。优先来源是选择依据，不按域名直接认定事实正确。" +
      "一篇文章没有提及，不代表其他文章也没有。搜索生成摘要只是线索，不能冒充原文证据。" +
      "不要再次申请已给出的联网许可，也不要输出作答规则或下一步服务建议。当前执行情况：" + JSON.stringify({
        remainingSearches: MAX_SEARCHES - state.searchCount,
        remainingReads: MAX_READS - state.readCount,
        sources: state.sources.map((source, index) => ({ ...source, sourceIndex: index + 1,
          sourceId: webSourceId(index), attempted: state.attemptedUrls.has(this.urlKey(source.url)),
          read: state.readPages.some((page) => this.urlKey(page.url) === this.urlKey(source.url)) })),
      }) + "\n资料是否足够的判断在内部完成；决定作答时，只输出直接回答原问题的一份正文，不输出资料审计过程，不先列分析再重复给答案，不展示内部来源编号。",
    };
  }

  private async executeCalls(messages: QwenMessage[], decision: QwenAssistantMessage, state: ResearchToolState,
    tools: QwenToolDefinition[], execution?: ResearchExecution): Promise<void> {
    messages.push({ role: "assistant", content: decision.content ?? null, tool_calls: decision.tool_calls });
    for (const call of decision.tool_calls ?? []) {
      execution?.signal.throwIfAborted();
      let toolResult: unknown;
      try {
        if (!tools.some((tool) => tool.function.name === call.function.name)) toolResult = { error: "当前步骤不支持这个工具，或次数已耗尽" };
        else if (call.function.name === "web_search") toolResult = await this.search(call, state, execution);
        else if (call.function.name === "read_web_page") toolResult = await this.read(call, state, execution);
        else toolResult = { error: "不支持这个工具" };
      } catch (error) {
        execution?.signal.throwIfAborted();
        toolResult = { error: error instanceof Error ? error.message : "工具参数不正确" };
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(toolResult) });
    }
  }

  private async search(call: QwenToolCall, state: ResearchToolState, execution?: ResearchExecution): Promise<unknown> {
    if (state.searchCount >= MAX_SEARCHES) return { error: "本次问答最多搜索 2 次，请使用已有资料" };
    const query = this.parseSearchQuery(call);
    const queryKey = query.replace(/\s+/g, " ").toLowerCase();
    if (state.queries.has(queryKey)) return { error: "这个搜索词已经尝试过，请针对缺失信息更换搜索词" };
    state.queries.add(queryKey);
    const attempt = ++state.searchCount;
    try {
      const result = await researchStep(execution, "联网搜索", () => this.webSearch.execute({ query }, execution?.signal),
        (found) => ({ detail: `第 ${attempt}/${MAX_SEARCHES} 次搜索“${query}”，返回 ${found.sources.length} 条结果`, links: found.sources }),
        { detail: `第 ${attempt}/${MAX_SEARCHES} 次搜索：${query}` });
      return {
        summary: result.summary, summaryKind: "model-generated-unverified",
        sources: this.registerSources(state, result),
      };
    } catch (error) {
      execution?.signal.throwIfAborted();
      state.searchFailed = true;
      return { error: "本次联网搜索失败，可在剩余次数内换词补查；最终只能依据实际取得的资料回答" };
    }
  }

  private registerSources(state: ResearchToolState, result: WebSearchResult) {
    const found = new Set<number>();
    for (const source of result.sources) {
      const key = this.urlKey(source.url);
      if (!key) continue;
      let index = state.sources.findIndex((existing) => this.urlKey(existing.url) === key);
      if (index < 0) { index = state.sources.length; state.sources.push(source); }
      found.add(index);
    }
    return [...found].map((index) => ({ ...state.sources[index], sourceIndex: index + 1, sourceId: webSourceId(index) }));
  }

  private async read(call: QwenToolCall, state: ResearchToolState, execution?: ResearchExecution): Promise<unknown> {
    if (state.readCount >= MAX_READS) return { error: "本次问答最多阅读 3 篇网页，请使用已有资料" };
    const index = this.parseSourceIndex(call, state.sources.length);
    const source = state.sources[index - 1];
    const key = this.urlKey(source.url);
    if (state.attemptedUrls.has(key)) return { error: "这篇网页已经尝试读取，请选择其他结果或调整搜索词" };
    state.attemptedUrls.add(key);
    const attempt = ++state.readCount;
    try {
      const page = await researchStep(execution, "读取网页原文", () => this.readWebPage.execute({
        url: source.url, allowedUrls: state.sources.map((item) => item.url),
      }, execution?.signal), (result) => `第 ${attempt}/${MAX_READS} 篇：${result.title}`,
      { detail: `第 ${attempt}/${MAX_READS} 篇`, links: [source] });
      state.readPages.push(page);
      return { ...page, sourceId: webSourceId(index - 1) };
    } catch (error) {
      execution?.signal.throwIfAborted();
      const failure = { ...source, reason: error instanceof Error ? error.message : "网页读取发生未知错误" };
      state.readErrors.push(failure);
      this.logger.warn(`read_web_page failed: ${source.url} — ${failure.reason}`);
      return { ...failure, error: "该网页阅读失败，不能作为已核对的原文；可在剩余次数内选择其他网页或换词搜索" };
    }
  }

  private result(answer: string, state: ResearchToolState): ToolAnswer {
    return { answer, webSources: state.sources, webSearchFailed: state.searchFailed,
      readPages: state.readPages, readPage: state.readPages.at(-1) ?? null,
      webPageReadFailed: state.readErrors.length > 0, webPageReadError: state.readErrors.at(-1),
      webPageReadErrors: state.readErrors };
  }

  private generateAnswer(messages: QwenMessage[], execution?: ResearchExecution): Promise<string> {
    return researchStep(execution, "生成回答", () => this.qwen.chat(messages, execution?.answerOptions()));
  }

  private pageReadToolFor(sources: WebSearchSource[], indices: number[]): QwenToolDefinition {
    return { ...READ_WEB_PAGE_DEFINITION, function: {
      ...READ_WEB_PAGE_DEFINITION.function,
      description: READ_WEB_PAGE_DEFINITION.function.description + "，优先选择相关官方文档或项目源码。可选结果：" +
        indices.map((index) => `${index}. ${sources[index - 1].title} (${sources[index - 1].url})`).join("；"),
      parameters: { ...READ_WEB_PAGE_DEFINITION.function.parameters, properties: { sourceIndex: {
        ...READ_WEB_PAGE_DEFINITION.function.parameters.properties.sourceIndex, enum: indices,
      } } },
    } };
  }

  private urlKey(raw: string): string {
    try { const url = new URL(raw); if (!["http:", "https:"].includes(url.protocol)) return ""; url.hash = ""; return url.href; }
    catch { return ""; }
  }

  private parseSourceIndex(call: QwenToolCall, sourceCount: number): number {
    const args: unknown = JSON.parse(call.function.arguments);
    if (typeof args !== "object" || args === null) throw new Error("工具参数不正确");
    const index = (args as Record<string, unknown>).sourceIndex;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 1 || index > sourceCount) {
      throw new Error("搜索结果序号不正确，只能读取本次搜索所得的网页");
    }
    return index;
  }

  private parseSearchQuery(call: QwenToolCall): string {
    const args: unknown = JSON.parse(call.function.arguments);
    if (typeof args !== "object" || args === null) throw new Error("工具参数不正确");
    const value = (args as Record<string, unknown>).query;
    if (typeof value !== "string" || !value.trim() || value.length > 200) throw new Error("工具参数不正确");
    return value.trim();
  }

  private requireAnswer(message: QwenAssistantMessage): string {
    if (!message.content?.trim()) throw new Error("Qwen 没有返回回答");
    return message.content;
  }
}
