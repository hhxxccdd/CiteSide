import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { LlmModule } from '../llm/llm.module';
import { ReadCurrentContextTool } from './tools/read-current-context.tool';
import { ResearchService } from './research.service';
import { SearchKnowledgeBaseTool } from './tools/search-knowledge-base.tool';
import { ResearchController } from './research.controller';
import { WebSearchTool } from './tools/web-search.tool';

@Module({
  imports: [KnowledgeModule, LlmModule],
  providers: [ReadCurrentContextTool, SearchKnowledgeBaseTool,ResearchService,WebSearchTool],
  controllers:[ResearchController]
})
export class ResearchModule {}