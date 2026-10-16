<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  deleteKnowledgeEntry,
  getKnowledgeEntry,
  listKnowledgeEntries,
  updateKnowledgeEntry,
  type KnowledgeEntry,
} from "./knowledgeApi";

const props = defineProps<{ focusId?: string }>();
defineEmits<{ back: [] }>();

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
  <section class="card knowledge-manager">
    <button type="button" class="secondary" @click="$emit('back')">返回研究提问</button>
    <h2>我的知识</h2>
    <form class="knowledge-filter" @submit.prevent="loadEntries">
      <label for="knowledge-filter">按标题或正文查找</label>
      <input id="knowledge-filter" v-model="filter" type="search" placeholder="输入关键词" />
      <button type="submit" :disabled="loading">{{ loading ? "查找中…" : "查找" }}</button>
    </form>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <p v-if="notice" class="save-success" role="status">{{ notice }}</p>
    <p v-if="loading" class="description" role="status">正在读取笔记…</p>
    <p v-if="!loading && !entries.length" class="description">没有找到笔记。</p>
    <p v-if="entries.length === 50" class="description">这里只显示最近或匹配的前 50 条笔记。</p>
    <ul class="knowledge-list">
      <li v-for="entry in entries" :key="entry.id">
        <button type="button" class="secondary" @click="openEntry(entry.id)">
          {{ entry.title }}
        </button>
      </li>
    </ul>

    <div v-if="selected" class="knowledge-detail">
      <h2>{{ selected.title }}</h2>
      <p v-if="!editing" class="selection-text">{{ selected.content }}</p>
      <p class="description">原问题：{{ selected.originalQuestion }}</p>
      <p class="description">来源：{{ selected.sourceTitle }}</p>
      <a v-if="isWebUrl(selected.sourceUrl)" :href="selected.sourceUrl" target="_blank" rel="noopener noreferrer">打开原网页</a>
      <p class="description">上次修改：{{ new Date(selected.updatedAt).toLocaleString() }}</p>

      <form v-if="editing" class="knowledge-edit" @submit.prevent="saveEdit">
        <label for="edit-knowledge-title">标题</label>
        <input id="edit-knowledge-title" v-model="title" :disabled="busy" type="text" />
        <label for="edit-knowledge-content">正文</label>
        <textarea id="edit-knowledge-content" v-model="content" :disabled="busy" rows="8" />
        <div class="button-row">
          <button type="submit" :disabled="busy || !title.trim() || !content.trim()">
            {{ busy ? "保存中…" : "保存修改" }}
          </button>
          <button type="button" class="secondary" :disabled="busy" @click="editing = false">取消</button>
        </div>
      </form>
      <div v-else class="knowledge-actions">
        <button type="button" @click="startEditing">修改笔记</button>
        <button v-if="!confirmingDelete" type="button" class="secondary" @click="confirmingDelete = true">删除笔记</button>
        <div v-else class="delete-confirm">
          <p>确定删除这条笔记吗？删除后无法恢复。</p>
          <div class="button-row">
            <button type="button" :disabled="busy" @click="removeEntry">{{ busy ? "删除中…" : "确认删除" }}</button>
            <button type="button" class="secondary" :disabled="busy" @click="confirmingDelete = false">取消</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
