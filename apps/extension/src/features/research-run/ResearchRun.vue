<script setup lang="ts">
import { onUnmounted, ref, watch } from "vue";
import type { PageSelection } from "../page-context/useSelectionPreview";
import { runResearch, type ResearchResult } from "./researchApi";

const props = defineProps<{ confirmed: PageSelection | null }>();

const question = ref("");
const result = ref<ResearchResult | null>(null);
const submittedContext = ref<PageSelection | null>(null);
const pending = ref(false);
const error = ref("");
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
  submittedContext.value = null;
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
  submittedContext.value = selection;

  try {
    const answer = await runResearch(text, {
      title: selection.title,
      url: selection.url,
      text: selection.text,
      truncated: selection.truncated,
    }, controller.signal);
    if (currentRequest === requestNumber) result.value = answer;
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
  <section class="card research-card">
    <p class="eyebrow">研究提问</p>
    <h2>问问这段内容</h2>
    <form @submit.prevent="submit">
      <label for="research-question">你的问题</label>
      <textarea
        id="research-question"
        v-model="question"
        :disabled="pending"
        :placeholder="confirmed ? '例如：这段话是什么意思？' : '请先在网页上选中文字并确认'"
        rows="3"
      />
      <button type="submit" :disabled="!confirmed || !question.trim() || pending">
        {{ pending ? "正在等待回答…" : "开始提问" }}
      </button>
    </form>
    <p v-if="pending" class="description result-state" role="status">
      后端正在查找资料并生成回答。完成后会一次显示。
    </p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>

    <div v-if="result && submittedContext" class="research-result">
      <h2>回答</h2>
      <p class="answer-text">{{ result.answer }}</p>

      <h2>参考资料</h2>
      <p class="description">以下资料已提供给回答流程；检索到不代表回答引用了它。</p>
      <details class="source-item">
        <summary>当前选区 · {{ submittedContext.title }}</summary>
        <p class="selection-text">{{ submittedContext.text }}</p>
        <a v-if="isWebUrl(submittedContext.url)" :href="submittedContext.url" target="_blank" rel="noopener noreferrer">打开原网页</a>
      </details>
      <details v-for="note in result.retrievedNotes" :key="note.id" class="source-item">
        <summary>个人笔记 · {{ note.title }}</summary>
        <p class="selection-text">{{ note.content }}</p>
        <a v-if="isWebUrl(note.sourceUrl)" :href="note.sourceUrl" target="_blank" rel="noopener noreferrer">
          打开原网页 · {{ note.sourceTitle }}
        </a>
      </details>
      <details v-if="result.readPage" class="source-item">
        <summary>已阅读网页 · {{ result.readPage.title }}</summary>
        <p class="selection-text">{{ result.readPage.text }}</p>
        <a v-if="isWebUrl(result.readPage.url)" :href="result.readPage.url" target="_blank" rel="noopener noreferrer">打开原网页</a>
      </details>
      <div v-if="result.webSources.length" class="source-item">
        <p class="source-heading">搜索结果（不代表已阅读原文）</p>
        <ul>
          <li v-for="source in result.webSources" :key="source.url">
            <a v-if="isWebUrl(source.url)" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }}</a>
            <span v-else>{{ source.title }}</span>
          </li>
        </ul>
      </div>
      <p v-if="result.knowledgeSearchFailed" class="source-warning">个人笔记检索失败。</p>
      <p v-if="result.webSearchFailed" class="source-warning">联网搜索失败。</p>
      <p v-if="result.webPageReadFailed" class="source-warning">网页原文读取失败。</p>
    </div>
  </section>
</template>
