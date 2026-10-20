import type {
  BrowserPage, PageReadRequest, PageReadResponse, PageSnapshot,
} from "./pageContext.types";

export class PageReadError extends Error {
  constructor(public readonly reason: "needs-permission" | "empty" | "changed" | "unsupported" | "failed", message: string) {
    super(message);
  }
}

export function isReadablePageUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function sitePattern(url: string): string {
  if (!isReadablePageUrl(url)) throw new PageReadError("unsupported", "此页面不支持读取，请打开普通 HTTP/HTTPS 网页。");
  const parsed = new URL(url);
  // Chrome 站点匹配规则按协议和主机申请，不把 URL 端口当成主机的一部分。
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

// 必须从按钮点击直接调用，不能等异步读取后才弹权限框。
export function requestPageAccess(page: BrowserPage): Promise<boolean> {
  return chrome.permissions.request({ origins: [sitePattern(page.url)] });
}

export async function currentBrowserPage(windowId: number): Promise<BrowserPage | null> {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab?.id === undefined) return null;
  return { tabId: tab.id, title: tab.title || "当前网页", url: tab.url || "", loading: tab.status === "loading" };
}

export async function readBrowserPage(page: BrowserPage, fallback = false): Promise<PageSnapshot> {
  // 所有调用者共用此入口；浏览器内部页不应进入脚本注入或授权流程。
  if (!isReadablePageUrl(page.url)) {
    throw new PageReadError("unsupported", "浏览器内部页和本地文件暂不支持读取，请打开普通 HTTP/HTTPS 网页。");
  }
  const before = await chrome.tabs.get(page.tabId);
  if (before.url !== page.url || before.status === "loading") {
    throw new PageReadError("changed", "网页正在加载或已经跳转，请加载完成后重新读取。");
  }
  let documentId: string | undefined;
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: page.tabId }, files: ["page-reader.js"] });
    documentId = injection?.documentId;
  } catch {
    const accessible = await chrome.permissions.contains({ origins: [sitePattern(page.url)] });
    throw new PageReadError(accessible ? "failed" : "needs-permission",
      accessible ? "无法读取此网页，可能是浏览器限制。请换普通技术文章重试。" : "需要授权后才能读取这篇网页的正文。");
  }
  const message: PageReadRequest = { type: "RESEARCHFLOW_READ_PAGE", url: page.url, fallback };
  // 同一 URL 也可能刷新成新文档，优先把请求绑定到刚刚注入的文档。
  const response = await chrome.tabs.sendMessage(page.tabId, message,
    documentId ? { documentId } : { frameId: 0 }) as PageReadResponse | undefined;
  const after = await chrome.tabs.get(page.tabId);
  if (after.url !== page.url || after.status === "loading" || response?.ok === false && response.reason === "changed") {
    throw new PageReadError("changed", "读取期间网页已跳转，请重新读取。");
  }
  if (!response?.ok) {
    throw new PageReadError(response?.reason === "empty" ? "empty" : "failed",
      response?.reason === "empty" ? "没有找到文章正文。可以重试，或尝试清理后的可见文字。" : "正文提取失败，请重试或尝试可见文字。");
  }
  if (response.page.url !== page.url) throw new PageReadError("changed", "页面已变化，请重新读取。");
  return { ...response.page, tabId: page.tabId, id: crypto.randomUUID() };
}
