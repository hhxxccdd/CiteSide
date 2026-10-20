import { computed, onUnmounted, ref } from "vue";
import { PageReadError, readBrowserPage, requestPageAccess } from "../page-context/pageContextApi";
import type { PageSnapshot } from "../page-context/pageContext.types";
import { pageKey, type MaterialChoice, type ResearchMaterial } from "./material.types";

export function useResearchMaterials(current: () => PageSnapshot | null) {
  const items = ref<ResearchMaterial[]>([]);
  const notice = ref("");
  let disposed = false;
  const noteIds = computed(() => items.value.flatMap((item) => item.kind === "note" ? [item.noteId] : []));
  const hasUnready = computed(() => items.value.some((item) => item.kind === "page" && item.state !== "ready"));

  function pages(): PageSnapshot[] {
    const all = [current(), ...items.value.flatMap((item) => item.kind === "page" ? [item.snapshot] : [])];
    return [...new Map(all.filter((page): page is PageSnapshot => page !== null).map((page) => [pageKey(page.url), page])).values()];
  }
  const selectedUrls = computed(() => [...new Set([...(current() ? [pageKey(current()!.url)] : []),
    ...items.value.flatMap((item) => item.kind === "page" ? [pageKey(item.page.url)] : [])])]);

  async function read(id: string, authorize = false): Promise<void> {
    const item = items.value.find((candidate) => candidate.id === id);
    if (!item || item.kind !== "page" || item.state === "reading") return;
    item.state = "reading"; item.error = "";
    try {
      if (authorize && !await requestPageAccess(item.page)) throw new PageReadError("needs-permission", "未获得读取授权，可以重试或移除此资料。");
      if (disposed || !items.value.some((candidate) => candidate.id === id)) return;
      const snapshot = await readBrowserPage(item.page);
      if (snapshot.completeness !== "full") throw new Error("网页内容超过单次传输容量，请移除此资料。");
      if (disposed || !items.value.some((candidate) => candidate.id === id)) return;
      item.snapshot = snapshot; item.title = snapshot.title; item.state = "ready";
    } catch (error) {
      if (disposed || !items.value.some((candidate) => candidate.id === id)) return;
      item.state = error instanceof PageReadError && error.reason === "needs-permission" ? "needs-permission" : "failed";
      item.error = error instanceof Error ? error.message : "读取失败，请重试或移除。";
    }
  }

  async function add(choice: MaterialChoice): Promise<void> {
    notice.value = "";
    if (choice.kind === "note") {
      if (noteIds.value.includes(choice.note.id)) return;
      if (noteIds.value.length >= 3) { notice.value = "最多指定 3 条笔记。"; return; }
      items.value.push({ id: crypto.randomUUID(), kind: "note", title: choice.note.title, noteId: choice.note.id });
      return;
    }
    if (selectedUrls.value.includes(pageKey(choice.page.url))) { notice.value = "这篇网页已经在本次资料中。"; return; }
    if (selectedUrls.value.length >= 3) { notice.value = "最多使用 3 篇网页（包含当前网页）。"; return; }
    const id = crypto.randomUUID();
    items.value.push({ id, kind: "page", title: choice.page.title, page: choice.page, state: "failed", snapshot: null, error: "" });
    await read(id);
  }

  function remove(id: string): void { items.value = items.value.filter((item) => item.id !== id); notice.value = ""; }
  function restore(savedPages: PageSnapshot[], notes: Array<{ id: string; title: string }>): void {
    items.value = [
      ...savedPages.map((page): ResearchMaterial => ({ id: crypto.randomUUID(), kind: "page", title: page.title,
        page: { tabId: page.tabId, title: page.title, url: page.url, loading: false }, state: "ready", snapshot: page, error: "" })),
      ...notes.map((note): ResearchMaterial => ({ id: crypto.randomUUID(), kind: "note", title: note.title, noteId: note.id })),
    ];
  }
  onUnmounted(() => { disposed = true; });
  return { items, noteIds, hasUnready, notice, selectedUrls, pages, add, read, remove, restore };
}
