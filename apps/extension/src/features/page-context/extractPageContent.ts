import { Readability } from "@mozilla/readability";
import type { ExtractedPage } from "./pageContext.types";

const PAGE_TEXT_LIMIT = 30_000;

// 保留结构，避免 textContent 把段落和代码连成一行。
function readableText(root: Node): string {
  const parts: string[] = [];
  function visit(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push((node.textContent ?? "").replace(/\s+/g, " "));
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName;
    if (tag === "PRE") {
      parts.push("\n\n" + (node.textContent ?? "").trim() + "\n\n");
      return;
    }
    if (tag === "BR") { parts.push("\n"); return; }
    const block = /^(H[1-6]|P|DIV|SECTION|ARTICLE|BLOCKQUOTE|UL|OL|LI|TABLE|TR)$/.test(tag);
    if (block) parts.push("\n");
    if (/^H[1-6]$/.test(tag)) parts.push("#".repeat(Number(tag[1])) + " ");
    if (tag === "LI") parts.push("- ");
    for (const child of node.childNodes) visit(child);
    if (tag === "TD" || tag === "TH") parts.push(" | ");
    if (block) parts.push("\n");
  }
  visit(root);
  // 不统一压缩换行，以免破坏代码块中的空行。
  return parts.join("").trim();
}

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
    "script,style,noscript,nav,footer,aside,iframe,form,input,textarea,select,button,[role=navigation],[role=banner],[role=dialog]",
  ).forEach((element) => element.remove());

  let title = source.title || source.location.href;
  let root: Element | null;
  if (fallback) {
    root = copy.body;
  } else {
    const article = new Readability(copy, { maxElemsToParse: 50_000 }).parse();
    if (!article?.content) return null;
    title = article.title || title;
    // 在脱离页面的文档中解析，不把网页 HTML 插入侧栏。
    root = new DOMParser().parseFromString(article.content, "text/html").body;
  }
  const text = root ? readableText(root) : "";
  if (!text.trim()) return null;
  return {
    title,
    url: source.location.href,
    text: text.slice(0, PAGE_TEXT_LIMIT),
    totalCharacters: text.length,
    capturedAt: new Date().toISOString(),
    completeness: text.length > PAGE_TEXT_LIMIT ? "partial" : "full",
    extraction: fallback ? "visible-text" : "article",
  };
}
