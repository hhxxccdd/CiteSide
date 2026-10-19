<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { renderAnswer, webUrl } from "./answerMarkdown";
import type { ResearchSource } from "./researchApi";

defineOptions({ inheritAttrs: false });
const props = withDefaults(defineProps<{ content: string; sources?: ResearchSource[] }>(), {
  sources: () => [],
});
const emit = defineEmits<{ citationsChanged: [ids: string[]]; openNote: [id: string] }>();
const rendered = computed(() => renderAnswer(props.content, props.sources));
const active = ref<ResearchSource | null>(null);
const previewStyle = ref<Record<string, string>>({});
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let activeAnchor: HTMLAnchorElement | null = null;

watch(rendered, (value) => { close(); emit("citationsChanged", value.citedSourceIds); }, { immediate: true });

function keepOpen(): void {
  clearTimeout(hideTimer);
}

function close(): void {
  keepOpen();
  active.value = null;
  activeAnchor = null;
}

function scheduleClose(): void {
  keepOpen();
  hideTimer = setTimeout(close, 180);
}

function positionPreview(): void {
  if (!activeAnchor) return;
  const rect = activeAnchor.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) { close(); return; }
  const width = Math.min(304, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  const above = rect.bottom + 270 > window.innerHeight && rect.top > 270;
  previewStyle.value = {
    width: `${width}px`, left: `${left}px`,
    ...(above ? { bottom: `${window.innerHeight - rect.top + 8}px` } : { top: `${Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 220))}px` }),
  };
}

function showPreview(event: MouseEvent | FocusEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest<HTMLAnchorElement>("a[data-source-id]");
  if (!anchor) return;
  const source = props.sources.find((item) => item.id === anchor.dataset.sourceId);
  if (!source) return;
  keepOpen();
  activeAnchor = anchor;
  active.value = source;
  positionPreview();
}

function handleKey(event: KeyboardEvent): void {
  if (event.key === "Escape") close();
}

function openNote(id: string): void {
  close();
  emit("openNote", id);
}

function activateCitation(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  const anchor = event.target.closest<HTMLAnchorElement>("a[data-source-id]");
  const source = props.sources.find((item) => item.id === anchor?.dataset.sourceId);
  if (source?.kind === "note" && source.noteId && !webUrl(source.url)) {
    event.preventDefault();
    openNote(source.noteId);
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleKey);
  window.addEventListener("resize", positionPreview);
  window.addEventListener("scroll", positionPreview, true);
});
onUnmounted(() => {
  close();
  window.removeEventListener("keydown", handleKey);
  window.removeEventListener("resize", positionPreview);
  window.removeEventListener("scroll", positionPreview, true);
});
</script>

<template>
  <div v-bind="$attrs" class="markdown-body" @click="activateCitation" @mouseover="showPreview" @mouseout="scheduleClose" @focusin="showPreview" @focusout="scheduleClose" v-html="rendered.html" />
  <Teleport to="body">
    <aside v-if="active" class="citation-preview" :style="previewStyle" aria-label="引用来源预览" @mouseenter="keepOpen" @mouseleave="scheduleClose" @focusin="keepOpen" @focusout="scheduleClose">
      <span class="citation-kind">{{ active.kind === 'page' ? '网页正文' : active.kind === 'note' ? '个人笔记' : '联网资料' }}</span>
      <strong>{{ active.title }}</strong>
      <p class="citation-evidence">{{ active.evidence === 'search-result' ? '搜索结果 · 原文未核对' : active.evidence === 'page-text' ? '已读取网页正文' : active.kind === 'note' ? '已保存的笔记片段' : '本次任务的原文' }}</p>
      <p v-if="active.excerpt" class="citation-excerpt">{{ active.excerpt }}</p>
      <button v-if="active.noteId" type="button" class="text-button" @click="openNote(active.noteId)">查看笔记</button>
      <a v-if="webUrl(active.url)" :href="webUrl(active.url)!" target="_blank" rel="noopener noreferrer">打开原网页 ↗</a>
      <p class="citation-url">{{ active.url }}</p>
    </aside>
  </Teleport>
</template>

<style scoped>
.markdown-body { min-width: 0; color: #2e403b; font-size: 13px; line-height: 1.8; overflow-wrap: anywhere; }
.markdown-body :deep(> :first-child) { margin-top: 0; }
.markdown-body :deep(> :last-child) { margin-bottom: 0; }
.markdown-body :deep(p) { margin: 12px 0; }
.markdown-body :deep(h1), .markdown-body :deep(h2), .markdown-body :deep(h3), .markdown-body :deep(h4), .markdown-body :deep(h5), .markdown-body :deep(h6) { margin: 22px 0 10px; color: #203c32; font-size: 15px; line-height: 1.5; }
.markdown-body :deep(h1) { font-size: 19px; }
.markdown-body :deep(h2) { font-size: 17px; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { margin: 10px 0; padding-left: 21px; }
.markdown-body :deep(li + li) { margin-top: 5px; }
.markdown-body :deep(blockquote) { margin: 14px 0; padding: 2px 12px; border-left: 3px solid #8cc8ac; background: #f5f9f5; color: #596e61; }
.markdown-body :deep(code) { padding: 2px 4px; border-radius: 4px; background: #edf2ef; color: #315d4e; font: .9em/1.6 Consolas, monospace; }
.markdown-body :deep(pre) { max-width: 100%; overflow-x: auto; padding: 14px; border-radius: 9px; background: #17332f; color: #e1eee4; white-space: pre; }
.markdown-body :deep(pre code) { padding: 0; border-radius: 0; background: none; color: inherit; font-size: 12px; }
.markdown-body :deep(.markdown-table) { max-width: 100%; overflow-x: auto; margin: 14px 0; border: 1px solid #dee8e1; border-radius: 8px; }
.markdown-body :deep(table) { width: 100%; border-collapse: collapse; font-size: 12px; }
.markdown-body :deep(th), .markdown-body :deep(td) { min-width: 110px; padding: 9px 11px; border-bottom: 1px solid #e3ebe5; text-align: left; vertical-align: top; }
.markdown-body :deep(th) { background: #edf5ef; font-weight: 700; }
.markdown-body :deep(tr:last-child td) { border-bottom: 0; }
.markdown-body :deep(hr) { margin: 22px 0; border: 0; border-top: 1px solid #e2eae5; }
.markdown-body :deep(a) { color: #176a55; text-underline-offset: 3px; }
.markdown-body :deep(.answer-citation) { border-radius: 2px; color: #176a55; text-decoration: underline dotted #77aa8c; text-underline-offset: 4px; text-decoration-thickness: 1px; }
.markdown-body :deep(.answer-citation:hover), .markdown-body :deep(.answer-citation:focus-visible) { background: #e7f2e9; text-decoration-style: solid; }
.citation-preview { position: fixed; z-index: 20; max-height: min(300px, calc(100vh - 24px)); overflow-y: auto; padding: 15px; border: 1px solid #c8dfcf; border-radius: 12px; background: #fff; box-shadow: 0 10px 36px #1539272b; color: #324c3e; font: 12px/1.6 'Segoe UI', 'Microsoft YaHei', sans-serif; overflow-wrap: anywhere; }
.citation-kind { display: block; margin-bottom: 5px; color: #277766; font-size: 10px; font-weight: 700; }
.citation-preview strong { display: block; font-size: 13px; }
.citation-evidence { margin: 5px 0 9px; color: #7a8e80; font-size: 10px; }
.citation-excerpt { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 5; -webkit-box-orient: vertical; margin: 0 0 10px; white-space: pre-wrap; }
.citation-preview a { color: #176a55; }
.citation-url { margin: 5px 0 0; color: #8a9b90; font-size: 10px; }
</style>
