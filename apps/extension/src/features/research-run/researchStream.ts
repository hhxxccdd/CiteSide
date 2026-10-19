import { createParser } from "eventsource-parser";
import type { ResearchRequest, ResearchResult } from "./researchApi";

export type ResearchEvent = { runId: string; sequence: number } & (
  | { type: "run.started" }
  | { type: "step.started"; stepId: string; label: string }
  | { type: "step.completed"; stepId: string; detail?: string }
  | { type: "step.failed"; stepId: string; message: string }
  | { type: "answer.reset" }
  | { type: "answer.delta"; text: string }
  | { type: "run.completed"; result: ResearchResult }
  | { type: "run.failed"; message: string }
);

// POST 可以携带全文与范围；不自动重连，避免断线后重复执行模型和工具。
export async function streamResearch(input: ResearchRequest, signal: AbortSignal,
  receive: (event: ResearchEvent) => void): Promise<ResearchResult> {
  const response = await fetch("http://127.0.0.1:3000/api/research/run/stream", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(input), signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { message?: unknown } | null;
    throw new Error(typeof data?.message === "string" ? data.message : "无法开始研究，请确认后端已更新并正常运行。");
  }
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new Error("后端没有返回事件流，请更新后端后重试。");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let runId = "";
  let sequence = 0;
  let result: ResearchResult | undefined;
  const parser = createParser({ onEvent: (message) => {
    signal.throwIfAborted();
    if (result) return;
    const event = JSON.parse(message.data) as ResearchEvent;
    if (!event || typeof event.runId !== "string" || !event.runId || event.sequence !== sequence + 1 ||
      event.type !== message.event || (!runId && event.type !== "run.started") || runId && event.runId !== runId) {
      throw new Error("研究进度顺序异常，请重新发起研究。");
    }
    runId = event.runId;
    sequence = event.sequence;
    switch (event.type) {
      case "step.started": if (typeof event.stepId !== "string" || typeof event.label !== "string") throw new Error("步骤信息不完整"); break;
      case "step.completed": if (typeof event.stepId !== "string") throw new Error("步骤信息不完整"); break;
      case "step.failed": if (typeof event.stepId !== "string" || typeof event.message !== "string") throw new Error("步骤信息不完整"); break;
      case "answer.delta": if (typeof event.text !== "string") throw new Error("回答片段格式不正确"); break;
      case "run.failed": throw new Error(typeof event.message === "string" ? event.message : "本次研究未完成，请重试。");
      case "run.completed":
        if (event.result?.runId !== runId || typeof event.result.answer !== "string") throw new Error("最终回答格式不正确");
        result = event.result; break;
      case "run.started": if (sequence !== 1) throw new Error("研究重复开始"); break;
      case "answer.reset": break;
      default: throw new Error("收到无法识别的研究事件");
    }
    receive(event);
  }, onError: (error) => { throw error; } });
  try {
    while (!result) {
      const chunk = await reader.read();
      if (chunk.done) break;
      parser.feed(decoder.decode(chunk.value, { stream: true }));
    }
    parser.feed(decoder.decode());
    signal.throwIfAborted();
    if (!result) throw new Error("连接已断开，回答尚未完成。可以按原资料重试。");
    return result;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
