import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

export type QwenToolChoice = 'auto' | { type: 'function'; function: { name: string } };

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

  async chat(messages: QwenMessage[]): Promise<string> {
    const message = await this.request(messages);
    if (typeof message.content !== 'string' || !message.content.trim()) {
      throw new Error('Qwen 没有返回文字');
    }
    return message.content;
  }

  async chatWithTools(
    messages: QwenMessage[],
    tools: readonly QwenToolDefinition[],
    toolChoice: QwenToolChoice = 'auto',
  ): Promise<QwenAssistantMessage> {
    if (toolChoice !== 'auto' && !tools.some(tool => tool.function.name === toolChoice.function.name)) {
      throw new Error('指定工具不在本次允许的工具列表中');
    }
    return this.request(messages, tools, toolChoice);
  }

  private async request(
    messages: QwenMessage[],
    tools?: readonly QwenToolDefinition[],
    toolChoice: QwenToolChoice = 'auto',
  ): Promise<QwenAssistantMessage> {
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
        stream: false,
        max_tokens: maxOutputTokens,
        ...(tools?.length ? { tools, tool_choice: toolChoice } : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
      if (response.status === 400 && (detail?.error?.code === 'context_length_exceeded' ||
          /maximum context|context length|input length/i.test(detail?.error?.message ?? ''))) {
        throw new BadRequestException('完整资料超过当前模型的上下文容量，本次没有截取正文。');
      }
      throw new Error(`Qwen 请求失败：HTTP ${response.status}`);
    }

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
}
