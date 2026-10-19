<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef } from "vue";
import type { PageSnapshot } from "../page-context/pageContext.types";
import { runResearch, type ResearchContext, type ResearchResult, type ResearchOptions } from "./researchApi";
import KnowledgeSave from "../knowledge-base/KnowledgeSave.vue";
import AnswerContent from "./AnswerContent.vue";
import SourceExcerpt from "./SourceExcerpt.vue";
import { editableMarkdown } from "./answerMarkdown";
import MaterialPicker from "../research-materials/MaterialPicker.vue";
import MaterialList from "../research-materials/MaterialList.vue";
import { useResearchMaterials } from "../research-materials/useResearchMaterials";
import type { MaterialChoice } from "../research-materials/material.types";
import type { CompletedResearch, ResearchWorkspace } from "./researchSession";
import { useResearchWorkspace } from "./useResearchWorkspace";
import type { KnowledgeDraft } from "../knowledge-base/knowledgeDraft.types";

const props = defineProps<{ context: PageSnapshot | null }>();
const emit = defineEmits<{ saved: [id: string]; openNote: [id: string] }>();
const question = ref("");
const result = ref<ResearchResult | null>(null);
const submittedPages = ref<ResearchContext[]>([]);
const submittedQuestion = ref("");
const useCurrentPage = ref(true);
const searchKnowledgeBase = ref(true);
const allowWebSearch = ref(false);
const submittedOptions = ref<ResearchOptions | null>(null);
const pickerOpen = ref(false);
const materials = useResearchMaterials(() => useCurrentPage.value ? props.context : null);
const { items, noteIds, hasUnready, selectedUrls } = materials;
const requestPages = computed(() => materials.pages());
const transferTooLarge = computed(() => requestPages.value.reduce((size, page) => size + new TextEncoder().encode(page.text).byteLength, 0) > 8 * 1024 * 1024);
const completedRun = ref(0);
const pending = ref(false);
// 请求失败或页面卸载前，保留“未完成”标记；不能用 loading 状态代表任务已完成。
const unfinishedRun = ref(false);
const error = ref("");
const completed = shallowRef<CompletedResearch | null>(null);
const noteDraft = ref<KnowledgeDraft | null>(null);
const citedSourceIds = ref<string[]>([]);
const sources = computed(() => result.value?.sources ?? []);
const noteContent = computed(() => editableMarkdown(result.value?.answer ?? "", sources.value));
const canSubmit = computed(() => Boolean(question.value.trim()) && !pending.value && !restoring.value &&
  (!useCurrentPage.value || props.context !== null) && !hasUnready.value && selectedUrls.value.length <= 3 && !transferTooLarge.value &&
  (requestPages.value.length > 0 || noteIds.value.length > 0 || searchKnowledgeBase.value || allowWebSearch.value));
const answerScope = computed(() => [
  submittedPages.value.length ? `${submittedPages.value.length} 篇网页` : "",
  result.value?.specifiedNotes?.length ? `${result.value.specifiedNotes.length} 条指定笔记` : "",
  submittedOptions.value?.searchKnowledgeBase ? "搜索个人知识库" : "",
  submittedOptions.value?.allowWebSearch ? "允许联网" : "",
].filter(Boolean).join(" · "));
const primarySource = computed(() => submittedPages.value[0] ?? sources.value.find((source) =>
  source.kind === "web" && source.evidence === "page-text") ?? null);
let controller: AbortController | null = null;
let requestNumber = 0;

const { restoring, notice: sessionNotice, flush: flushWorkspace } = useResearchWorkspace({
  capture: () => ({
    draft: { question: question.value, useCurrentPage: useCurrentPage.value,
      options: { searchKnowledgeBase: searchKnowledgeBase.value, allowWebSearch: allowWebSearch.value }, materials: items.value },
    completed: completed.value,
    noteDraft: result.value && noteDraft.value ? { runId: result.value.runId, value: noteDraft.value } : null,
    unfinishedRun: unfinishedRun.value,
  }),
  restore: restoreWorkspace,
});

function restoreWorkspace(workspace: ResearchWorkspace): void {
  const saved = workspace.completed;
  completed.value = saved;
  if (saved) {
    result.value = saved.result;
    submittedPages.value = saved.pages.map((page) => ({ ...page, completeness: "full" as const }));
    submittedQuestion.value = saved.question;
    question.value = saved.question;
    submittedOptions.value = saved.options ?? null;
    if (saved.options) {
      useCurrentPage.value = saved.usedCurrentPage;
      searchKnowledgeBase.value = saved.options.searchKnowledgeBase;
      allowWebSearch.value = saved.options.allowWebSearch;
    }
    materials.restore(saved.usedCurrentPage ? saved.pages.slice(1) : saved.pages, saved.result.specifiedNotes ?? []);
    completedRun.value += 1;
  }
  if (workspace.draft) {
    question.value = workspace.draft.question;
    useCurrentPage.value = workspace.draft.useCurrentPage;
    searchKnowledgeBase.value = workspace.draft.options.searchKnowledgeBase;
    allowWebSearch.value = workspace.draft.options.allowWebSearch;
    items.value = workspace.draft.materials;
  }
  if (workspace.noteDraft?.runId === saved?.result.runId) noteDraft.value = workspace.noteDraft?.value ?? null;
  if (workspace.unfinishedRun) error.value = "上次研究未完成，未自动重发。问题和资料已保留，可点击开始研究重试。";
}

// 切页不会卸载本组件，也不会修改已提交的正文快照。
onUnmounted(() => { requestNumber += 1; controller?.abort(); });

function isWebUrl(url: string): boolean {
  try { return ["http:", "https:"].includes(new URL(url).protocol); }
  catch { return false; }
}

async function submit(): Promise<void> {
  const page = useCurrentPage.value ? props.context : null;
  const text = question.value.trim();
  if (!canSubmit.value || page && page.completeness !== "full") return;

  const snapshots = requestPages.value.map((item) => ({ ...item }));
  const pages: ResearchContext[] = snapshots.map((item) => ({
    title: item.title, url: item.url, text: item.text, capturedAt: item.capturedAt, completeness: "full",
  }));
  const usedCurrentPage = useCurrentPage.value;
  const selectedNoteIds = [...noteIds.value];
  const options: ResearchOptions = {
    searchKnowledgeBase: searchKnowledgeBase.value, allowWebSearch: allowWebSearch.value,
  };
  controller?.abort();
  const requestController = new AbortController();
  controller = requestController;
  const currentRequest = ++requestNumber;
  pending.value = true;
  unfinishedRun.value = true;
  error.value = "";
  try {
    await flushWorkspace();
    if (currentRequest !== requestNumber) return;
    if (page) {
      const currentWindow = await chrome.windows.getCurrent();
      const [tab] = await chrome.tabs.query({ active: true, windowId: currentWindow.id });
      if (currentRequest !== requestNumber) return;
      if (tab?.id !== page.tabId || tab.url !== page.url || tab.status === "loading" || props.context?.id !== page.id) {
        throw new Error("网页已变化，请等待当前网页正文读取完成后再提问。");
      }
    }
    const answer = await runResearch(text, { pages, noteIds: selectedNoteIds }, options, requestController.signal);
    if (currentRequest !== requestNumber) return;
    result.value = answer;
    submittedPages.value = pages;
    submittedQuestion.value = text;
    submittedOptions.value = options;
    noteDraft.value = null;
    completed.value = { question: text, pages: snapshots, usedCurrentPage, options, result: answer };
    completedRun.value += 1;
    pending.value = false;
    unfinishedRun.value = false;
    await flushWorkspace();
  } catch (cause) {
    if (currentRequest === requestNumber) {
      error.value = cause instanceof Error && cause.name !== "AbortError" ? cause.message : "提问已中断，请重试。";
    }
  } finally {
    if (currentRequest === requestNumber) { pending.value = false; controller = null; }
  }
}
function onQuestionInput(event: Event): void {
  if (event instanceof InputEvent && event.isComposing) return;
  const input = event.target as HTMLTextAreaElement;
  const cursor = input.selectionStart;
  if (input.value[cursor - 1] === "@" && (cursor === 1 || /\s/.test(input.value[cursor - 2]))) {
    question.value = input.value.slice(0, cursor - 1) + input.value.slice(cursor);
    pickerOpen.value = true;
  }
}

function selectMaterial(choice: MaterialChoice): void { void materials.add(choice); }
</script>

<template>
  <section class="panel research-card">
    <slot name="page-context" :included="useCurrentPage" />
    <div class="panel-heading">
      <span class="eyebrow">提出问题</span>
    </div>
    <MaterialList :items="items" :disabled="pending || restoring" @remove="materials.remove" @retry="materials.read" />
    <p v-if="materials.notice.value" class="source-warning">{{ materials.notice.value }}</p>
    <form @submit.prevent="submit">
      <label for="research-question">你想知道什么？</label>
      <textarea
        id="research-question"
        v-model="question"
        :disabled="pending || restoring"
        :placeholder="useCurrentPage ? '例如：总结这篇文章，并解释它的核心观点' : '例如：我之前保存过哪些关于泛型的笔记？'"
        rows="4"
        maxlength="4000"
        @input="onQuestionInput"
      />
      <button type="button" class="text-button add-material" :disabled="pending || restoring" @click="pickerOpen = true">＋ 添加资料（@）</button>
      <fieldset class="scope-controls" :disabled="pending || restoring">
        <legend>参考范围</legend>
        <label><input v-model="useCurrentPage" role="switch" type="checkbox" /><span class="switch-track" aria-hidden="true" />使用当前网页</label>
        <label><input v-model="searchKnowledgeBase" role="switch" type="checkbox" /><span class="switch-track" aria-hidden="true" />搜索个人知识库</label>
        <label><input v-model="allowWebSearch" role="switch" type="checkbox" /><span class="switch-track" aria-hidden="true" />允许联网</label>
      </fieldset>
      <p v-if="useCurrentPage && !context" class="scope-hint">等待网页读取。也可以关闭“使用当前网页”，只查个人知识库或联网资料。</p>
      <p v-else-if="!useCurrentPage && !items.length && !searchKnowledgeBase && !allowWebSearch" class="scope-hint">请至少选择一种资料范围。</p>
      <p v-if="hasUnready" class="scope-hint">请先完成指定网页的读取，或移除无法读取的资料。</p>
      <p v-if="selectedUrls.length > 3" class="source-warning">最多使用 3 篇网页，请移除一篇资料或关闭当前网页。</p>
      <p v-if="transferTooLarge" class="source-warning">网页正文合计超过 8 MiB 传输容量，请减少本次资料。</p>
      <button type="submit" class="primary-button submit-button" :disabled="!canSubmit">
        {{ pending ? "正在研究，请稍候…" : "开始研究 →" }}
      </button>
    </form>
    <div v-if="pending" class="working-state" role="status">
      <span class="working-indicator" aria-hidden="true" />
      <span>正在查找资料并生成回答，完成后会显示在这里。</span>
    </div>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <p v-if="sessionNotice" class="source-note" role="status">{{ sessionNotice }} <button type="button" class="text-button" @click="flushWorkspace">重试暂存</button></p>

    <MaterialPicker :open="pickerOpen" :selected-urls="selectedUrls" :selected-note-ids="noteIds" @close="pickerOpen = false" @select="selectMaterial" />
    <div v-if="result" class="research-result">
      <div class="result-heading">
        <span class="result-mark" aria-hidden="true">✦</span>
        <div>
          <span class="eyebrow">研究结果</span>
          <h2>给你的回答</h2>
        </div>
      </div>
      <p class="answer-context">{{ submittedPages.length ? submittedPages.map((page) => page.title).join('、') : '本次未使用网页' }} · {{ submittedQuestion }}<br v-if="answerScope" />{{ answerScope }}</p>
      <AnswerContent class="answer-text" :content="result.answer" :sources="sources" @citations-changed="citedSourceIds = $event" @open-note="emit('openNote', $event)" />
      <p v-if="sources.length && !citedSourceIds.length" class="source-warning" role="status">本次回答未提供可核对的正文引用。下方资料仅表示进入过问答流程，不代表支持上述结论；具体数据和“已核实”的说法请先核对原文。</p>

      <details class="source-group">
        <summary>查看参考资料 <span>{{ sources.length }} 项</span></summary>
        <p v-if="citedSourceIds.length" class="source-note">把鼠标放在回答中带下划线的引用文字上，即可查看来源。引用是否支持结论，请核对原文。</p>
        <p v-else-if="sources.length" class="source-note">回答中尚无可核对的引用。你可以展开以下资料核对原文；这里不会替模型给句子指定来源。</p>
        <p v-if="!sources.length" class="source-note">本次没有可预览的来源信息。</p>
        <details v-for="source in sources" :key="source.id" class="source-item">
          <summary>
            <span class="source-type">{{ source.kind === 'page' ? '网页正文' : source.kind === 'note' ? '个人笔记' : '联网资料' }}</span>
            {{ source.title }}
            <span v-if="citedSourceIds.includes(source.id)" class="cited-tag">已引用</span>
          </summary>
          <p v-if="source.evidence === 'search-result'" class="source-note">搜索结果 · 原文未核对</p>
          <p v-else-if="source.evidence === 'page-text'" class="source-note">已读取网页正文</p>
          <SourceExcerpt v-if="source.excerpt" class="source-excerpt" :content="source.excerpt" />
          <button v-if="source.noteId" type="button" class="text-button" @click="emit('openNote', source.noteId)">查看笔记</button>
          <a v-if="isWebUrl(source.url)" :href="source.url" target="_blank" rel="noopener noreferrer">打开原网页 ↗</a>
        </details>
      </details>
      <p v-if="result.knowledgeSearchFailed" class="source-warning">个人笔记检索失败。</p>
      <p v-if="result.webSearchFailed" class="source-warning">联网搜索失败。</p>
      <p v-if="result.webPageReadFailed" class="source-warning">网页原文读取失败。</p>

      <KnowledgeSave
        :key="completedRun"
        :draft="noteDraft"
        :answer="noteContent"
        :question="submittedQuestion"
        :source-title="primarySource?.title ?? ''"
        :source-url="primarySource?.url ?? ''"
        @update:draft="noteDraft = $event"
        @saved="emit('saved', $event)"
      />
    </div>
  </section>
</template>

<style scoped>
.research-card { margin-top: 12px; }
.research-card > form { display: grid; gap: 9px; }
.add-material { justify-self: start; margin: 0 0 2px; }
.research-card .submit-button { margin-top: 4px; }
.scope-controls { display: flex; flex-wrap: wrap; gap: 12px; margin: 3px 0 5px; padding: 0; border: 0; }
.scope-controls legend { margin-bottom: 8px; color: var(--muted); font-size: 11px; }
.scope-controls label { position: relative; display: inline-flex; gap: 6px; align-items: center; font-size: 11px; font-weight: 500; cursor: pointer; }
.scope-controls input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.switch-track { width: 30px; height: 18px; flex: 0 0 30px; border-radius: 12px; background: #c8d2cc; transition: background .15s; }
.switch-track::after { content: ''; display: block; width: 14px; height: 14px; margin: 2px; border-radius: 50%; background: white; box-shadow: 0 1px 3px #173b2b26; transition: transform .15s; }
.scope-controls input:checked + .switch-track { background: var(--accent); }
.scope-controls input:checked + .switch-track::after { transform: translateX(12px); }
.scope-controls input:focus-visible + .switch-track { outline: 2px solid #30a17a; outline-offset: 3px; }
.scope-controls:disabled label { opacity: .55; cursor: not-allowed; }
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
.source-item .source-excerpt { max-height: 190px; overflow: auto; padding: 9px 0; }
.source-type { margin-right: 7px; color: #27836a; font-size: 10px; }
.source-item a { font-size: 11px; text-decoration: none; }
.source-item a:hover { text-decoration: underline; }
.cited-tag { display: inline-block; margin-left: 5px; padding: 0 4px; border-radius: 4px; background: #e7f2e9; color: #277766; font-size: 10px; }
@media (prefers-reduced-motion: reduce) { .working-indicator { animation: none; } }
</style>
