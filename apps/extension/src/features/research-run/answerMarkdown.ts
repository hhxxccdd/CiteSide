import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import type { ResearchSource } from "./researchApi";

export function webUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

// Reference definitions are ordinary Markdown, so saved notes keep usable links.
export function sourceDefinitions(sources: ResearchSource[]): string {
  return sources.flatMap((source) => {
    const url = webUrl(source.url);
    if (!url || !/^(S1|[NW][1-9]\d*)$/.test(source.id)) return [];
    const safeUrl = url.replace(/</g, "%3C").replace(/>/g, "%3E");
    const title = source.title.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ");
    return [`[${source.id}]: <${safeUrl}> "${title}"`];
  }).join("\n");
}

export function renderAnswer(markdown: string, sources: ResearchSource[] = []) {
  const cited = new Set<string>();
  const md = new MarkdownIt({ html: false, linkify: false, breaks: false });
  md.validateLink = (value) => webUrl(value) !== null;
  // Only this harmless HTML spelling is accepted, including inside table cells.
  md.inline.ruler.before("html_inline", "safe_line_break", (state, silent) => {
    const match = /^<br\s*\/?>/i.exec(state.src.slice(state.pos));
    if (!match) return false;
    if (!silent) state.push("softbreak", "br", 0).type = "hardbreak";
    state.pos += match[0].length;
    return true;
  });
  md.renderer.rules.image = (tokens, index) => md.utils.escapeHtml(tokens[index].content);
  md.renderer.rules.table_open = () => '<div class="markdown-table"><table>\n';
  md.renderer.rules.table_close = () => "</table></div>\n";
  md.core.ruler.after("inline", "source_links", (state) => {
    for (const block of state.tokens) {
      const children = block.children ?? [];
      for (let index = 0; index < children.length; index += 1) {
        const open = children[index];
        const text = children[index + 1];
        const close = children[index + 2];
        if (open.type !== "link_open" || text?.type !== "text" || close?.type !== "link_close") continue;
        const sourceIndex = sources.findIndex((source) => source.id === text.content &&
          webUrl(source.url) !== null && webUrl(source.url) === webUrl(String(open.attrGet("href") ?? "")));
        if (sourceIndex < 0) continue;
        const source = sources[sourceIndex];
        open.attrSet("class", "answer-citation");
        open.attrSet("data-source-id", source.id);
        open.attrSet("aria-label", `来源 ${sourceIndex + 1}：${source.title}`);
        text.content = `[${sourceIndex + 1}]`;
        cited.add(source.id);
      }
    }
  });
  md.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noopener noreferrer");
    return renderer.renderToken(tokens, index, options);
  };
  const definitions = sourceDefinitions(sources);
  const html = md.render(definitions ? `${definitions}\n\n${markdown}` : markdown);
  return {
    html: DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ["p", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "s", "blockquote", "hr", "br", "ul", "ol", "li", "pre", "code", "table", "thead", "tbody", "tr", "th", "td", "div", "a", "span"],
      ALLOWED_ATTR: ["href", "title", "target", "rel", "class", "data-source-id", "aria-label", "start"],
      ALLOW_DATA_ATTR: false,
      RETURN_TRUSTED_TYPE: false,
    }),
    citedSourceIds: [...cited],
  };
}
