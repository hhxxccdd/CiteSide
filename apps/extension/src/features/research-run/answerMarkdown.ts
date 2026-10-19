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

const SOURCE_ID = "(?:S1|[NW][1-9]\\d*)";

function sourceDefinitions(sources: ResearchSource[]): string {
  return sources.flatMap((source) => {
    const url = webUrl(source.url);
    if (!url || !/^(S1|[NW][1-9]\d*)$/.test(source.id)) return [];
    const safeUrl = url.replace(/</g, "%3C").replace(/>/g, "%3E");
    return [`[${source.id}]: <${safeUrl}> "rf-source:${source.id}"`];
  }).join("\n");
}

function outsideCode(markdown: string, transform: (text: string) => string): string {
  const parser = new MarkdownIt();
  const offsets = [0];
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] === "\n") offsets.push(index + 1);
  }
  const blocks = parser.parse(markdown, {}).filter((token) =>
    (token.type === "fence" || token.type === "code_block") && token.map);
  let output = "";
  let start = 0;
  for (const block of blocks) {
    const from = offsets[block.map![0]];
    const to = offsets[block.map![1]] ?? markdown.length;
    output += transform(markdown.slice(start, from)) + markdown.slice(from, to);
    start = to;
  }
  return output + transform(markdown.slice(start));
}

// Editing and saving use ordinary named links, so implementation IDs stay hidden.
export function editableMarkdown(markdown: string, sources: ResearchSource[] = []): string {
  const env: { references?: Record<string, { href: string; title: string }> } = {};
  new MarkdownIt().parse(markdown, env);
  const links = new Map<string, { url: string; title: string }>();
  for (const [id, reference] of Object.entries(env.references ?? {})) {
    if (new RegExp(`^${SOURCE_ID}$`).test(id) && webUrl(reference.href)) {
      links.set(id, { url: reference.href, title: reference.title.startsWith("rf-source:") ? "查看来源" : reference.title || "查看来源" });
    }
  }
  for (const source of sources) {
    if (webUrl(source.url)) links.set(source.id, { url: source.url, title: source.title });
  }
  const namedLink = (id: string, label?: string): string => {
    const source = links.get(id);
    if (!source) return label ?? "";
    const text = label ?? source.title.replace(/[[\]\\]/g, "");
    const url = webUrl(source.url)!.replace(/</g, "%3C").replace(/>/g, "%3E");
    return `[${text}](<${url}>)`;
  };
  return outsideCode(markdown, (text) => {
    const prose = text.replace(new RegExp(`^ {0,3}\\[${SOURCE_ID}\\]:[^\\n]*(?:\\n|$)`, "gm"), "");
    const edits: Array<{ from: number; to: number; value: string }> = [];
    const parser = new MarkdownIt();
    parser.inline.ruler.before("link", "editable_source", (state, silent) => {
      if (silent || state.src[state.pos] !== "[") return false;
      const end = state.md.helpers.parseLinkLabel(state, state.pos, true);
      if (end < 0) return false;
      const label = state.src.slice(state.pos + 1, end);
      const suffix = state.src.slice(end + 1);
      const reference = new RegExp(`^\\[(${SOURCE_ID})\\]`).exec(suffix);
      const shortcut = new RegExp(`^${SOURCE_ID}$`).test(label) && !/^[(:\[]/.test(suffix);
      if (!reference && !shortcut) return false;
      const to = end + 1 + (reference?.[0].length ?? 0);
      const value = namedLink(reference?.[1] ?? label, reference ? label : undefined);
      edits.push({ from: state.pos, to, value });
      state.push("text", "", 0).content = value;
      state.pos = to;
      return true;
    });
    parser.inline.parse(prose, parser, env, []);
    let result = prose;
    for (const edit of edits.reverse()) result = result.slice(0, edit.from) + edit.value + result.slice(edit.to);
    return result;
  }).trim();
}

export function renderAnswer(markdown: string, sources: ResearchSource[] = []) {
  const cited = new Set<string>();
  const md = new MarkdownIt({ html: false, linkify: false, breaks: false });
  md.validateLink = (value) => webUrl(value) !== null;
  // Only this harmless HTML spelling is accepted, including inside table cells.
  md.inline.ruler.before("html_inline", "safe_line_break", (state, silent) => {
    const match = /^<br\s*\/?>/i.exec(state.src.slice(state.pos));
    if (!match) return false;
    if (!silent) state.push("hardbreak", "br", 0);
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
        if (open.type !== "link_open") continue;
        const title = String(open.attrGet("title") ?? "");
        const id = title.startsWith("rf-source:") ? title.slice("rf-source:".length) : null;
        const sourceIndex = sources.findIndex((source) => source.id === id &&
          webUrl(source.url) !== null && webUrl(source.url) === webUrl(String(open.attrGet("href") ?? "")));
        const source = sources[sourceIndex];
        const text = children[index + 1];
        if (text?.type === "text" && children[index + 2]?.type === "link_close" &&
            new RegExp(`^${SOURCE_ID}$`).test(text.content)) {
          text.content = source?.title ?? (id ? "查看来源" : title || "查看来源");
        }
        if (id) open.attrs = open.attrs?.filter(([name]) => name !== "title") ?? null;
        if (source) {
          open.attrSet("class", "answer-citation");
          open.attrSet("data-source-id", source.id);
          open.attrSet("aria-label", `引用来源：${source.title}`);
          cited.add(source.id);
        }
      }
      let inLink = false;
      for (const token of children) {
        if (token.type === "link_open") inLink = true;
        if (token.type === "link_close") inLink = false;
        if (token.type === "text" && !inLink) {
          token.content = token.content
            .replace(new RegExp(`\\[([^\\]]+)\\]\\[${SOURCE_ID}\\]`, "g"), "$1")
            .replace(new RegExp(`\\[${SOURCE_ID}\\]`, "g"), "");
        }
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
