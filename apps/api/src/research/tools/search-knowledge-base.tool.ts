import { Injectable } from '@nestjs/common';
import {
  KnowledgeSearchResult,
  KnowledgeService,
} from '../../knowledge/Knowledge.service';

export const SEARCH_KNOWLEDGE_BASE_DEFINITION = {
  type: 'function',
  function: {
    name: 'search_knowledge_base',
    description: '搜索用户已保存的知识库笔记，查找可能帮助回答问题的内容',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '要在知识库中搜索的问题',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
} as const;

@Injectable()
export class SearchKnowledgeBaseTool {
  constructor(private readonly knowledge: KnowledgeService) {}

  async execute(args: {
    query: string;
    pageContext?: string
  }, signal?: AbortSignal): Promise<KnowledgeSearchResult[]> {
    return this.knowledge.search(args.query, args.pageContext, signal);
  }
}
