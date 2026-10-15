import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import {
  ResearchInput,
  ResearchResult,
  ResearchService,
} from './research.service';

function isResearchInput(value: unknown): value is ResearchInput {
  if (typeof value !== 'object' || value === null) return false;

  const data = value as Record<string, unknown>;
  if (typeof data.context !== 'object' || data.context === null) {
    return false;
  }

  const context = data.context as Record<string, unknown>;

  return (
    typeof data.question === 'string' &&
    typeof context.title === 'string' &&
    typeof context.url === 'string' &&
    typeof context.text === 'string' &&
    typeof context.truncated === 'boolean'
  );
}

@Controller('research')
export class ResearchController {
  constructor(private readonly research: ResearchService) {}

  @Post('run')
  async run(@Body() body: unknown): Promise<ResearchResult> {
    if (!isResearchInput(body)) {
      throw new BadRequestException('问题或网页选区格式不正确');
    }

    return this.research.run(body);
  }
}