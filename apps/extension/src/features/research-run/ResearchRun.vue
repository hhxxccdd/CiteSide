<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { PageSnapshot } from "../page-context/pageContext.types";
import { runResearch, type ResearchContext, type ResearchResult, type ResearchOptions } from "./researchApi";
import KnowledgeSave from "../knowledge-base/KnowledgeSave.vue";
import AnswerContent from "./AnswerContent.vue";
import { editableMarkdown } from "./answerMarkdown";
import { loadCompletedResearch, saveCompletedResearch } from "./researchSession";

const props = defineProps<{ context: PageSnapshot | null }>();
const emit = defineEmits<{ saved: [id: string]; openNote: [id: string] }>();
const question = ref("");
const result = ref<ResearchResult | null>(null);
const submittedContext = ref<ResearchContext | null>(null);
const submittedQuestion = ref("");
const useCurrentPage = ref(true);
const searchKnowledgeBase = ref(true);
const allowWebSearch = ref(false);
const submittedOptions = ref<ResearchOptions | null>(null);
const completedRun = ref(0);
const pending = ref(false);
const error = ref("");
const restoring = ref(true);
const sessionNotice = ref("");
const citedSourceIds = ref<string[]>([]);
const sources = computed(() => result.value?.sources ?? []);
const noteContent = computed(() => editableMarkdown(result.value?.answer ?? "", sources.value));
const canSubmit = computed(() => Boolean(question.value.trim()) && !pending.value && !restoring.value &&
  (useCurrentPage.value ? props.context !== null : searchKnowledgeBase.value || allowWebSearch.value));
const answerScope = computed(() => [
  submittedContext.value ? "网页正文" : "",
  submittedOptions.value?.searchKnowledgeBase ? "个人知识库" : "",
  submittedOptions.value?.allowWebSearch ? "允许联网" : "",
].filter(Boolean).join(" · "));
const primarySource = computed(() => submittedContext.value ?? sources.value.find((source) =>
  source.kind === "web" && source.evidence === "page-text") ?? null);
let controller: AbortController | null = null;
let requestNumber = 0;
let disposed = false;

onMounted(async () => {
  try {
    const saved = await loadCompletedResearch();
    if (disposed) return;
    if (saved) {
      result.value = saved.result;
      submittedContext.value = saved.context;
      submittedQuestion.value = saved.question;
      question.value = saved.question;
      submittedOptions.value = saved.options ?? null;
      if (saved.options) {
        useCurrentPage.value = saved.context !== null;
        searchKnowledgeBase.value = saved.options.searchKnowledgeBase;
        allowWebSearch.value = saved.options.allowWebSearch;
      }
      completedRun.value += 1;
    }
  } catch {
    if (!disposed) sessionNotice.value = "上次回答暂时无法恢复。";
  } finally {
    if (!disposed) restoring.value = false;
  }
});

// 切页不会卸载本组件，也不会修改已提交的正文快照。
onUnmounted(() => { disposed = true; requestNumber += 1; controller?.abort(); });

function isWebUrl(url: string): boolean {
  try { return ["http:", "https:"].includes(new URL(url).protocol); }
  catch { return false; }
}

async function submit(): Promise<void> {
  const page = useCurrentPage.value ? props.context : null;
  const text = question.value.trim();
  if (!canSubmit.value || page && page.completeness !== "full") return;

  const context: ResearchContext | null = page ? {
    title: page.title, url: page.url, text: page.text,
    capturedAt: page.capturedAt, completeness: "full",
  } : null;
  const options: ResearchOptions = {
    searchKnowledgeBase: searchKnowledgeBase.value, allowWebSearch: allowWebSearch.value,
  };
  controller?.abort();
  const requestController = new AbortController();
  controller = requestController;
  const currentRequest = ++requestNumber;
  pending.value = true;
  error.value = "";
  try {
    if (page) {
      const currentWindow = await chrome.windows.getCurrent();
      const [tab] = await chrome.tabs.query({ active: true, windowId: currentWindow.id });
      if (currentRequest !== requestNumber) return;
      if (tab?.id !== page.tabId || tab.url !== page.url || tab.status === "loading" || props.context?.id !== page.id) {
        throw new Error("网页已变化，请等待当前网页正文读取完成后再提问。");
      }
    }
    const answer = await runResearch(text, context, options, requestController.signal);
    if (currentRequest !== requestNumber) return;
    result.value = answer;
    submittedContext.value = context;
    submittedQuestion.value = text;
    submittedOptions.value = options;
    completedRun.value += 1;
    pending.value = false;
    sessionNotice.value = "";
    try {
      await saveCompletedResearch({ question: text, context, options, result: answer });
    } catch {
      if (currentRequest === requestNumber) sessionNotice.value = "回答已显示，但暂存失败。关闭侧栏后可能无法恢复。";
    }
  } catch (cause) {
    if (currentRequest === requestNumber) {
      error.value = cause instanceof Error && cause.name !== "AbortError" ? cause.message : "提问已中断，请重试。";
    }
  } finally {
    if (currentRequest === requestNumber) { pending.value = false; controller = null; }
  }
}
</script>

<template>
  <section class="panel research-card">
    <slot name="page-context" :included="useCurrentPage" />
    <div class="panel-heading">
      <span class="eyebrow">提出问题</span>
    </div>
    <form @submit.prevent="submit">
      <fieldset class="scope-controls" :disabled="pending || restoring">
        <legend>参考范围</legend>
        <label><input v-model="useCurrentPage" type="checkbox" />使用当前网页</label>
        <label><input v-model="searchKnowledgeBase" type="checkbox" />搜索个人知识库</label>
        <label><input v-model="allowWebSearch" type="checkbox" />允许联网</label>
      </fieldset>
      <p v-if="useCurrentPage && !context" class="scope-hint">等待网页读取。也可以关闭“使用当前网页”，只查个人知识库或联网资料。</p>
      <p v-else-if="!useCurrentPage && !searchKnowledgeBase && !allowWebSearch" class="scope-hint">请至少选择一种资料范围。</p>
      <label for="research-question">你想知道什么？</label>
      <textarea
        id="research-question"
        v-model="question"
        :disabled="pending || restoring"
        :placeholder="useCurrentPage ? '例如：总结这篇文章，并解释它的核心观点' : '例如：我之前保存过哪些关于泛型的笔记？'"
        rows="4"
        maxlength="4000"
      />
      <button type="submit" class="primary-button submit-button" :disabled="!canSubmit">
        {{ pending ? "正在研究，请稍候…" : "开始研究 →" }}
      </button>
    </form>
    <div v-if="pending" class="working-state" role="status">
      <span class="working-indicator" aria-hidden="true" />
      <span>正在查找资料并生成回答，完成后会显示在这里。</span>
    </div>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <p v-if="sessionNotice" class="source-note" role="status">{{ sessionNotice }}</p>

    <div v-if="result" class="research-result">
      <div class="result-heading">
        <span class="result-mark" aria-hidden="true">✦</span>
        <div>
          <span class="eyebrow">研究结果</span>
          <h2>给你的回答</h2>
        </div>
      </div>
      <p class="answer-context">{{ submittedContext ? `针对“${submittedContext.title}”` : '本次未使用网页' }} · {{ submittedQuestion }}<br v-if="answerScope" />{{ answerScope }}</p>
      <AnswerContent class="answer-text" :content="result.answer" :sources="sources" @citations-changed="citedSourceIds = $event" @open-note="emit('openNote', $event)" />

      <details class="source-group">
        <summary>查看参考资料 <span>{{ sources.length }} 项</span></summary>
        <p class="source-note">把鼠标放在正文带下划线的引用文字上，即可查看来源。是否支持结论，请核对原文。</p>
        <p v-if="!sources.length" class="source-note">本次没有可预览的来源信息。</p>
        <details v-for="source in sources" :key="source.id" class="source-item">
          <summary>
            <span class="source-type">{{ source.kind === 'page' ? '网页正文' : source.kind === 'note' ? '个人笔记' : '联网资料' }}</span>
            {{ source.title }}
            <span v-if="citedSourceIds.includes(source.id)" class="cited-tag">已引用</span>
          </summary>
          <p v-if="source.evidence === 'search-result'" class="source-note">搜索结果 · 原文未核对</p>
          <p v-else-if="source.evidence === 'page-text'" class="source-note">已读取网页正文</p>
          <p v-if="source.excerpt" class="source-excerpt">{{ source.excerpt }}</p>
          <button v-if="source.noteId" type="button" class="text-button" @click="emit('openNote', source.noteId)">查看笔记</button>
          <a v-if="isWebUrl(source.url)" :href="source.url" target="_blank" rel="noopener noreferrer">打开原网页 ↗</a>
        </details>
      </details>
      <p v-if="result.knowledgeSearchFailed" class="source-warning">个人笔记检索失败。</p>
      <p v-if="result.webSearchFailed" class="source-warning">联网搜索失败。</p>
      <p v-if="result.webPageReadFailed" class="source-warning">网页原文读取失败。</p>

      <KnowledgeSave
        :key="completedRun"
        :answer="noteContent"
        :question="submittedQuestion"
        :source-title="primarySource?.title ?? ''"
        :source-url="primarySource?.url ?? ''"
        @saved="emit('saved', $event)"
      />
    </div>
  </section>
</template>

<style scoped>
.research-card { margin-top: 12px; }
.research-card > form { display: grid; gap: 9px; }
.research-card .submit-button { margin-top: 4px; }
.scope-controls { display: flex; flex-wrap: wrap; gap: 9px 15px; margin: 0 0 5px; padding: 0; border: 0; }
.scope-controls legend { margin-bottom: 8px; color: var(--muted); font-size: 11px; }
.scope-controls label { display: inline-flex; gap: 5px; align-items: center; font-size: 11px; font-weight: 500; }
.scope-controls input { margin: 0; accent-color: var(--accent); }
.scope-hint { margin: 0 0 5px; color: var(--muted); font-size: 11px; line-height: 1.6; }
.working-state { display: flex; gap: 9px; align-items: flex-start; margin-top: 13px; padding: 11px; border-radius: 9px; background: #edf6f0; color: #3e6a55; font-size: 11px; line-height: 1.5; }
.working-indicator { width: 9px; height: 9px; flex: 0 0 9px; margin-top: 3px; border: 2px solid #85b9a0; border-top-color: #207a5c; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.research-result { margin-top: 20px; padding-top: 18px; border-top: 1px solid #e7eee8; }
.result-heading { display: flex; align-items: center; gap: 10px; }
.result-heading h2 { margin: 3px 0 0; }
.result-mark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: #e6f3e8; color: #20835e; font-size: 19px; }
.answer-text { margin: 16px 0; }
.answer-context { margin: 12px 0 0; color: #7b8d83; font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.source-group { border-top: 1px solid #e7eee8; padding-top: 12px; }
.source-group > summary { display: flex; align-items: center; gap: 7px; cursor: pointer; color: #285f52; font-size: 12px; font-weight: 700; }
.source-group > summary::before { content: '+'; color: #7fa18d; }
.source-group[open] > summary::before { content: '−'; }
.source-group > summary span { margin-left: auto; color: #8a9b90; font-size: 11px; font-weight: 500; }
.source-note { margin: 11px 0; color: #83948b; font-size: 11px; line-height: 1.5; }
.source-item { margin-top: 8px; padding: 10px; border: 1px solid #e5ece6; border-radius: 8px; font-size: 11px; overflow-wrap: anywhere; }
.source-item summary { cursor: pointer; color: #38554b; font-weight: 600; line-height: 1.5; }
.source-item .source-excerpt { max-height: 190px; overflow: auto; padding: 9px 0; white-space: pre-wrap; line-height: 1.7; }
.source-type { margin-right: 7px; color: #27836a; font-size: 10px; }
.source-item a { font-size: 11px; text-decoration: none; }
.source-item a:hover { text-decoration: underline; }
.cited-tag { display: inline-block; margin-left: 5px; padding: 0 4px; border-radius: 4px; background: #e7f2e9; color: #277766; font-size: 10px; }
@media (prefers-reduced-motion: reduce) { .working-indicator { animation: none; } }
</style>
