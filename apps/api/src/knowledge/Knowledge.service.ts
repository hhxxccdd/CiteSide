import { Injectable, BadRequestException } from "@nestjs/common";
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

    const vector = await this.embedding.embed(`${title}\n${content}`);
    const vectorText = `[${vector.join(",")}]`;
    const model = this.config.getOrThrow<string>("EMBEDDING_MODEL");

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
