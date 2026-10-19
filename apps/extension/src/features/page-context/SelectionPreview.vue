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
  <section class="panel selection-card">
    <div class="panel-heading">
      <span class="step-number">02</span>
      <span class="eyebrow">选中文字</span>
      <span v-if="preview" class="status-tag pending-tag">待确认</span>
      <span v-else-if="confirmed" class="status-tag">已确认</span>
    </div>

    <div v-if="preview" class="selection-block">
      <p class="description">这段文字会作为本次问题的背景。</p>
      <p class="selection-text">{{ preview.text }}</p>
      <p v-if="preview.truncated" class="selection-hint">已截取前 8000 字</p>
      <div class="button-row">
        <button type="button" class="primary-button" @click="$emit('confirm')">使用这段文字</button>
        <button type="button" class="ghost-button" @click="$emit('ignore')">忽略</button>
      </div>
    </div>

    <div v-if="confirmed" class="selection-block">
      <p v-if="preview" class="description">本次提问仍使用下面这段，确认新选区后会替换。</p>
      <p class="selection-text">{{ confirmed.text }}</p>
      <div class="selection-footer">
        <span v-if="confirmed.truncated" class="selection-hint">已截取前 8000 字</span>
        <button type="button" class="text-button" @click="$emit('clear')">清除选区</button>
      </div>
    </div>

    <div v-if="!preview && !confirmed" class="empty-selection">
      <span class="selection-symbol" aria-hidden="true">“ ”</span>
      <p>在网页中选中一段想弄懂的文字</p>
      <span>选中后，这里会先显示预览</span>
    </div>
  </section>
</template>

<style scoped>
.selection-card { margin-top: 12px; }
.status-tag { margin-left: auto; padding: 4px 7px; border-radius: 6px; background: #e9f7ed; color: #20805e; font-size: 10px; font-weight: 700; }
.pending-tag { background: #fff3e5; color: #aa6a2b; }
.selection-block .description { margin-bottom: 10px; }
.selection-block + .selection-block { margin-top: 16px; padding-top: 16px; border-top: 1px solid #edf1ee; }
.selection-block > .selection-text { padding: 12px 14px; border-left: 3px solid #8cc8ac; border-radius: 0 8px 8px 0; background: #f5f9f5; }
.selection-footer { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 8px; }
.selection-hint { margin: 7px auto 0 0; color: #879890; font-size: 11px; }
.empty-selection { padding: 14px 5px 7px; text-align: center; }
.selection-symbol { display: block; color: #b2d4bf; font: 32px/.9 Georgia, serif; }
.empty-selection p { margin: 12px 0 4px; color: #456058; font-size: 12px; font-weight: 600; }
.empty-selection > span:last-child { color: #91a098; font-size: 11px; }
</style>
