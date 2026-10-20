import type { ResearchNote } from "./research-context.service";
import type { CurrentPageContext } from "./tools/read-current-context.tool";
import type { ReadWebPageResult } from "./tools/read-web-page.tool";
import type { WebSearchSource } from "./tools/web-search.tool";

export interface ResearchSource {
  id: string;
  kind: "page" | "note" | "web";
  title: string;
  url: string;
  excerpt: string;
  evidence: "note" | "search-result" | "page-text";
  noteId?: string;
}

export function noteSourceId(index: number): string {
  return `N${index + 1}`;
}

export function pageSourceId(index: number): string { return `S${index + 1}`; }

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
  pages: CurrentPageContext[],
  notes: ResearchNote[],
  webSources: WebSearchSource[],
  readPage: ReadWebPageResult | null,
  readPages: ReadWebPageResult[] = [],
): ResearchSource[] {
  const pagesRead = readPages.length ? readPages : readPage ? [readPage] : [];
  return [
    ...pages.map((page, index): ResearchSource => ({ id: pageSourceId(index), kind: "page", title: page.title, url: page.url,
      excerpt: page.text.slice(0, 1200), evidence: "page-text" })),
    ...notes.map((note, index): ResearchSource => ({
      id: noteSourceId(index), kind: "note", title: note.title,
      url: note.sourceUrl, excerpt: note.content.slice(0, 1200), evidence: "note", noteId: note.id,
    })),
    ...webSources.map((source, index): ResearchSource => {
      const pageRead = pagesRead.find((page) => sameUrl(source.url, page.url));
      return {
        id: webSourceId(index), kind: "web", title: source.title,
        url: source.url, excerpt: pageRead ? pageRead.text.slice(0, 1200) : "",
        evidence: pageRead ? "page-text" : "search-result",
      };
    }),
  ];
}
