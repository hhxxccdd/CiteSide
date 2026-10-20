import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { KnowledgeService, type KnowledgeEntry } from "../knowledge/Knowledge.service";

export type ResearchNote = Pick<KnowledgeEntry, "id" | "title" | "content" | "sourceTitle" | "sourceUrl">;

@Injectable()
export class ResearchContextService {
  constructor(private readonly knowledge: KnowledgeService) {}

  async specifiedNotes(ids: string[], signal?: AbortSignal): Promise<ResearchNote[]> {
    return Promise.all(ids.map(async (id) => {
      try {
        signal?.throwIfAborted();
        const note = await this.knowledge.getById(id);
        signal?.throwIfAborted();
        return { id: note.id, title: note.title, content: note.content, sourceTitle: note.sourceTitle, sourceUrl: note.sourceUrl };
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof NotFoundException) throw new BadRequestException(`指定笔记 ${id} 已不存在，请移除后重试`);
        throw new ServiceUnavailableException("指定笔记暂时无法读取，请稍后重试");
      }
    }));
  }

  mergeNotes(specified: ResearchNote[], retrieved: ResearchNote[]): ResearchNote[] {
    return [...new Map([...retrieved, ...specified].map((note) => [note.id, note])).values()];
  }
}
