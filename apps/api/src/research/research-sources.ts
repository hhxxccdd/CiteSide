import type { KnowledgeSearchResult } from "../knowledge/Knowledge.service";
import type { CurrentPageContext } from "./tools/read-current-context.tool";
import type { ReadWebPageResult } from "./tools/read-web-page.tool";
import type { WebSearchSource } from "./tools/web-search.tool";

export interface ResearchSource {
  id: string;
  kind: "selection" | "note" | "web";
  title: string;
  url: string;
  excerpt: string;
  evidence: "selection" | "note" | "search-result" | "page-text";
}

export function noteSourceId(index: number): string {
  return `N${index + 1}`;
}

export function webSourceId(index: number): string {
  return `W${index + 1}`;
}

function sameUrl(left: string, right: string): boolean {
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return false;
  }
}

export function createResearchSources(
  page: CurrentPageContext,
  notes: KnowledgeSearchResult[],
  webSources: WebSearchSource[],
  readPage: ReadWebPageResult | null,
): ResearchSource[] {
  return [
    { id: "S1", kind: "selection", title: page.title, url: page.url,
      excerpt: page.text.slice(0, 1200), evidence: "selection" },
    ...notes.map((note, index): ResearchSource => ({
      id: noteSourceId(index), kind: "note", title: note.title,
      url: note.sourceUrl, excerpt: note.content.slice(0, 1200), evidence: "note",
    })),
    ...webSources.map((source, index): ResearchSource => {
      const wasRead = readPage !== null && sameUrl(source.url, readPage.url);
      return {
        id: webSourceId(index), kind: "web", title: source.title,
        url: source.url, excerpt: wasRead ? readPage.text.slice(0, 1200) : "",
        evidence: wasRead ? "page-text" : "search-result",
      };
    }),
  ];
}
