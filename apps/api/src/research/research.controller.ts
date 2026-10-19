import { Body, Controller, Post } from '@nestjs/common';
import { parseResearchInput } from './dto/research-input.dto';
import {
  ResearchResult,
  ResearchService,
} from './research.service';

@Controller('research')
export class ResearchController {
  constructor(private readonly research: ResearchService) {}

  @Post('run')
  async run(@Body() body: unknown): Promise<ResearchResult> {
    return this.research.run(parseResearchInput(body));
  }
}
