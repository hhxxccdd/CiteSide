// 技术博客常用两列表格排代码：左边行号、右边正文。
// 调用方负责净化 HTML；这里仅把布局换成 pre/code，并保留代码本身的尖括号。
export function normalizeCodeTables(root: ParentNode): void {
  for (const table of root.querySelectorAll("table")) {
    const row = table.rows[0];
    if (!row || table.rows.length !== 1) continue;
    const gutter = row.cells[0]?.querySelector("pre");
    if (!gutter) continue;
    const numbers = textWithLineBreaks(gutter).trim().split(/\s+/);
    const isGutter = numbers.length > 0 && numbers.every((value, index) => value === String(index + 1));
    if (!isGutter) continue;

    const code = row.cells[1]?.querySelector("pre");
    const document = table.ownerDocument;
    if (!code && row.cells.length === 1 && numbers.length > 1) {
      const notice = document.createElement("p");
      notice.textContent = "此处的代码片段未完整保留，请打开原网页查看。";
      table.replaceWith(notice);
    } else if (code && row.cells.length === 2) {
      const pre = document.createElement("pre");
      const content = document.createElement("code");
      content.textContent = textWithLineBreaks(code).replace(/\n$/, "");
      pre.append(content);
      table.replaceWith(pre);
    }
  }
}

function textWithLineBreaks(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return copy.textContent ?? "";
}
