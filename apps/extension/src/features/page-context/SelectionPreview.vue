<script setup lang="ts">
import type { PageSelection } from "./useSelectionPreview";

defineProps<{
  preview: PageSelection | null;
  confirmed: PageSelection | null;
}>();

defineEmits<{
  confirm: [];
  ignore: [];
  clear: [];
}>();
</script>

<template>
  <section class="card selection-card">
    <p class="eyebrow">网页选区</p>

    <div v-if="preview" class="selection-block">
      <h2>刚选中的内容</h2>
      <p class="description">确认后才会用于下一次提问。</p>
      <p class="selection-text">{{ preview.text }}</p>
      <p v-if="preview.truncated" class="description">内容较长，只保留前 8000 个字。</p>
      <div class="button-row">
        <button type="button" @click="$emit('confirm')">使用这段</button>
        <button type="button" class="secondary" @click="$emit('ignore')">忽略</button>
      </div>
    </div>

    <div v-if="confirmed" class="selection-block">
      <h2>本次提问将使用</h2>
      <p class="selection-text">{{ confirmed.text }}</p>
      <p v-if="confirmed.truncated" class="description">内容较长，只保留前 8000 个字。</p>
      <button type="button" class="secondary" @click="$emit('clear')">清除这段</button>
    </div>

    <p v-if="!preview && !confirmed" class="description">
      在当前网页中选中想研究的内容。
    </p>
  </section>
</template>
