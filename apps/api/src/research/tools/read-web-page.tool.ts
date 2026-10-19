import { BadRequestException, Injectable } from "@nestjs/common";
import { isIP } from "node:net";
import * as cheerio from "cheerio";

export interface ReadWebPageResult {
  title: string;
  url: string;
  text: string;
}

export interface WebPageReadError {
  title: string;
  url: string;
  reason: string;
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

  private validateUrl(rawUrl: string, allowedUrls?: readonly string[]): URL {
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

    const isSearchResult = !allowedUrls || allowedUrls.some((allowed) => {
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
    const signal = AbortSignal.timeout(10_000);
    try {
      const response = await this.fetchHtml(url, signal);
      return await this.readHtml(response, maxBytes);
    } catch (error) {
      if (signal.aborted) throw new Error("网页读取超过 10 秒，请稍后重试");
      if (error instanceof TypeError) throw new Error("无法连接该网站，请检查网络或在浏览器中打开原文");
      throw error;
    }
  }

  private async fetchHtml(initialUrl: URL, signal: AbortSignal): Promise<Response> {
    let url = initialUrl;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await fetch(url, {
        headers: { Accept: "text/html,application/xhtml+xml" },
        redirect: "manual",
        signal,
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;

      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("网站返回了跳转，但没有提供目标地址");
      if (redirects === 3) throw new Error("网页跳转次数过多，暂时无法读取");
      const next = this.validateUrl(new URL(location, url).href);
      // 仅跟随同一主机的普通跳转，不跟随站外跳转或 HTTPS 降级。
      if (next.hostname !== initialUrl.hostname || (url.protocol === "https:" && next.protocol !== "https:")) {
        throw new Error("网站跳转到了其他站点或不安全地址，请在浏览器中打开原文");
      }
      // 登录、验证码页面不是文章，不能当作已核对的正文交给模型。
      if (/(?:^|\/)(?:login|signin|passport|captcha|verify|verification|challenge|valid)(?:[/.]|$)/i.test(next.pathname)) {
        throw new Error("网站要求登录或安全验证，服务端无法读取正文；可在浏览器打开后通过 @ 添加该网页");
      }
      url = next;
    }
    throw new Error("网页跳转次数过多，暂时无法读取");
  }

  private async readHtml(response: Response, maxBytes: number): Promise<string> {
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) {
        throw new Error(`网站拒绝服务端读取（HTTP ${response.status}），可能需要登录或安全验证`);
      }
      if (response.status === 429) throw new Error("网站访问过于频繁（HTTP 429），请稍后重试");
      throw new Error(`读取网页失败：HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      await response.body?.cancel();
      throw new Error("搜索结果不是 HTML 网页");
    }

    const declaredSize = Number(response.headers.get("content-length"));
    if (declaredSize > maxBytes) {
      await response.body?.cancel();
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
