import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Get,
  Query,
  Param,
  Patch,
  Delete,
} from "@nestjs/common";
import {
  CreateKnowledgeInput,
  KnowledgeService,
  KnowledgeSearchResult,
  KnowledgeEntry,
  UpdateKnowledgeInput,
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

function isUpdateKnowledgeInput(value: unknown): value is UpdateKnowledgeInput {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return typeof data.title === "string" && typeof data.content === "string";
}

function validId(id: string): string {
  if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) {
    throw new BadRequestException("笔记 ID 不正确");
  }
  return id;
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

  @Get()
  async list(@Query("q") query?: string): Promise<KnowledgeEntry[]> {
    if (query !== undefined && typeof query !== "string") {
      throw new BadRequestException("筛选内容不正确");
    }
    return this.knowledge.list(query);
  }

  @Get(":id")
  async getById(@Param("id") id: string): Promise<KnowledgeEntry> {
    return this.knowledge.getById(validId(id));
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<KnowledgeEntry> {
    if (!isUpdateKnowledgeInput(body)) {
      throw new BadRequestException("笔记标题或正文格式不正确");
    }
    return this.knowledge.update(validId(id), body);
  }

  @Delete(":id")
  async remove(@Param("id") id: string): Promise<{ deleted: true }> {
    await this.knowledge.remove(validId(id));
    return { deleted: true };
  }
}
