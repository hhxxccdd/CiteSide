import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { tables } from "turndown-plugin-gfm";
import type { ExtractedPage } from "./pageContext.types";

const PAGE_TRANSFER_BYTES = 8 * 1024 * 1024;

const markdown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
markdown.use(tables);

export function extractPageContent(
  source: Document,
  fallback = false,
): ExtractedPage | null {
  const copy = source.cloneNode(true) as Document;
  const sourceNodes = source.querySelectorAll("*");
  const clonedNodes = copy.querySelectorAll("*");
  // 克隆文档无法计算原站样式，先用原文档判断可见性，再删副本节点。
  const view = source.defaultView;
  sourceNodes.forEach((element, index) => {
    const style = view?.getComputedStyle(element);
    if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true" ||
        style?.display === "none" || style?.visibility === "hidden") {
      clonedNodes[index]?.remove();
    }
  });
  copy.querySelectorAll(
    "script,style,noscript,nav,footer,aside,iframe,form,input,textarea,select,button,img,svg,video,audio,[role=navigation],[role=banner],[role=dialog]",
  ).forEach((element) => element.remove());

  let title = source.title || source.location.href;
  let root: HTMLElement | null;
  if (fallback) {
    root = copy.body;
  } else {
    const article = new Readability(copy, { maxElemsToParse: 50_000 }).parse();
    if (!article?.content) return null;
    title = article.title || title;
    // 在脱离页面的文档中解析，不把网页 HTML 插入侧栏。
    root = new DOMParser().parseFromString(article.content, "text/html").body;
  }
  const text = root ? markdown.turndown(root) : "";
  if (!text.trim()) return null;
  const exceedsTransferLimit = new TextEncoder().encode(text).byteLength > PAGE_TRANSFER_BYTES;
  return {
    title,
    url: source.location.href,
    text: exceedsTransferLimit ? "" : text,
    totalCharacters: text.length,
    capturedAt: new Date().toISOString(),
    completeness: exceedsTransferLimit ? "partial" : "full",
    extraction: fallback ? "visible-text" : "article",
  };
}
