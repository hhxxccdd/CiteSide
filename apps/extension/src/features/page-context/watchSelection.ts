export function watchSelection(): void {
  const pageWindow = window as Window & {
    __researchFlowSelectionWatcher?: boolean;
  };

  if (pageWindow.__researchFlowSelectionWatcher) return;
  pageWindow.__researchFlowSelectionWatcher = true;

  function sendSelection(): void {
    const text = window.getSelection()?.toString().trim() ?? '';
    if (!text) return;

    chrome.runtime.sendMessage({
      type: 'PAGE_SELECTION_CHANGED',
      payload: {
        title: document.title,
        url: location.href,
        text: text.slice(0, 8000),
        truncated: text.length > 8000,
      },
    }).catch(console.error);
  }

  let timer: number | undefined;
  document.addEventListener('selectionchange', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(sendSelection, 150);
  });

  // 打开侧栏前已经选好的文字，也发送一次。
  sendSelection();
}
