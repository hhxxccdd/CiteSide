<script setup lang="ts">
import { onMounted, ref } from "vue";
import AnswerContent from "../research-run/AnswerContent.vue";
import {
  deleteKnowledgeEntry,
  getKnowledgeEntry,
  listKnowledgeEntries,
  updateKnowledgeEntry,
  type KnowledgeEntry,
} from "./knowledgeApi";

const props = defineProps<{ focusId?: string }>();

const filter = ref("");
const entries = ref<KnowledgeEntry[]>([]);
const selected = ref<KnowledgeEntry | null>(null);
const loading = ref(false);
const busy = ref(false);
const editing = ref(false);
const confirmingDelete = ref(false);
const title = ref("");
const content = ref("");
const error = ref("");
const notice = ref("");
let listRequest = 0;

async function loadEntries(): Promise<void> {
  const request = ++listRequest;
  loading.value = true;
  error.value = "";
  try {
    const items = await listKnowledgeEntries(filter.value);
    if (request === listRequest) entries.value = items;
  } catch (cause) {
    if (request === listRequest) {
      error.value = cause instanceof Error ? cause.message : "读取笔记失败。";
    }
  } finally {
    if (request === listRequest) loading.value = false;
  }
}

async function openEntry(id: string): Promise<void> {
  error.value = "";
  notice.value = "";
  editing.value = false;
  confirmingDelete.value = false;
  try {
    selected.value = await getKnowledgeEntry(id);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "读取笔记失败。";
  }
}

function startEditing(): void {
  if (!selected.value) return;
  title.value = selected.value.title;
  content.value = selected.value.content;
  editing.value = true;
  confirmingDelete.value = false;
  error.value = "";
}

async function saveEdit(): Promise<void> {
  if (!selected.value || busy.value) return;
  if (!title.value.trim() || !content.value.trim()) {
    error.value = "标题和正文都不能为空。";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    selected.value = await updateKnowledgeEntry(selected.value.id, {
      title: title.value.trim(),
      content: content.value.trim(),
    });
    editing.value = false;
    notice.value = "笔记已更新，检索向量也已重新生成。";
    await loadEntries();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "修改笔记失败。";
  } finally {
    busy.value = false;
  }
}

async function removeEntry(): Promise<void> {
  if (!selected.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await deleteKnowledgeEntry(selected.value.id);
    selected.value = null;
    confirmingDelete.value = false;
    notice.value = "笔记已删除。";
    await loadEntries();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "删除笔记失败。";
  } finally {
    busy.value = false;
  }
}

function isWebUrl(url: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

onMounted(async () => {
  await loadEntries();
  if (props.focusId) await openEntry(props.focusId);
});
</script>

<template>
  <section class="knowledge-manager">
    <div class="knowledge-heading">
      <p class="eyebrow">PERSONAL LIBRARY</p>
      <h2>我的知识</h2>
      <p class="description">你整理过的内容，可以在下一次提问时被找回。</p>
    </div>
    <form class="knowledge-filter" @submit.prevent="loadEntries">
      <label for="knowledge-filter">查找笔记</label>
      <input id="knowledge-filter" v-model="filter" type="search" placeholder="输入关键词" />
      <button type="submit" class="primary-button" :disabled="loading">{{ loading ? "查找中…" : "查找" }}</button>
    </form>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <p v-if="notice" class="save-success" role="status">{{ notice }}</p>
    <p v-if="loading" class="description" role="status">正在读取笔记…</p>
    <div v-if="!loading && !entries.length" class="knowledge-empty">
      <span aria-hidden="true">✦</span>
      <p>还没有找到笔记</p>
      <small>读到值得留下的内容，就从一次提问开始。</small>
    </div>
    <div v-if="entries.length" class="list-heading">
      <span>笔记目录</span>
      <span>{{ entries.length }}{{ entries.length === 50 ? "+" : "" }} 条</span>
    </div>
    <p v-if="entries.length === 50" class="description list-limit">这里只显示最近或匹配的前 50 条笔记。</p>
    <ul class="knowledge-list">
      <li v-for="entry in entries" :key="entry.id">
        <button type="button" class="knowledge-list-item" :class="{ selected: selected?.id === entry.id }" @click="openEntry(entry.id)">
          <span class="list-item-title">{{ entry.title }}</span>
          <span class="list-item-meta">{{ entry.sourceTitle }}</span>
          <span class="list-item-arrow" aria-hidden="true">↗</span>
        </button>
      </li>
    </ul>

    <div v-if="selected" class="panel knowledge-detail">
      <div class="panel-heading"><span class="eyebrow">笔记详情</span></div>
      <h2>{{ selected.title }}</h2>
      <AnswerContent v-if="!editing" class="knowledge-content" :content="selected.content" />
      <div class="context-box detail-meta">
        <p><strong>原问题</strong>{{ selected.originalQuestion }}</p>
        <p><strong>来源</strong>{{ selected.sourceTitle }}</p>
        <a v-if="isWebUrl(selected.sourceUrl)" :href="selected.sourceUrl" target="_blank" rel="noopener noreferrer">打开原网页 ↗</a>
        <p class="updated-at">更新于 {{ new Date(selected.updatedAt).toLocaleString() }}</p>
      </div>

      <form v-if="editing" class="knowledge-edit" @submit.prevent="saveEdit">
        <label for="edit-knowledge-title">标题</label>
        <input id="edit-knowledge-title" v-model="title" :disabled="busy" type="text" />
        <label for="edit-knowledge-content">正文</label>
        <textarea id="edit-knowledge-content" v-model="content" :disabled="busy" rows="8" />
        <div class="button-row">
          <button type="submit" class="primary-button" :disabled="busy || !title.trim() || !content.trim()">
            {{ busy ? "保存中…" : "保存修改" }}
          </button>
          <button type="button" class="ghost-button" :disabled="busy" @click="editing = false">取消</button>
        </div>
      </form>
      <div v-else class="knowledge-actions">
        <button type="button" class="secondary-button" @click="startEditing">编辑笔记</button>
        <button v-if="!confirmingDelete" type="button" class="text-button danger-text" @click="confirmingDelete = true">删除笔记</button>
        <div v-else class="delete-confirm">
          <p>确定删除这条笔记吗？删除后无法恢复。</p>
          <div class="button-row">
            <button type="button" class="danger-button" :disabled="busy" @click="removeEntry">{{ busy ? "删除中…" : "确认删除" }}</button>
            <button type="button" class="ghost-button" :disabled="busy" @click="confirmingDelete = false">取消</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.knowledge-manager { padding: 2px 18px 30px; }
.knowledge-filter, .knowledge-edit { display: grid; gap: 9px; }
.knowledge-heading { padding: 13px 2px 17px; }
.knowledge-heading h2 { margin: 7px 0 5px; font-size: 22px; }
.knowledge-filter { grid-template-columns: 1fr auto; padding: 15px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.knowledge-filter label { grid-column: 1 / -1; }
.knowledge-filter button { width: 67px; }
.knowledge-empty { margin-top: 14px; padding: 35px 14px; border: 1px dashed #cbded0; border-radius: 12px; color: #7f9887; text-align: center; }
.knowledge-empty > span { font-size: 25px; }
.knowledge-empty p { margin: 10px 0 4px; color: #4e695a; font-weight: 700; }
.knowledge-empty small { font-size: 11px; line-height: 1.5; }
.list-heading { display: flex; justify-content: space-between; margin: 20px 2px 9px; color: #4b6859; font-size: 11px; font-weight: 700; }
.list-heading span:last-child { color: #84978b; font-weight: 500; }
.list-limit { margin: 0 2px 8px; }
.knowledge-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.knowledge-list-item { position: relative; display: grid; gap: 4px; width: 100%; padding: 12px 30px 12px 13px; border: 1px solid #e1eae3; border-radius: 10px; background: var(--surface); text-align: left; }
.knowledge-list-item:hover, .knowledge-list-item.selected { border-color: #7cbea0; background: #f9fcf9; }
.list-item-title { color: #314d40; font-size: 12px; font-weight: 700; overflow-wrap: anywhere; }
.list-item-meta { color: #90a094; font-size: 10px; overflow-wrap: anywhere; }
.list-item-arrow { position: absolute; top: 14px; right: 13px; color: #7caa91; }
.knowledge-detail { margin-top: 18px; padding: 18px; }
.knowledge-detail h2 { font-size: 17px; }
.knowledge-content { max-height: 400px; overflow: auto; margin: 0 0 16px; }
.detail-meta a { display: inline-block; margin-top: 7px; font-size: 11px; text-decoration: none; }
.detail-meta .updated-at { margin-top: 8px; color: #9aa89d; font-size: 10px; }
.knowledge-edit { margin-top: 16px; }
.knowledge-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 15px; }
.knowledge-actions > .secondary-button { width: auto; flex: 1; }
.knowledge-actions > .text-button { white-space: nowrap; }
.danger-text { color: #ad5147; }
.delete-confirm { width: 100%; padding: 12px; border: 1px solid #e9c6bf; border-radius: 9px; background: #fff8f6; }
.delete-confirm p { margin: 0 0 11px; color: #8d463b; font-size: 12px; }
@media (max-width: 360px) { .knowledge-manager { padding-inline: 12px; } }
</style>
