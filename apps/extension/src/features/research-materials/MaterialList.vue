<script setup lang="ts">
import type { ResearchMaterial } from "./material.types";
defineProps<{ items: ResearchMaterial[]; disabled: boolean }>();
defineEmits<{ remove: [id: string]; retry: [id: string, authorize: boolean] }>();
</script>

<template>
  <ul v-if="items.length" class="material-list" aria-label="指定参考资料">
    <li v-for="item in items" :key="item.id">
      <div class="material-title"><span>{{ item.kind === 'page' ? '网页' : '指定笔记' }}</span><strong>{{ item.title }}</strong>
        <button type="button" class="text-button" :disabled="disabled" :aria-label="`移除${item.title}`" @click="$emit('remove', item.id)">×</button>
      </div>
      <template v-if="item.kind === 'page'">
        <p v-if="item.state === 'reading'" role="status">正在读取正文…</p>
        <p v-else-if="item.state === 'ready'">正文已就绪 <button type="button" class="text-button" :disabled="disabled" @click="$emit('retry', item.id, false)">重新读取</button></p>
        <p v-else class="material-error" role="status">{{ item.error }}
          <button type="button" class="text-button" :disabled="disabled" @click="$emit('retry', item.id, item.state === 'needs-permission')">{{ item.state === 'needs-permission' ? '授权并读取' : '重新读取' }}</button>
        </p>
      </template>
    </li>
  </ul>
</template>

<style scoped>
.material-list { display: grid; gap: 7px; margin: 0 0 12px; padding: 0; list-style: none; }
li { padding: 9px 10px; border: 1px solid #dce9e0; border-radius: 9px; background: #f5f9f5; }
.material-title { display: flex; align-items: center; gap: 7px; min-width: 0; }
.material-title > span { flex-shrink: 0; color: #65927a; font-size: 10px; }
strong { flex: 1; color: #335744; font-size: 12px; overflow-wrap: anywhere; }
.material-title button { flex-shrink: 0; font-size: 18px; }
p { margin: 4px 0 0; color: #7a8c80; font-size: 11px; line-height: 1.6; }
.material-error { color: #a2643e; }
</style>
