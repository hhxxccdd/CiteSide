import { onMounted, onUnmounted, ref } from "vue";

export interface PageSelection {
  tabId: number;
  title: string;
  url: string;
  text: string;
  truncated: boolean;
}

interface CurrentPage {
  tabId: number;
  title: string;
  url: string;
}

const PREVIEW_KEY = "currentSelection";
const CONFIRMED_KEY = "confirmedSelection";

export function useSelectionPreview() {
  const page = ref<CurrentPage | null>(null);
  const preview = ref<PageSelection | null>(null);
  const confirmed = ref<PageSelection | null>(null);
  const unavailable = ref(false);

  async function refresh(): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined || !tab.url || !/^https?:\/\//.test(tab.url)) {
      page.value = null;
      preview.value = null;
      confirmed.value = null;
      unavailable.value = true;
      return;
    }

    const current = { tabId: tab.id, title: tab.title || tab.url, url: tab.url };
    const saved = await chrome.storage.session.get([PREVIEW_KEY, CONFIRMED_KEY]);
    const belongsToPage = (value: unknown): value is PageSelection => {
      if (!value || typeof value !== "object") return false;
      const item = value as Partial<PageSelection>;
      return item.tabId === current.tabId && item.url === current.url &&
        typeof item.text === "string";
    };

    page.value = current;
    preview.value = belongsToPage(saved[PREVIEW_KEY]) ? saved[PREVIEW_KEY] : null;
    confirmed.value = belongsToPage(saved[CONFIRMED_KEY])
      ? saved[CONFIRMED_KEY]
      : null;
    unavailable.value = false;
  }

  async function confirmPreview(): Promise<void> {
    if (!preview.value || !page.value ||
        preview.value.tabId !== page.value.tabId ||
        preview.value.url !== page.value.url) return;
    await chrome.storage.session.set({ [CONFIRMED_KEY]: preview.value });
    await chrome.storage.session.remove(PREVIEW_KEY);
    await refresh();
  }

  async function ignorePreview(): Promise<void> {
    await chrome.storage.session.remove(PREVIEW_KEY);
    await refresh();
  }

  async function clearConfirmed(): Promise<void> {
    await chrome.storage.session.remove(CONFIRMED_KEY);
    await refresh();
  }

  function handleStorageChange(
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void {
    if (areaName === "session" &&
        (PREVIEW_KEY in changes || CONFIRMED_KEY in changes)) {
      void refresh();
    }
  }

  function handleTabChange(): void {
    void refresh();
  }

  onMounted(() => {
    chrome.storage.onChanged.addListener(handleStorageChange);
    chrome.tabs.onActivated.addListener(handleTabChange);
    chrome.tabs.onUpdated.addListener(handleTabChange);
    void refresh();
  });

  onUnmounted(() => {
    chrome.storage.onChanged.removeListener(handleStorageChange);
    chrome.tabs.onActivated.removeListener(handleTabChange);
    chrome.tabs.onUpdated.removeListener(handleTabChange);
  });

  return { page, preview, confirmed, unavailable, confirmPreview, ignorePreview, clearConfirmed };
}
