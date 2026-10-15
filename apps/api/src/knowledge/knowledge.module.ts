import { Module } from "@nestjs/common";
import { EmbeddingService } from "./embedding/embedding.service";
import { DatabaseModule  } from "../database/database.module";
import { KnowledgeService } from "./Knowledge.service";
import { KnowledgeController } from "./knowledge.controller";
import { RelevanceService } from "./relevance/relevance.service";
import { LlmModule } from "../llm/llm.module";

@Module({
    imports:[DatabaseModule,LlmModule],
    providers:[EmbeddingService,KnowledgeService,RelevanceService],
    controllers:[KnowledgeController],
    exports:[KnowledgeService]
})

export class KnowledgeModule {}