import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface WebSearchSource {
  title: string;
  url: string;
}

export interface WebSearchResult {
  summary: string;
  sources: WebSearchSource[];
}

export const WEB_SEARCH_DEFINITION = {
  type: 'function',
  function: {
    name: 'web_search',
    description: '补充现有资料无法覆盖的问题，包括具体使用案例、实际项目和最新信息。用户已允许联网时，遇到必要依据缺失应调用本工具补查；现有资料足够时无需调用。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '要搜索的具体问题或关键词',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
} as const;

interface DashScopeSearchResponse {
  output?: {
    choices?: Array<{ message?: { content?: string } }>;
    search_info?: {
      search_results?: Array<{ title?: string; url?: string }>;
    };
  };
  usage?: {
    plugins?: { search?: { count?: number } };
  };
}

@Injectable()
export class WebSearchTool {
  constructor(private readonly config: ConfigService) {}

  async execute(args: { query: string }, signal?: AbortSignal): Promise<WebSearchResult> {
    signal?.throwIfAborted();
    const query = args.query.trim();
    if (!query) {
      throw new BadRequestException('联网搜索内容不能为空');
    }

    const apiKey = this.config.getOrThrow<string>('DASHSCOPE_API_KEY');
    const model = this.config.getOrThrow<string>('QWEN_CHAT_MODEL');
    const baseUrl = this.config.getOrThrow<string>('DASHSCOPE_BASE_URL');

    // 当前配置的地址以 /compatible-mode/v1 结尾；
    // 联网搜索的来源列表需要从 DashScope 接口获取。
    const url = baseUrl.replace(
      /\/compatible-mode\/v1\/?$/,
      '/api/v1/services/aigc/text-generation/generation',
    );
    if (url === baseUrl) {
      throw new Error('DASHSCOPE_BASE_URL 格式不正确');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: {
          messages: [{ role: 'user', content: query }],
        },
        parameters: {
          enable_search: true,
          search_options: {
            forced_search: true,
            enable_source: true,
          },
          result_format: 'message',
        },
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      throw new Error(`联网搜索失败：HTTP ${response.status}`);
    }

    const data = (await response.json()) as DashScopeSearchResponse;
    const searchCount = data.usage?.plugins?.search?.count ?? 0;
    if (searchCount === 0 && !data.output?.search_info) {
      throw new Error('百炼没有实际执行联网搜索');
    }

    const sources = (data.output?.search_info?.search_results ?? [])
      .flatMap((item) =>
        typeof item.title === 'string' && typeof item.url === 'string'
          ? [{ title: item.title, url: item.url }]
          : [],
      )
      .slice(0, 5);

    return {
      summary: data.output?.choices?.[0]?.message?.content ?? '',
      sources,
    };
  }
}
