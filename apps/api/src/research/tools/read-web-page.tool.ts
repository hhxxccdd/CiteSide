import { BadRequestException, Injectable } from "@nestjs/common";
import { isIP } from "node:net";
import * as cheerio from "cheerio";

export interface ReadWebPageResult {
  title: string;
  url: string;
  text: string;
}

export const READ_WEB_PAGE_DEFINITION = {
  type: "function",
  function: {
    name: "read_web_page",
    description: "按搜索结果序号阅读网页，核对其正文内容",
    parameters: {
      type: "object",
      properties: {
        sourceIndex: {
          type: "integer",
          description: "要阅读的搜索结果序号，从 1 开始",
        },
      },
      required: ["sourceIndex"],
      additionalProperties: false,
    },
  },
} as const;

@Injectable()
export class ReadWebPageTool {
  async execute(args: {
    url: string;
    allowedUrls: readonly string[];
  }): Promise<ReadWebPageResult> {
    const url = this.validateUrl(args.url, args.allowedUrls);
    const html = await this.downloadHtml(url);
    const $ = cheerio.load(html);

    const title =
      $("title").first().text().trim() ||
      $("h1").first().text().trim() ||
      url.hostname;

    // 去掉导航、脚本等与正文无关的内容。
    $(
      "script, style, noscript, svg, nav, header, footer, aside, form",
    ).remove();

    const article = $("article").first();
    const main = $("main").first();
    const root = article.length ? article : main.length ? main : $("body");

    const paragraphs = root
      .find("h1, h2, h3, h4, p, li, pre, blockquote")
      .map((_index, element) => $(element).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean);

    const text = (paragraphs.length ? paragraphs.join("\n") : root.text())
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 12_000);

    if (!text) {
      throw new Error("网页没有可读取的正文");
    }

    return { title, url: url.href, text };
  }

  private validateUrl(rawUrl: string, allowedUrls: readonly string[]): URL {
    if (typeof rawUrl !== "string" || rawUrl.length > 2048) {
      throw new BadRequestException("网页地址不正确");
    }

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException("网页地址不正确");
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !hostname.includes(".") ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      isIP(hostname) !== 0
    ) {
      throw new BadRequestException("不允许读取这个网页地址");
    }

    const isSearchResult = allowedUrls.some((allowed) => {
      try {
        return new URL(allowed).href === url.href;
      } catch {
        return false;
      }
    });

    if (!isSearchResult) {
      throw new BadRequestException("只能读取本次搜索结果中的网页");
    }

    return url;
  }

  private async downloadHtml(url: URL): Promise<string> {
    const maxBytes = 1_000_000; // 最多下载约 1 MB
    const response = await fetch(url, {
      headers: { Accept: "text/html,application/xhtml+xml" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`读取网页失败：HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      throw new Error("搜索结果不是 HTML 网页");
    }

    const declaredSize = Number(response.headers.get("content-length"));
    if (declaredSize > maxBytes) {
      throw new Error("网页内容过大");
    }
    if (!response.body) {
      throw new Error("网页没有返回正文");
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new Error("网页内容过大");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    return Buffer.concat(chunks).toString("utf8");
  }
}
