// 图标点击只负责打开侧栏，正文读取由页面功能统一处理。
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch((error) => {
  console.error('无法设置侧栏打开方式：', error);
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((error) => {
    console.error('无法打开侧栏：', error);
  });
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.session.remove(['currentSelection', 'confirmedSelection']);
});
