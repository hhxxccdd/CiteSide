import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { LlmModule } from '../llm/llm.module';
import { ReadCurrentContextTool } from './tools/read-current-context.tool';
import { ResearchService } from './research.service';
import { ResearchContextService } from './research-context.service';
import { ResearchCitationsService } from './research-citations.service';
import { ResearchToolRunner } from './research-tool-runner.service';
import { SearchKnowledgeBaseTool } from './tools/search-knowledge-base.tool';
import { ResearchController } from './research.controller';
import { WebSearchTool } from './tools/web-search.tool';
import { ReadWebPageTool } from './tools/read-web-page.tool';
@Module({
  imports: [KnowledgeModule, LlmModule],
  providers: [
    ResearchContextService,
    ResearchCitationsService,
    ReadCurrentContextTool,
    SearchKnowledgeBaseTool,
    WebSearchTool,
    ReadWebPageTool,
    ResearchToolRunner,
    ResearchService,
  ],
  controllers: [ResearchController],
})
export class ResearchModule {}
