import { Injectable } from '@nestjs/common';
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
}

type QwenResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: QwenToolCall[];
    };
  }>;
};


@Injectable()
export class QwenClient {
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
  ): Promise<QwenAssistantMessage> {
    return this.request(messages, tools);
  }

  private async request(
    messages: QwenMessage[],
    tools?: readonly QwenToolDefinition[],
  ): Promise<QwenAssistantMessage> {
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
        ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(`Qwen 请求失败：HTTP ${response.status}`);
    }

    const data = (await response.json()) as QwenResponse;
    const message = data.choices?.[0]?.message;
    if (!message) {
      throw new Error('Qwen 没有返回消息');
    }
    return message;
  }
}