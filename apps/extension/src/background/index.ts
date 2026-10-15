import { watchSelection } from '../features/page-context/watchSelection';

const SELECTION_KEYS = ['currentSelection', 'confirmedSelection'];

chrome.tabs.onActivated.addListener(() => {
  void chrome.storage.session.remove(SELECTION_KEYS);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  void chrome.storage.session.get(SELECTION_KEYS).then((saved) => {
    const belongsToTab = SELECTION_KEYS.some((key) => {
      const value = saved[key] as { tabId?: number } | undefined;
      return value?.tabId === tabId;
    });
    if (belongsToTab) return chrome.storage.session.remove(SELECTION_KEYS);
  });
});

// 旧版曾让 Chrome 自动处理图标点击；改回由下面的 onClicked 统一打开侧栏。
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch((error) => {
  console.error('无法设置侧栏打开方式：', error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'PAGE_SELECTION_CHANGED') {
    const tabId = sender.tab?.id;
    if (tabId === undefined || typeof message.payload?.text !== 'string') {
      sendResponse({ ok: false, error: '选区数据不完整' });
      return;
    }

    chrome.storage.session.set({
      currentSelection: { tabId, ...message.payload },
    }).then(() => {
      sendResponse({ ok: true });
    }).catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return true;
  }
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((error) => {
    console.error('无法打开侧栏：', error);
  });

  if (tab.id === undefined) return;

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: watchSelection,
  }).catch((error) => {
    console.error('无法读取当前网页：', error);
  });
});
