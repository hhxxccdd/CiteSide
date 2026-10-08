<script setup lang="ts">
import { onMounted, ref } from 'vue';

type ConnectionState = 'checking' | 'ready' | 'unavailable';
const connection = ref<ConnectionState>('checking');

async function checkConnection(): Promise<void> {
  connection.value = 'checking';
  try {
    const response = await fetch('http://127.0.0.1:3000/api/health');
    connection.value = response.ok ? 'ready' : 'unavailable';
  } catch {
    connection.value = 'unavailable';
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
      <p class="eyebrow">项目状态</p>
      <h2>框架已就位</h2>
      <p class="description">阅读、问答和资料收藏功能将在下一步加入。</p>
      <div class="status">
        <span class="dot" :class="connection" />
        <span v-if="connection === 'checking'">正在检查本地服务…</span>
        <span v-else-if="connection === 'ready'">本地服务和数据库已连接</span>
        <span v-else>本地服务或数据库未连接</span>
      </div>
      <button type="button" @click="checkConnection">重新检查</button>
    </section>

    <footer>ResearchFlow · 本地开发版</footer>
  </main>
</template>

