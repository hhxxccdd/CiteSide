import { onMounted, onUnmounted, ref } from "vue";
import { currentBrowserPage, PageReadError, readBrowserPage, requestPageAccess } from "./pageContextApi";
import type { BrowserPage, PageReadState, PageSnapshot } from "./pageContext.types";

export function useCurrentPage() {
  const page = ref<BrowserPage | null>(null);
  const snapshot = ref<PageSnapshot | null>(null);
  const state = ref<PageReadState>("loading");
  const notice = ref("");
  const tabsAccess = ref(false);
  let windowId: number | undefined;
  let version = 0;
  let refreshVersion = 0;
  let disposed = false;

  async function read(fallback = false): Promise<void> {
    if (!page.value || state.value === "reading") return;
    const target = { ...page.value };
    const request = ++version;
    snapshot.value = null;
    state.value = "reading";
    notice.value = "";
    try {
      const result = await readBrowserPage(target, fallback);
      if (disposed || request !== version) return;
      snapshot.value = result;
      state.value = result.completeness === "full" ? "ready" : "partial";
    } catch (error) {
      if (disposed || request !== version) return;
      state.value = error instanceof PageReadError && error.reason !== "changed" ? error.reason : "failed";
      notice.value = error instanceof Error ? error.message : "读取失败，请重试。";
    }
  }

  async function refresh(): Promise<void> {
    if (windowId === undefined) return;
    const request = ++refreshVersion;
    try {
      const current = await currentBrowserPage(windowId);
      if (disposed || request !== refreshVersion) return;
      if (page.value && current && page.value.tabId === current.tabId && page.value.url === current.url &&
          page.value.loading === current.loading) {
        page.value = current;
        return;
      }
      ++version;
      page.value = current;
      snapshot.value = null;
      notice.value = "";
      if (!current) { state.value = "unsupported"; return; }
      if (!current.url) { state.value = "needs-permission"; return; }
      if (!/^https?:\/\//.test(current.url)) { state.value = "unsupported"; return; }
      if (current.loading) { state.value = "loading"; return; }
      state.value = "available";
      await read();
    } catch {
      if (disposed || request !== refreshVersion) return;
      state.value = "failed";
      notice.value = "无法取得当前标签页，请重试。";
    }
  }

  async function authorize(): Promise<void> {
    const target = page.value;
    if (!target?.url || !/^https?:\/\//.test(target.url)) return;
    try {
      const granted = await requestPageAccess(target);
      if (disposed || target.tabId !== page.value?.tabId || target.url !== page.value?.url) return;
      if (granted) await read();
      else notice.value = "未获得授权，尚未读取正文。可以稍后再授权。";
    } catch {
      notice.value = "授权未完成，请重新点击按钮。";
    }
  }

  async function authorizeTabs(): Promise<void> {
    try {
      const granted = await chrome.permissions.request({ permissions: ["tabs"] });
      if (disposed) return;
      tabsAccess.value = granted;
      if (granted) await refresh();
      else notice.value = "未获得标签页信息权限。也可以回到网页点击扩展图标后重试。";
    } catch {
      notice.value = "无法取得标签页信息权限，请重试。";
    }
  }

  function activated(info: { tabId: number; windowId: number }): void {
    if (info.windowId === windowId) void refresh();
  }
  function updated(tabId: number, change: { url?: string; status?: string; title?: string }): void {
    if (tabId === page.value?.tabId && (change.url || change.status || change.title)) void refresh();
  }
  function removed(tabId: number): void {
    if (tabId === page.value?.tabId) void refresh();
  }
  function permissionChanged(): void {
    void chrome.permissions.contains({ permissions: ["tabs"] }).then((granted) => {
      if (!disposed) tabsAccess.value = granted;
    });
    ++version;
    page.value = null;
    snapshot.value = null;
    void refresh();
  }
  onMounted(async () => {
    try {
      const current = await chrome.windows.getCurrent();
      if (disposed) return;
      windowId = current.id;
      if (windowId === undefined) throw new Error("没有找到浏览器窗口");
      tabsAccess.value = await chrome.permissions.contains({ permissions: ["tabs"] });
      if (disposed) return;
      chrome.tabs.onActivated.addListener(activated);
      chrome.tabs.onUpdated.addListener(updated);
      chrome.tabs.onRemoved.addListener(removed);
      chrome.permissions.onAdded.addListener(permissionChanged);
      chrome.permissions.onRemoved.addListener(permissionChanged);
      await refresh();
    } catch {
      state.value = "failed";
      notice.value = "无法连接浏览器，请重新打开侧栏。";
    }
  });
  onUnmounted(() => {
    disposed = true;
    ++version;
    ++refreshVersion;
    chrome.tabs.onActivated.removeListener(activated);
    chrome.tabs.onUpdated.removeListener(updated);
    chrome.tabs.onRemoved.removeListener(removed);
    chrome.permissions.onAdded.removeListener(permissionChanged);
    chrome.permissions.onRemoved.removeListener(permissionChanged);
  });
  return { page, snapshot, state, notice, tabsAccess, read, refresh, authorize, authorizeTabs };
}
