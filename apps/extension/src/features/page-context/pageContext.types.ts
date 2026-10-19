export interface PageReadRequest {
  type: "RESEARCHFLOW_READ_PAGE";
  url: string;
  fallback: boolean;
}

export interface BrowserPage {
  tabId: number;
  url: string;
  title: string;
  loading: boolean;
}

export interface ExtractedPage {
  title: string;
  url: string;
  text: string;
  totalCharacters: number;
  capturedAt: string;
  completeness: "full" | "partial";
  extraction: "article" | "visible-text";
}

export interface PageSnapshot extends ExtractedPage {
  id: string;
  tabId: number;
}

export type PageReadState =
  | "loading" | "available" | "needs-permission" | "reading"
  | "ready" | "partial" | "empty" | "unsupported" | "failed";

export type PageReadResponse =
  | { ok: true; page: ExtractedPage }
  | { ok: false; reason: "empty" | "changed" | "failed" };
