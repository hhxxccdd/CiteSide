<script setup lang="ts">
import { useCurrentPage } from "./useCurrentPage";

const { page, snapshot, state, notice, tabsAccess, read, refresh, authorize, authorizeTabs } = useCurrentPage();
const labels = {
  loading: "正在加载", available: "可以读取", "needs-permission": "需要授权", reading: "正在读取",
  ready: "正文已就绪", partial: "正文超过上限", empty: "未找到正文", unsupported: "此页面不支持", failed: "读取失败",
};
</script>

<template>
  <section class="panel current-page-card" aria-label="当前网页正文">
    <div class="panel-heading">
      <span class="eyebrow">正在浏览</span>
      <span class="read-state" role="status">{{ labels[state] }}</span>
    </div>
    <h2 v-if="page">{{ page.title }}</h2>
    <p v-if="page?.url" class="page-url">{{ page.url }}</p>
    <p v-if="state === 'loading'" class="description">等待网页加载完成…</p>
    <p v-else-if="state === 'unsupported'" class="description">请打开普通技术文章。浏览器内部页、PDF 等暂不支持。</p>
    <p v-else-if="state === 'reading'" class="description">正在提取文章正文，网页内容不会被修改。</p>
    <p v-if="notice" class="read-notice" role="status">{{ notice }}</p>

    <template v-if="snapshot">
      <p class="read-meta">{{ snapshot.totalCharacters.toLocaleString() }} 字符 · {{ snapshot.extraction === 'article' ? '文章正文' : '清理后的可见文字' }}</p>
      <p v-if="snapshot.completeness === 'partial'" class="source-warning">
        正文超过 {{ snapshot.text.length.toLocaleString() }} 字符，目前仅预览开头部分，不能视为完整文章。
      </p>
      <p v-if="snapshot.extraction === 'visible-text'" class="description">这是降级读取的文字，可能包含文章以外的内容，请检查预览。</p>
      <details :key="snapshot.id" class="body-preview">
        <summary>查看正文预览</summary>
        <pre>{{ snapshot.text }}</pre>
      </details>
    </template>

    <div v-if="state !== 'loading' && state !== 'unsupported' && state !== 'reading'" class="button-row">
      <button v-if="page && !page.url && !tabsAccess" type="button" class="secondary-button" @click="authorizeTabs">允许显示标签页信息</button>
      <button v-else-if="state === 'needs-permission' && page?.url" type="button" class="secondary-button" @click="authorize">授权并读取此站点</button>
      <button v-else type="button" class="ghost-button" @click="page?.url ? read() : refresh()">{{ snapshot ? '重新读取' : '重试读取' }}</button>
      <button v-if="state === 'empty' || state === 'failed'" type="button" class="ghost-button" @click="read(true)">尝试可见文字</button>
    </div>
    <button v-if="state === 'unsupported'" type="button" class="text-button" @click="refresh">刷新页面信息</button>
    <p class="stage-note">正文预览暂不参与下方提问；这一阶段只验证读取，不发送给模型、不自动保存。</p>
  </section>
</template>

<style scoped>
.current-page-card { margin-bottom: 14px; }
.panel-heading { justify-content: space-between; gap: 12px; }
.read-state { color: var(--muted); font-size: 11px; }
h2 { font-size: 16px; overflow-wrap: anywhere; }
.page-url { margin: 0 0 12px; color: #85938d; font-size: 11px; overflow-wrap: anywhere; }
.read-meta { margin: 12px 0; font-size: 12px; color: #38725f; }
.read-notice { color: #996037; font-size: 12px; line-height: 1.6; }
.body-preview { margin-top: 12px; border-top: 1px solid var(--border); padding-top: 12px; }
summary { cursor: pointer; color: var(--accent); font-size: 12px; }
pre { max-height: 280px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; font-size: 12px; line-height: 1.8; color: #3a5049; }
.stage-note { margin: 14px 0 0; font-size: 11px; line-height: 1.6; color: var(--muted); }
</style>
