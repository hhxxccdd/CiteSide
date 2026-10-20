<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { Dialog, DialogPanel, DialogTitle, Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from "@headlessui/vue";
import { listKnowledgeEntries } from "../knowledge-base/knowledgeApi";
import type { MaterialChoice } from "./material.types";
import { pageKey } from "./material.types";
import { isReadablePageUrl } from "../page-context/pageContextApi";

const props = defineProps<{ open: boolean; selectedUrls: string[]; selectedNoteIds: string[] }>();
const emit = defineEmits<{ close: []; select: [choice: MaterialChoice] }>();
const group = ref<"page" | "note">("page");
const query = ref("");
const pages = ref<MaterialChoice[]>([]);
const notes = ref<MaterialChoice[]>([]);
const loading = ref(false);
const needsTabs = ref(false);
const error = ref("");
const searchInput = ref<{ $el: HTMLInputElement } | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | null = null;
let request = 0;
const choices = computed(() => group.value === "note" ? notes.value : pages.value.filter((choice) =>
  choice.kind === "page" && `${choice.page.title} ${choice.page.url}`.toLowerCase().includes(query.value.trim().toLowerCase())));
const title = (choice: MaterialChoice) => choice.kind === "page" ? choice.page.title : choice.note.title;
const key = (choice: MaterialChoice) => choice.kind === "page" ? `page-${choice.page.tabId}` : `note-${choice.note.id}`;
const selected = (choice: MaterialChoice) => choice.kind === "page" ? props.selectedUrls.includes(pageKey(choice.page.url)) : props.selectedNoteIds.includes(choice.note.id);

async function load(): Promise<void> {
  if (!props.open) return;
  controller?.abort(); controller = new AbortController();
  const current = ++request;
  loading.value = true; error.value = "";
  try {
    if (group.value === "page") {
      needsTabs.value = !await chrome.permissions.contains({ permissions: ["tabs"] });
      if (needsTabs.value) return;
      const window = await chrome.windows.getCurrent();
      const tabs = await chrome.tabs.query({ windowId: window.id });
      if (current !== request || !props.open) return;
      pages.value = tabs.flatMap((tab): MaterialChoice[] => tab.id !== undefined && tab.url && isReadablePageUrl(tab.url)
        ? [{ kind: "page", page: { tabId: tab.id, title: tab.title || tab.url, url: tab.url, loading: tab.status === "loading" } }] : []);
    } else {
      const entries = await listKnowledgeEntries(query.value, controller.signal);
      if (current !== request || !props.open) return;
      notes.value = entries.map((note) => ({ kind: "note", note: { id: note.id, title: note.title } }));
    }
  } catch (cause) {
    if (current === request && props.open) error.value = cause instanceof Error ? cause.message : "资料加载失败，请重试。";
  } finally { if (current === request) loading.value = false; }
}

async function authorizeTabs(): Promise<void> {
  try {
    if (await chrome.permissions.request({ permissions: ["tabs"] })) await load();
    else error.value = "未获得标签页信息权限，仍可选择个人笔记。";
  } catch { error.value = "标签页授权失败，请重试。"; }
}

watch(() => props.open, (open) => {
  clearTimeout(timer); controller?.abort(); ++request;
  if (open) { query.value = ""; group.value = "page"; pages.value = []; notes.value = []; void load(); }
});
watch(group, () => { clearTimeout(timer); query.value = ""; notes.value = []; void load(); });
watch(query, () => {
  if (!props.open || group.value !== "note") return;
  clearTimeout(timer); controller?.abort(); ++request;
  notes.value = []; loading.value = true;
  timer = setTimeout(() => { void load(); }, 250);
});
onUnmounted(() => { clearTimeout(timer); controller?.abort(); ++request; });
function choose(choice: MaterialChoice | null): void { if (choice && !selected(choice)) { emit("select", choice); emit("close"); } }
</script>

<template>
  <Dialog :open="open" :initial-focus="searchInput?.$el" class="material-dialog" @close="emit('close')">
    <div class="picker-backdrop" aria-hidden="true" />
    <div class="picker-position"><DialogPanel class="picker-panel">
      <div class="picker-heading"><DialogTitle>添加参考资料</DialogTitle><button type="button" class="text-button" @click="emit('close')">关闭</button></div>
      <div class="picker-tabs"><button type="button" :aria-pressed="group === 'page'" @click="group = 'page'">已打开网页</button><button type="button" :aria-pressed="group === 'note'" @click="group = 'note'">个人笔记</button></div>
      <Combobox :model-value="null" @update:model-value="choose">
        <ComboboxInput ref="searchInput" class="picker-input" aria-label="搜索资料" placeholder="输入标题或关键词" maxlength="200" @change="query = ($event.target as HTMLInputElement).value" />
        <p v-if="loading" class="picker-status" role="status">正在加载资料…</p>
        <p v-if="error" class="error-message" role="alert">{{ error }} <button type="button" class="text-button" @click="load">重试</button></p>
        <button v-if="group === 'page' && needsTabs" type="button" class="secondary-button" @click="authorizeTabs">授权查看已打开网页</button>
        <ComboboxOptions static class="picker-options">
          <ComboboxOption v-for="choice in choices" :key="key(choice)" :value="choice" :disabled="selected(choice)" as="template" v-slot="{ active, disabled }">
            <li class="picker-option" :class="{ active, disabled }"><strong>{{ title(choice) }}</strong><span>{{ disabled ? '已添加' : choice.kind === 'page' ? choice.page.url : '指定这条笔记' }}</span></li>
          </ComboboxOption>
        </ComboboxOptions>
      </Combobox>
      <p v-if="!loading && !error && !choices.length && !(group === 'page' && needsTabs)" class="picker-status">{{ group === 'page' ? '没有找到普通网页。' : '没有找到匹配的笔记。' }}</p>
      <p class="picker-help">最多 3 篇网页、3 条指定笔记。选择后只作为本次提问资料。</p>
    </DialogPanel></div>
  </Dialog>
</template>

<style scoped>
:global(.material-dialog) { position: fixed; inset: 0; z-index: 30; }
.picker-backdrop { position: fixed; inset: 0; background: #102c2b66; }
.picker-position { position: fixed; inset: 0; display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 40px 12px; }
.picker-panel { width: 100%; max-width: 440px; max-height: calc(100dvh - 80px); overflow-y: auto; padding: 17px; border-radius: 14px; background: white; box-shadow: 0 14px 50px #163b3340; }
.picker-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 13px; }
.picker-heading h2 { margin: 0; font-size: 16px; }
.picker-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.picker-tabs button { flex: 1; min-height: 35px; border: 0; border-radius: 7px; background: #f3f6f3; color: #75867b; font-size: 12px; }
.picker-tabs button[aria-pressed=true] { background: #e5f2e9; color: #176a55; font-weight: 700; }
.picker-input { width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 8px; font: inherit; }
.picker-options { max-height: 45dvh; overflow-y: auto; padding: 0; margin: 9px 0; list-style: none; }
.picker-option { display: grid; gap: 4px; padding: 11px 9px; border-radius: 8px; cursor: pointer; }
.picker-option.active { background: #eef6f0; }
.picker-option.disabled { opacity: .5; cursor: default; }
.picker-option strong { font-size: 12px; color: #315b47; overflow-wrap: anywhere; }
.picker-option span { font-size: 10px; color: #85968a; overflow-wrap: anywhere; }
.picker-status, .picker-help { margin: 10px 0 0; font-size: 11px; color: #7c9081; line-height: 1.6; }
</style>
