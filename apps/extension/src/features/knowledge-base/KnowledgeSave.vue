<script setup lang="ts">
import { ref } from "vue";
import { createKnowledgeEntry } from "./knowledgeApi";

const props = defineProps<{
  answer: string;
  question: string;
  sourceTitle: string;
  sourceUrl: string;
}>();

const editing = ref(false);
const title = ref(props.question);
const content = ref(props.answer);
const saving = ref(false);
const savedId = ref("");
const error = ref("");

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
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "保存失败，请重试。";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="knowledge-save">
    <p v-if="savedId" class="save-success" role="status">已保存到个人知识库。笔记 ID：{{ savedId }}</p>
    <button v-else-if="!editing" type="button" @click="editing = true">保存到知识库</button>
    <form v-else @submit.prevent="save">
      <h2>整理成笔记</h2>
      <p class="description">只有点击“确认保存”后，内容才会写入知识库。</p>
      <label for="knowledge-title">标题</label>
      <input id="knowledge-title" v-model="title" :disabled="saving" type="text" />
      <label for="knowledge-content">正文</label>
      <textarea id="knowledge-content" v-model="content" :disabled="saving" rows="8" />
      <p class="description">原问题：{{ question }}</p>
      <p class="description">来源：{{ sourceTitle }} · {{ sourceUrl }}</p>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <div class="button-row">
        <button type="submit" :disabled="saving || !title.trim() || !content.trim()">
          {{ saving ? "正在保存…" : "确认保存" }}
        </button>
        <button type="button" class="secondary" :disabled="saving" @click="editing = false">
          暂不保存
        </button>
      </div>
    </form>
  </div>
</template>
