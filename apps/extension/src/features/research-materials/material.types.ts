import type { BrowserPage, PageSnapshot } from "../page-context/pageContext.types";

export type MaterialChoice = { kind: "page"; page: BrowserPage } | { kind: "note"; note: { id: string; title: string } };
export type ResearchMaterial =
  | { id: string; kind: "page"; title: string; page: BrowserPage; state: "reading" | "ready" | "needs-permission" | "failed"; snapshot: PageSnapshot | null; error: string }
  | { id: string; kind: "note"; title: string; noteId: string };

export function pageKey(url: string): string {
  const parsed = new URL(url); parsed.hash = ""; return parsed.href;
}
