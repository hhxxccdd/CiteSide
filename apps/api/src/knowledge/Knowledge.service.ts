import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { EmbeddingService } from "./embedding/embedding.service";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import { RelevanceService } from "./relevance/relevance.service";

export interface CreateKnowledgeInput {
  title: string;
  content: string;
  originalQuestion: string;
  sourceTitle: string;
  sourceUrl: string;
}

export interface KnowledgeSearchResult {
  id: string;
  title: string;
  content: string;
  sourceTitle: string;
  sourceUrl: string;
  similarity: number;
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  originalQuestion: string;
  sourceTitle: string;
  sourceUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateKnowledgeInput {
  title: string;
  content: string;
}

const ENTRY_COLUMNS = `id::text AS id, title, content,
  original_question AS "originalQuestion",
  source_title AS "sourceTitle", source_url AS "sourceUrl",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly embedding: EmbeddingService,
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly relevance: RelevanceService,
  ) {}

  async create(input: CreateKnowledgeInput): Promise<string> {
    const title = input.title.trim();
    const content = input.content.trim();
    const originalQuestion = input.originalQuestion.trim();
    const sourceTitle = input.sourceTitle.trim();
    const sourceUrl = input.sourceUrl.trim();

    if (!title || !content || !originalQuestion || !sourceTitle || !sourceUrl) {
      throw new BadRequestException("笔记内容和来源不能为空");
    }

    const { vectorText, model } = await this.vectorFor(title, content);

    const result = await this.database.query<{ id: string }>(
      `INSERT INTO knowledge_entries
         (title, content, original_question, source_title, source_url,
          embedding, embedding_model)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
       RETURNING id::text AS id`,
      [
        title,
        content,
        originalQuestion,
        sourceTitle,
        sourceUrl,
        vectorText,
        model,
      ],
    );

    return result.rows[0].id;
  }

  async list(filter = ""): Promise<KnowledgeEntry[]> {
    const result = await this.database.query<KnowledgeEntry>(
      `SELECT ${ENTRY_COLUMNS}
       FROM knowledge_entries
       WHERE $1 = '' OR position(lower($1) in lower(title)) > 0
         OR position(lower($1) in lower(content)) > 0
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
      [filter.trim()],
    );
    return result.rows;
  }

  async getById(id: string): Promise<KnowledgeEntry> {
    const result = await this.database.query<KnowledgeEntry>(
      `SELECT ${ENTRY_COLUMNS} FROM knowledge_entries WHERE id = $1`,
      [id],
    );
    if (!result.rows[0]) throw new NotFoundException("笔记不存在");
    return result.rows[0];
  }

  async update(id: string, input: UpdateKnowledgeInput): Promise<KnowledgeEntry> {
    const title = input.title.trim();
    const content = input.content.trim();
    if (!title || !content) {
      throw new BadRequestException("笔记标题和正文不能为空");
    }

    await this.getById(id);
    const { vectorText, model } = await this.vectorFor(title, content);
    const result = await this.database.query<KnowledgeEntry>(
      `UPDATE knowledge_entries
       SET title = $2, content = $3, embedding = $4::vector,
           embedding_model = $5, updated_at = now()
       WHERE id = $1
       RETURNING ${ENTRY_COLUMNS}`,
      [id, title, content, vectorText, model],
    );
    if (!result.rows[0]) throw new NotFoundException("笔记不存在");
    return result.rows[0];
  }

  async remove(id: string): Promise<void> {
    const result = await this.database.query<{ id: string }>(
      `DELETE FROM knowledge_entries WHERE id = $1 RETURNING id::text AS id`,
      [id],
    );
    if (!result.rows[0]) throw new NotFoundException("笔记不存在");
  }

  private async vectorFor(
    title: string,
    content: string,
  ): Promise<{ vectorText: string; model: string }> {
    const vector = await this.embedding.embed(`${title}\n${content}`);
    return {
      vectorText: `[${vector.join(",")}]`,
      model: this.config.getOrThrow<string>("EMBEDDING_MODEL"),
    };
  }

  async search(
    question: string,
    selectionText = "",
  ): Promise<KnowledgeSearchResult[]> {
    const text = question.trim();
    if (!text) {
      throw new BadRequestException("搜索问题不能为空");
    }

    const selection = selectionText.trim().slice(0, 1500);
    const retrievalText = selection
      ? `问题：${text}\n当前网页选区：${selection}`
      : text;

    const vector = await this.embedding.embed(retrievalText);
    const vectorText = `[${vector.join(",")}]`;
    const model = this.config.getOrThrow<string>("EMBEDDING_MODEL");

    const result = await this.database.query<KnowledgeSearchResult>(
      `SELECT
       id::text AS id,
       title,
       content,
       source_title AS "sourceTitle",
       source_url AS "sourceUrl",
       1 - (embedding <=> $1::vector) AS similarity
     FROM knowledge_entries
     WHERE embedding_model = $2
     ORDER BY embedding <=> $1::vector
     LIMIT 5`,
      [vectorText, model],
    );

    const candidates = result.rows.map(({ id, title, content }) => ({
      id,
      title,
      content,
    }));

    const selectedIds = await this.relevance.selectRelevantIds(
      text,
      selection,
      candidates,
    );
    const selectedSet = new Set(selectedIds);

    return result.rows.filter((note) => selectedSet.has(note.id)).slice(0, 3);
  }
}
