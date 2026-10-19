<script setup lang="ts">
import { ref, watch } from "vue";
import { createKnowledgeEntry } from "./knowledgeApi";
import type { KnowledgeDraft } from "./knowledgeDraft.types";

const props = defineProps<{
  answer: string;
  question: string;
  sourceTitle: string;
  sourceUrl: string;
  draft?: KnowledgeDraft | null;
}>();
const emit = defineEmits<{ saved: [id: string]; "update:draft": [draft: KnowledgeDraft] }>();

const editing = ref(props.draft?.editing ?? false);
const title = ref(props.draft?.title ?? props.question);
const content = ref(props.draft?.content ?? props.answer);
const saving = ref(false);
const savedId = ref(props.draft?.savedId ?? "");
const error = ref("");

watch([editing, title, content, savedId], () => {
  emit("update:draft", { editing: editing.value, title: title.value, content: content.value, savedId: savedId.value });
});

async function save(): Promise<void> {
  if (saving.value || savedId.value) return;
  if (!title.value.trim() || !content.value.trim()) {
    error.value = "标题和正文都不能为空。";
    return;
  }

  saving.value = true;
  error.value = "";
  try {
    savedId.value = await createKnowledgeEntry({
      title: title.value.trim(),
      content: content.value.trim(),
      originalQuestion: props.question,
      sourceTitle: props.sourceTitle,
      sourceUrl: props.sourceUrl,
    });
    editing.value = false;
    emit("saved", savedId.value);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "保存失败，请重试。";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="knowledge-save">
    <p v-if="savedId" class="save-success" role="status">已保存到个人知识库</p>
    <button v-else-if="!editing" type="button" class="save-entry-button" @click="editing = true">
      <span aria-hidden="true">＋</span>
      <span>整理成自己的笔记</span>
      <span aria-hidden="true">→</span>
    </button>
    <form v-else @submit.prevent="save">
      <div class="panel-heading"><span class="eyebrow">保存到知识库</span></div>
      <h2>留下你真正想记住的内容</h2>
      <p class="description">先修改标题和正文，确认后才会保存。</p>
      <label for="knowledge-title">标题</label>
      <input id="knowledge-title" v-model="title" :disabled="saving" type="text" />
      <label for="knowledge-content">正文</label>
      <textarea id="knowledge-content" v-model="content" :disabled="saving" rows="8" />
      <div class="context-box save-context">
        <p><strong>原问题</strong>{{ question }}</p>
        <p><strong>主要网页来源</strong>{{ sourceTitle || '本次没有设置网页来源' }}</p>
        <p v-if="sourceUrl" class="context-url">{{ sourceUrl }}</p>
      </div>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <div class="button-row">
        <button type="submit" class="primary-button" :disabled="saving || !title.trim() || !content.trim()">
          {{ saving ? "正在保存…" : "确认保存" }}
        </button>
        <button type="button" class="ghost-button" :disabled="saving" @click="editing = false">
          暂不保存
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.knowledge-save { margin-top: 16px; padding-top: 15px; border-top: 1px solid #e7eee8; }
.save-entry-button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 12px; border: 1px solid #b8d6c3; border-radius: 9px; background: #edf6ee; color: #206e57; text-align: left; font-size: 12px; font-weight: 700; }
.save-entry-button span:first-child { font-size: 17px; }
.save-entry-button span:last-child { margin-left: auto; }
.save-entry-button:hover { background: #e3f1e6; }
.knowledge-save h2 { margin: 0; font-size: 15px; }
.knowledge-save form { display: grid; gap: 9px; }
.save-context .context-url { color: #8a9b91; }
</style>
