<script setup lang="ts">
import { computed } from "vue";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

const props = defineProps<{ content: string }>();
const markdown = new MarkdownIt({ html: false, linkify: false });
// 预览只显示文章文字；标题锚点和网页链接不再显示成一串地址。
markdown.renderer.rules.link_open = () => "";
markdown.renderer.rules.link_close = () => "";
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content);
markdown.renderer.rules.table_open = () => '<div class="excerpt-table"><table>';
markdown.renderer.rules.table_close = () => "</table></div>";
const html = computed(() => DOMPurify.sanitize(markdown.render(props.content), {
  ALLOWED_TAGS: ["p", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "s", "blockquote", "hr", "br", "ul", "ol", "li", "pre", "code", "table", "thead", "tbody", "tr", "th", "td", "div"],
  ALLOWED_ATTR: ["class", "start"],
  ALLOW_DATA_ATTR: false,
}));
</script>

<template>
  <div class="source-body" v-html="html" />
</template>

<style scoped>
.source-body { min-width: 0; color: #53695e; font-size: 12px; line-height: 1.75; overflow-wrap: anywhere; }
.source-body :deep(p) { margin: 8px 0; }
.source-body :deep(h1), .source-body :deep(h2), .source-body :deep(h3), .source-body :deep(h4), .source-body :deep(h5), .source-body :deep(h6) { margin: 12px 0 6px; font-size: 13px; line-height: 1.5; color: #315646; }
.source-body :deep(> :first-child) { margin-top: 0; }
.source-body :deep(> :last-child) { margin-bottom: 0; }
.source-body :deep(ul), .source-body :deep(ol) { margin: 8px 0; padding-left: 20px; }
.source-body :deep(blockquote) { margin: 8px 0; padding-left: 10px; border-left: 2px solid #b7d4c1; }
.source-body :deep(pre) { max-width: 100%; overflow-x: auto; padding: 9px; border-radius: 6px; background: #edf3ef; white-space: pre; }
.source-body :deep(code) { font: .95em/1.6 Consolas, monospace; }
.source-body :deep(.excerpt-table) { max-width: 100%; overflow-x: auto; }
.source-body :deep(table) { border-collapse: collapse; }
.source-body :deep(th), .source-body :deep(td) { min-width: 90px; border: 1px solid #dfe8e2; padding: 5px 7px; text-align: left; }
</style>
