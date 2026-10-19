<script setup lang="ts">
import type { BrowserPage, PageReadState } from "./pageContext.types";

defineProps<{ page: BrowserPage | null; state: PageReadState; notice: string; tabsAccess: boolean }>();
defineEmits<{ read: [fallback: boolean]; refresh: []; authorize: []; authorizeTabs: [] }>();
const labels = {
  loading: "正在加载", available: "可以读取", "needs-permission": "需要授权", reading: "正在读取",
  ready: "已读取网页正文", partial: "超过传输容量", empty: "未找到正文", unsupported: "此页面不支持", failed: "读取失败",
};
</script>

<template>
  <div class="current-page-context" role="region" aria-label="当前网页">
    <div class="panel-heading">
      <span class="eyebrow">正在浏览</span>
      <span class="read-state" role="status">{{ labels[state] }}</span>
    </div>
    <h2 v-if="page">{{ page.title }}</h2>
    <p v-if="page?.url" class="page-url">{{ page.url }}</p>
    <p v-if="state === 'loading'" class="description">等待网页加载完成…</p>
    <p v-else-if="state === 'unsupported'" class="description">请打开普通技术文章。浏览器内部页、PDF 等暂不支持。</p>
    <p v-else-if="state === 'reading'" class="description">正在读取网页正文…</p>
    <p v-if="notice" class="read-notice" role="status">{{ notice }}</p>
    <p v-if="state === 'ready'" class="description">已准备好网页正文，可以直接提问。</p>
    <p v-if="state === 'partial'" class="source-warning">网页正文超过单次 8 MiB 传输容量，暂时无法提交。正文没有被截取后发送。</p>

    <div v-if="state !== 'loading' && state !== 'unsupported' && state !== 'reading'" class="page-actions">
      <button v-if="page && !page.url && !tabsAccess" type="button" class="secondary-button" @click="$emit('authorizeTabs')">允许显示标签页信息</button>
      <button v-else-if="state === 'needs-permission' && page?.url" type="button" class="secondary-button" @click="$emit('authorize')">授权并读取此站点</button>
      <button v-else type="button" class="text-button" @click="page?.url ? $emit('read', false) : $emit('refresh')">{{ state === 'ready' || state === 'partial' ? '重新读取' : '重试读取' }}</button>
      <button v-if="state === 'empty' || state === 'failed'" type="button" class="text-button" @click="$emit('read', true)">尝试可见文字</button>
    </div>
    <button v-if="state === 'unsupported'" type="button" class="text-button" @click="$emit('refresh')">刷新页面信息</button>
  </div>
</template>

<style scoped>
.current-page-context { padding-bottom: 16px; margin-bottom: 17px; border-bottom: 1px solid var(--border); }
.panel-heading { justify-content: space-between; gap: 12px; }
.read-state { color: var(--muted); font-size: 11px; }
h2 { font-size: 16px; overflow-wrap: anywhere; }
.page-url { margin: 0 0 12px; color: #85938d; font-size: 11px; overflow-wrap: anywhere; }
.read-notice { color: #996037; font-size: 12px; line-height: 1.6; }
.page-actions { display: flex; gap: 12px; margin-top: 9px; }
</style>
