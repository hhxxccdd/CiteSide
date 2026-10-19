import { extractPageContent } from "./extractPageContent";
import type { PageReadResponse } from "./pageContext.types";

type Reader = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
const readerWindow = globalThis as typeof globalThis & { __researchFlowReader?: Reader };
// 重读或扩展重载后更新监听器，避免同一页重复注册。
if (readerWindow.__researchFlowReader) {
  chrome.runtime.onMessage.removeListener(readerWindow.__researchFlowReader);
}
const reader: Reader = (message, _sender, respond) => {
  if (message?.type !== "RESEARCHFLOW_READ_PAGE") return;
  let result: PageReadResponse;
  try {
    if (message.url !== location.href) {
      result = { ok: false, reason: "changed" };
    } else {
      const page = extractPageContent(document, message.fallback === true);
      result = page ? { ok: true, page } : { ok: false, reason: "empty" };
    }
  } catch {
    result = { ok: false, reason: "failed" };
  }
  respond(result);
};
chrome.runtime.onMessage.addListener(reader);
readerWindow.__researchFlowReader = reader;
