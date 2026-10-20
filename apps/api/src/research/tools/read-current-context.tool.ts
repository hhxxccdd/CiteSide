import { Injectable } from '@nestjs/common';

export interface CurrentPageContext {
  title: string;
  url: string;
  text: string;
  completeness: "full";
  capturedAt: string;
}

export const READ_CURRENT_CONTEXT_DEFINITION = {
  type: 'function',
  function: {
    name: 'read_current_context',
    description: '读取本次提问提交的完整网页正文快照',
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
