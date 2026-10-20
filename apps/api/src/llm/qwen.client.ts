import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createParser } from 'eventsource-parser';

export interface QwenRequestOptions {
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}

export interface QwenToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface QwenMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: QwenToolCall[];
}

export interface QwenToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

export interface QwenAssistantMessage {
  content?: string | null;
  tool_calls?: QwenToolCall[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

type QwenResponse = {
  usage?: QwenAssistantMessage['usage'];
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: QwenToolCall[];
    };
  }>;
};


@Injectable()
export class QwenClient {
  private readonly logger = new Logger(QwenClient.name);

  constructor(private readonly config: ConfigService) {}

  async chat(messages: QwenMessage[], options?: QwenRequestOptions): Promise<string> {
    const message = await this.request(messages, undefined, options);
    if (typeof message.content !== 'string' || !message.content.trim()) {
      throw new Error('Qwen 没有返回文字');
    }
    return message.content;
  }

  async chatWithTools(
    messages: QwenMessage[],
    tools: readonly QwenToolDefinition[],
    options?: QwenRequestOptions,
  ): Promise<QwenAssistantMessage> {
    return this.request(messages, tools, options);
  }

  private async request(
    messages: QwenMessage[],
    tools?: readonly QwenToolDefinition[],
    options?: QwenRequestOptions,
  ): Promise<QwenAssistantMessage> {
    options?.signal?.throwIfAborted();
    const maxOutputTokens = Number(this.config.get('QWEN_MAX_OUTPUT_TOKENS') ?? 8192);
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) {
      throw new Error('QWEN_MAX_OUTPUT_TOKENS 必须是正整数');
    }
    const apiKey = this.config.getOrThrow<string>('DASHSCOPE_API_KEY');
    const baseUrl = this.config
      .getOrThrow<string>('DASHSCOPE_BASE_URL')
      .replace(/\/+$/, '');
    const model = this.config.getOrThrow<string>('QWEN_CHAT_MODEL');

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: Boolean(options?.onDelta),
        ...(options?.onDelta ? { stream_options: { include_usage: true } } : {}),
        max_tokens: maxOutputTokens,
        ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
      }),
      signal: options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
      if (response.status === 400 && (detail?.error?.code === 'context_length_exceeded' ||
          /maximum context|context length|input length/i.test(detail?.error?.message ?? ''))) {
        throw new BadRequestException('完整资料超过当前模型的上下文容量，本次没有截取正文。');
      }
      throw new Error(`Qwen 请求失败：HTTP ${response.status}`);
    }

    if (options?.onDelta) return this.readStream(response, options);

    const data = (await response.json()) as QwenResponse;
    const message = data.choices?.[0]?.message;
    if (!message) {
      throw new Error('Qwen 没有返回消息');
    }
    if (data.usage) {
      this.logger.debug(`Token usage: input=${data.usage.prompt_tokens}, output=${data.usage.completion_tokens}`);
    }
    return { ...message, usage: data.usage };
  }

  private async readStream(response: Response, options: QwenRequestOptions): Promise<QwenAssistantMessage> {
    if (!response.body) throw new Error('Qwen 没有返回事件流');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const calls = new Map<number, QwenToolCall>();
    let content = '';
    let usage: QwenAssistantMessage['usage'];
    let done = false;
    const parser = createParser({ onEvent: (event) => {
      if (event.data === '[DONE]') { done = true; return; }
      const chunk = JSON.parse(event.data) as {
        error?: { message?: string };
        usage?: QwenAssistantMessage['usage'];
        choices?: Array<{ finish_reason?: string; delta?: { content?: string;
          tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> } }>;
      };
      if (chunk.error) throw new Error('Qwen 流式请求失败');
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason === 'length') throw new Error('回答达到输出长度上限，请缩小问题后重试');
      if (choice?.finish_reason === 'content_filter') throw new Error('模型未能完成这次回答');
      const delta = choice?.delta;
      if (delta?.content) { content += delta.content; options.onDelta?.(delta.content); }
      for (const fragment of delta?.tool_calls ?? []) {
        const call = calls.get(fragment.index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
        if (fragment.id) call.id = fragment.id;
        call.function.name += fragment.function?.name ?? '';
        call.function.arguments += fragment.function?.arguments ?? '';
        calls.set(fragment.index, call);
      }
    }, onError: (error) => { throw error; } });
    try {
      while (!done) {
        options.signal?.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        parser.feed(decoder.decode(chunk.value, { stream: true }));
      }
      parser.feed(decoder.decode());
      if (!done) throw new Error('模型连接提前断开，回答尚未完成，请重试');
      options.signal?.throwIfAborted();
      const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
      if (toolCalls.some((call) => !call.id || !call.function.name)) throw new Error('模型工具调用信息不完整');
      return { content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}), usage };
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}
