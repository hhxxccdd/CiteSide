import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Get,
  Query,
} from "@nestjs/common";
import {
  CreateKnowledgeInput,
  KnowledgeService,
  KnowledgeSearchResult,
} from "./Knowledge.service";

function isCreateKnowledgeInput(value: unknown): value is CreateKnowledgeInput {
  if (typeof value !== "object" || value === null) return false;

  const data = value as Record<string, unknown>;
  return [
    "title",
    "content",
    "originalQuestion",
    "sourceTitle",
    "sourceUrl",
  ].every((key) => typeof data[key] === "string");
}

@Controller("knowledge")
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Post()
  async create(@Body() body: unknown): Promise<{ id: string }> {
    if (!isCreateKnowledgeInput(body)) {
      throw new BadRequestException("笔记数据不完整");
    }

    const id = await this.knowledge.create(body);
    return { id };
  }

  @Get("search")
  async search(
    @Query("q") question: unknown,
  ): Promise<KnowledgeSearchResult[]> {
    if (typeof question !== "string" || !question.trim()) {
      throw new BadRequestException("搜索问题不能为空");
    }

    return this.knowledge.search(question);
  }
}
