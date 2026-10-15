<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useSelectionPreview } from "./features/page-context/useSelectionPreview";
import SelectionPreview from "./features/page-context/SelectionPreview.vue";

const {
  page,
  preview,
  confirmed,
  unavailable,
  confirmPreview,
  ignorePreview,
  clearConfirmed,
} = useSelectionPreview();

type ConnectionState = "checking" | "ready" | "unavailable";
const connection = ref<ConnectionState>("checking");

async function checkConnection(): Promise<void> {
  connection.value = "checking";
  try {
    const response = await fetch("http://127.0.0.1:3000/api/health");
    connection.value = response.ok ? "ready" : "unavailable";
  } catch {
    connection.value = "unavailable";
  }
}

onMounted(checkConnection);
</script>

<template>
  <main class="shell">
    <header class="header">
      <span class="mark">R</span>
      <div>
        <h1>ResearchFlow</h1>
        <p>技术资料研究侧栏</p>
      </div>
    </header>

    <section class="card">
      <p class="eyebrow">本地服务</p>
      <h2>选区预览已可使用</h2>
      <p class="description">提问和知识库功能还在开发中。</p>
      <div class="status">
        <span class="dot" :class="connection" />
        <span v-if="connection === 'checking'">正在检查本地服务…</span>
        <span v-else-if="connection === 'ready'">本地服务和数据库已连接</span>
        <span v-else>本地服务或数据库未连接</span>
      </div>
      <button type="button" @click="checkConnection">重新检查</button>
    </section>

    <section class="card selection-card">
      <p class="eyebrow">当前网页</p>
      <template v-if="page">
        <h2>{{ page.title }}</h2>
        <p class="description selection-url">{{ page.url }}</p>
      </template>
      <p v-else-if="unavailable" class="description">
        此页面无法读取，请打开普通网页后再试。
      </p>
      <p v-else class="description">正在读取当前网页…</p>
    </section>

    <SelectionPreview
      v-if="page"
      :preview="preview"
      :confirmed="confirmed"
      @confirm="confirmPreview"
      @ignore="ignorePreview"
      @clear="clearConfirmed"
    />

    <footer>ResearchFlow · 本地开发版</footer>
  </main>
</template>
