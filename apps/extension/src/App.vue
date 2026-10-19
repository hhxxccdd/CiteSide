<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useCurrentPage } from "./features/page-context/useCurrentPage";
import CurrentPageCard from "./features/page-context/CurrentPageCard.vue";
import ResearchRun from "./features/research-run/ResearchRun.vue";
import KnowledgeManager from "./features/knowledge-base/KnowledgeManager.vue";

const {
  page,
  snapshot, state, notice, tabsAccess, read, refresh, authorize, authorizeTabs,
} = useCurrentPage();

type ConnectionState = "checking" | "ready" | "unavailable";
const connection = ref<ConnectionState>("checking");
const view = ref<"research" | "knowledge">("research");
const focusKnowledgeId = ref("");
const knowledgeOpenNumber = ref(0);

function openKnowledge(id = ""): void {
  focusKnowledgeId.value = id;
  knowledgeOpenNumber.value += 1;
  view.value = "knowledge";
}

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
    <div class="workspace-head">
      <header class="header">
        <span class="mark" aria-hidden="true">R<span class="mark-dot" /></span>
        <div>
          <h1>ResearchFlow</h1>
          <p>让阅读变成自己的知识</p>
        </div>
      </header>
      <div class="connection-line">
        <span class="connection-indicator" :class="connection" />
        <span v-if="connection === 'checking'">正在连接本地服务</span>
        <span v-else-if="connection === 'ready'">本地服务已连接</span>
        <span v-else>本地服务未连接</span>
        <button v-if="connection === 'unavailable'" type="button" class="text-button" @click="checkConnection">重试</button>
      </div>
    </div>

    <nav class="app-navigation" aria-label="侧栏功能">
      <button type="button" :class="{ active: view === 'research' }" @click="view = 'research'">阅读提问</button>
      <button type="button" :class="{ active: view === 'knowledge' }" @click="openKnowledge()">我的知识</button>
    </nav>

    <div v-show="view === 'research'" class="workspace-body">
      <CurrentPageCard
        :page="page" :state="state" :notice="notice" :tabs-access="tabsAccess"
        @read="read($event)" @refresh="refresh" @authorize="authorize" @authorize-tabs="authorizeTabs"
      />

      <ResearchRun :context="state === 'ready' ? snapshot : null" @saved="openKnowledge" />
    </div>

    <KnowledgeManager
      v-if="view === 'knowledge'"
      :key="knowledgeOpenNumber"
      :focus-id="focusKnowledgeId"
    />
  </main>
</template>

<style scoped>
.shell { min-height: 100vh; }
.workspace-head {
  padding: 22px 22px 17px;
  color: #fff;
  background: radial-gradient(circle at 88% 5%, #28645c 0, transparent 42%), linear-gradient(135deg, #163c3d, #102a31);
}
.header { display: flex; align-items: center; gap: 11px; }
.mark { position: relative; display: grid; place-items: center; flex: 0 0 37px; width: 37px; height: 37px; border: 1px solid #8cc4ab70; border-radius: 11px; background: #ffffff1a; font: 700 24px/1 Georgia, serif; }
.mark-dot { position: absolute; right: 6px; bottom: 6px; width: 5px; height: 5px; border-radius: 50%; background: #a5e0bd; }
.header h1 { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -.03em; }
.header p { margin: 3px 0 0; color: #bcd1c9; font-size: 11px; letter-spacing: .02em; }
.connection-line { display: flex; align-items: center; gap: 7px; margin: 17px 0 0 48px; color: #c6d8d0; font-size: 11px; }
.connection-indicator { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: #aab9b1; }
.connection-indicator.ready { background: #8ad6a3; box-shadow: 0 0 0 3px #8ad6a32c; }
.connection-indicator.unavailable { background: #efaa88; box-shadow: 0 0 0 3px #efaa882c; }
.connection-line .text-button { color: #d7eddf; }

.app-navigation { position: sticky; top: 0; z-index: 2; display: flex; gap: 3px; padding: 12px 18px; background: #f3f6f3f2; backdrop-filter: blur(10px); }
.app-navigation button { flex: 1; min-height: 37px; border: 0; border-radius: 9px; background: transparent; color: #6a7e79; font-size: 12px; font-weight: 700; }
.app-navigation button:hover { background: #e8eeea; }
.app-navigation button.active { background: var(--surface); color: #175a4f; box-shadow: 0 2px 9px #1d443116; }
.workspace-body { padding: 2px 18px 30px; }
@media (max-width: 360px) {
  .workspace-head { padding-inline: 18px; }
  .workspace-body, .app-navigation { padding-inline: 12px; }
}
</style>
