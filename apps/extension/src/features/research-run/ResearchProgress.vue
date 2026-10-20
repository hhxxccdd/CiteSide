<script setup lang="ts">
import { computed } from "vue";
import type { ResearchStep } from "./useResearchRun";
import { webUrl } from "./answerMarkdown";

const props = defineProps<{
  phase: "idle" | "running" | "completed" | "stopped" | "failed";
  steps: ResearchStep[];
  question: string;
  canRetry: boolean;
}>();
defineEmits<{ stop: []; retry: [] }>();
const displaySteps = computed(() => props.steps.map((step) => ({ ...step,
  links: step.links.flatMap((link) => {
    const url = webUrl(link.url);
    return url ? [{ title: link.title, url, host: new URL(url).hostname }] : [];
  }),
})));
</script>

<template>
  <section v-if="phase !== 'idle'" class="run-progress" :aria-busy="phase === 'running'">
    <div class="progress-heading">
      <p role="status">{{ phase === 'running' ? '正在研究' : phase === 'completed' ? '研究已完成' : phase === 'stopped' ? '研究已停止' : '研究未完成' }}</p>
      <button v-if="phase === 'running'" type="button" class="secondary-button" @click="$emit('stop')">停止生成</button>
      <button v-else-if="canRetry && phase !== 'completed'" type="button" class="secondary-button" @click="$emit('retry')">按原资料重试</button>
    </div>
    <p v-if="phase !== 'completed'" class="attempt-question">{{ question }}</p>
    <details :open="phase !== 'completed'">
      <summary>执行记录<span v-if="steps.length"> · {{ steps.length }} 步</span></summary>
      <p v-if="!steps.length" class="progress-note">{{ phase === 'running' ? '正在连接本地服务…' : '本次执行记录未保留，可按原资料重新开始。' }}</p>
      <ol class="progress-steps">
        <li v-for="step in displaySteps" :key="step.id" :data-state="step.state">
          <span class="step-icon" :class="{ spinning: step.state === 'running' }" aria-hidden="true">{{ step.state === 'completed' ? '✓' : step.state === 'failed' ? '!' : step.state === 'stopped' ? '—' : '' }}</span>
          <div class="step-content"><span>{{ step.label }}</span><small v-if="step.detail">{{ step.detail }}</small><small v-else-if="step.state === 'stopped'">已停止</small>
            <ul v-if="step.links.length" class="step-links">
              <li v-for="link in step.links" :key="link.url">
                <a :href="link.url" target="_blank" rel="noopener noreferrer"><span>{{ link.title || link.host }} ↗</span><small>{{ link.host }}</small></a>
              </li>
            </ul>
          </div>
        </li>
      </ol>
    </details>
  </section>
</template>

<style scoped>
.run-progress { margin-top: 16px; padding: 14px; background: #f3f8f5; border: 1px solid #dbe8e1; border-radius: 12px; min-width: 0; }
.progress-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.progress-heading p { margin: 0; color: #176653; font-weight: 650; }
.progress-heading button { padding: 7px 11px; font-size: 12px; }
.attempt-question { margin: 10px 0; font-size: 12px; color: #697d75; overflow-wrap: anywhere; }
summary { cursor: pointer; font-size: 12px; color: #426c5e; margin-top: 10px; }
.progress-steps { list-style: none; margin: 12px 0 0; padding: 0; }
.progress-steps > li { display: flex; gap: 9px; margin: 10px 0; color: #425e53; font-size: 12px; overflow-wrap: anywhere; }
.step-content { min-width: 0; flex: 1; }
.step-links { list-style: none; margin: 8px 0 0; padding: 0; }
.step-links li { margin: 6px 0; }
.step-links a { display: block; padding: 7px 9px; background: #fff; border: 1px solid #dce8e1; border-radius: 7px; color: #226652; text-decoration: none; }
.step-links a:hover { border-color: #569b82; }
.step-links a:focus-visible { outline: 2px solid #569b82; outline-offset: 2px; }
.step-icon { flex: 0 0 15px; width: 15px; height: 15px; line-height: 15px; text-align: center; color: #16745b; }
.step-icon.spinning { border: 2px solid #c1d7cb; border-top-color: #16745b; border-radius: 50%; box-sizing: border-box; animation: progress-spin .8s linear infinite; }
li[data-state='failed'] { color: #a94536; }
small { display: block; margin-top: 3px; color: inherit; opacity: .85; }
.progress-note { color: #6f827a; font-size: 11px; line-height: 1.6; }
@keyframes progress-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinning { animation: none !important; } }
</style>
