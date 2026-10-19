<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import type { PageSelection } from "../page-context/useSelectionPreview";
import { runResearch, type ResearchResult } from "./researchApi";
import KnowledgeSave from "../knowledge-base/KnowledgeSave.vue";
import AnswerContent from "./AnswerContent.vue";
import { sourceDefinitions } from "./answerMarkdown";

const props = defineProps<{ confirmed: PageSelection | null }>();
const emit = defineEmits<{ saved: [id: string] }>();

const question = ref("");
const result = ref<ResearchResult | null>(null);
const submittedContext = ref<PageSelection | null>(null);
const submittedQuestion = ref("");
const completedRun = ref(0);
const pending = ref(false);
const error = ref("");
const citedSourceIds = ref<string[]>([]);
const sources = computed(() => result.value?.sources ?? []);
const noteDefinitions = computed(() => sourceDefinitions(sources.value.filter((source) => citedSourceIds.value.includes(source.id))));
let controller: AbortController | null = null;
let requestNumber = 0;

watch(() => props.confirmed, (selection) => {
  if (selection?.tabId === submittedContext.value?.tabId &&
      selection?.url === submittedContext.value?.url &&
      selection?.text === submittedContext.value?.text) return;
  requestNumber += 1;
  controller?.abort();
  controller = null;
  pending.value = false;
  result.value = null;
  citedSourceIds.value = [];
  submittedContext.value = null;
  submittedQuestion.value = "";
  error.value = "";
});

onUnmounted(() => controller?.abort());

function isWebUrl(url: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

async function submit(): Promise<void> {
  const selection = props.confirmed;
  const text = question.value.trim();
  if (pending.value || !selection || !text) return;

  error.value = "";
  let tab: chrome.tabs.Tab | undefined;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    error.value = "无法确认当前网页，请重新打开侧栏后重试。";
    return;
  }
  if (!tab || tab.id !== selection.tabId || tab.url !== selection.url ||
      props.confirmed !== selection) {
    error.value = "当前网页或选区已经变化，请重新确认文字。";
    return;
  }

  controller?.abort();
  controller = new AbortController();
  const currentRequest = ++requestNumber;
  pending.value = true;
  result.value = null;
  citedSourceIds.value = [];
  submittedContext.value = selection;
  submittedQuestion.value = text;

  try {
    const answer = await runResearch(text, {
      title: selection.title,
      url: selection.url,
      text: selection.text,
      truncated: selection.truncated,
    }, controller.signal);
    if (currentRequest === requestNumber) {
      result.value = answer;
      completedRun.value += 1;
    }
  } catch (cause) {
    if (currentRequest === requestNumber) {
      error.value = cause instanceof Error && cause.name !== "AbortError"
        ? cause.message
        : "提问已中断，请重试。";
    }
  } finally {
    if (currentRequest === requestNumber) {
      pending.value = false;
      controller = null;
    }
  }
}
</script>

<template>
  <section class="panel research-card">
    <div class="panel-heading">
      <span class="step-number">03</span>
      <span class="eyebrow">提出问题</span>
    </div>
    <form @submit.prevent="submit">
      <label for="research-question">你想知道什么？</label>
      <textarea
        id="research-question"
        v-model="question"
        :disabled="pending"
        :placeholder="confirmed ? '例如：这段话在实际开发中怎么用？' : '先确认上方的网页选区，再输入问题'"
        rows="4"
      />
      <button type="submit" class="primary-button submit-button" :disabled="!confirmed || !question.trim() || pending">
        {{ pending ? "正在研究，请稍候…" : "开始研究 →" }}
      </button>
    </form>
    <div v-if="pending" class="working-state" role="status">
      <span class="working-indicator" aria-hidden="true" />
      <span>正在查找资料并生成回答，完成后会显示在这里。</span>
    </div>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>

    <div v-if="result && submittedContext" class="research-result">
      <div class="result-heading">
        <span class="result-mark" aria-hidden="true">✦</span>
        <div>
          <span class="eyebrow">研究结果</span>
          <h2>给你的回答</h2>
        </div>
      </div>
      <AnswerContent class="answer-text" :content="result.answer" :sources="sources" @citations-changed="citedSourceIds = $event" />

      <details class="source-group">
        <summary>查看参考资料 <span>{{ sources.length }} 项</span></summary>
        <p class="source-note">已引用表示正文使用了该编号；是否真正支持结论，请查看片段或原网页核对。</p>
        <p v-if="!sources.length" class="source-note">本次未返回来源编号，无法生成行内引用。请确认后端已更新。</p>
        <details v-for="(source, index) in sources" :key="source.id" class="source-item">
          <summary>
            <span class="source-type">[{{ index + 1 }}] {{ source.kind === 'selection' ? '当前选区' : source.kind === 'note' ? '个人笔记' : '联网资料' }}</span>
            {{ source.title }}
            <span v-if="citedSourceIds.includes(source.id)" class="cited-tag">已引用</span>
          </summary>
          <p v-if="source.evidence === 'search-result'" class="source-note">搜索结果 · 原文未核对</p>
          <p v-else-if="source.evidence === 'page-text'" class="source-note">已读取网页正文</p>
          <p v-if="source.excerpt" class="selection-text">{{ source.excerpt }}</p>
          <a v-if="isWebUrl(source.url)" :href="source.url" target="_blank" rel="noopener noreferrer">打开原网页 ↗</a>
        </details>
      </details>
      <p v-if="result.knowledgeSearchFailed" class="source-warning">个人笔记检索失败。</p>
      <p v-if="result.webSearchFailed" class="source-warning">联网搜索失败。</p>
      <p v-if="result.webPageReadFailed" class="source-warning">网页原文读取失败。</p>

      <KnowledgeSave
        :key="completedRun"
        :answer="result.answer"
        :question="submittedQuestion"
        :source-title="submittedContext.title"
        :source-url="submittedContext.url"
        :source-definitions="noteDefinitions"
        @saved="emit('saved', $event)"
      />
    </div>
  </section>
</template>

<style scoped>
.research-card { margin-top: 12px; }
.research-card > form { display: grid; gap: 9px; }
.research-card .submit-button { margin-top: 4px; }
.working-state { display: flex; gap: 9px; align-items: flex-start; margin-top: 13px; padding: 11px; border-radius: 9px; background: #edf6f0; color: #3e6a55; font-size: 11px; line-height: 1.5; }
.working-indicator { width: 9px; height: 9px; flex: 0 0 9px; margin-top: 3px; border: 2px solid #85b9a0; border-top-color: #207a5c; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.research-result { margin-top: 20px; padding-top: 18px; border-top: 1px solid #e7eee8; }
.result-heading { display: flex; align-items: center; gap: 10px; }
.result-heading h2 { margin: 3px 0 0; }
.result-mark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: #e6f3e8; color: #20835e; font-size: 19px; }
.answer-text { margin: 16px 0; }
.source-group { border-top: 1px solid #e7eee8; padding-top: 12px; }
.source-group > summary { display: flex; align-items: center; gap: 7px; cursor: pointer; color: #285f52; font-size: 12px; font-weight: 700; }
.source-group > summary::before { content: '+'; color: #7fa18d; }
.source-group[open] > summary::before { content: '−'; }
.source-group > summary span { margin-left: auto; color: #8a9b90; font-size: 11px; font-weight: 500; }
.source-note { margin: 11px 0; color: #83948b; font-size: 11px; line-height: 1.5; }
.source-item { margin-top: 8px; padding: 10px; border: 1px solid #e5ece6; border-radius: 8px; font-size: 11px; overflow-wrap: anywhere; }
.source-item summary { cursor: pointer; color: #38554b; font-weight: 600; line-height: 1.5; }
.source-item .selection-text { padding: 9px 0; }
.source-type { margin-right: 7px; color: #27836a; font-size: 10px; }
.source-item a { font-size: 11px; text-decoration: none; }
.source-item a:hover { text-decoration: underline; }
.cited-tag { display: inline-block; margin-left: 5px; padding: 0 4px; border-radius: 4px; background: #e7f2e9; color: #277766; font-size: 10px; }
@media (prefers-reduced-motion: reduce) { .working-indicator { animation: none; } }
</style>
