import { Injectable } from '@nestjs/common';

export interface CurrentPageContext {
  title: string;
  url: string;
  text: string;
  truncated: boolean;
}

export const READ_CURRENT_CONTEXT_DEFINITION = {
  type: 'function',
  function: {
    name: 'read_current_context',
    description: '读取用户这次提问已确认的当前网页选区',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
} as const;

@Injectable()
export class ReadCurrentContextTool {
  execute(context: CurrentPageContext): CurrentPageContext {
    return context;
  }
}