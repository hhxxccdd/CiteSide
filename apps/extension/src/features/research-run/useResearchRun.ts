import { onUnmounted, ref, shallowRef } from "vue";
import { streamResearch, type ResearchEvent, type ResearchStepLink } from "./researchStream";
import type { ResearchResult } from "./researchApi";
import type { ResearchAttempt } from "./researchSession";

export interface ResearchStep {
  id: string;
  label: string;
  state: "running" | "completed" | "failed" | "stopped";
  detail: string;
  links: ResearchStepLink[];
}

export function useResearchRun(options: {
  beforeStart: () => Promise<void>;
  completed: (result: ResearchResult, attempt: ResearchAttempt) => Promise<void>;
}) {
  const pending = ref(false);
  const unfinishedRun = ref(false);
  const error = ref("");
  const phase = ref<"idle" | "running" | "completed" | "stopped" | "failed">("idle");
  const steps = ref<ResearchStep[]>([]);
  const liveAnswer = ref("");
  const lastAttempt = shallowRef<ResearchAttempt | null>(null);
  let controller: AbortController | null = null;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let text = "";

  function flushAnswer(): void { clearTimeout(timer); timer = undefined; liveAnswer.value = text; }
  function receive(event: ResearchEvent): void {
    if (event.type === "step.started") steps.value.push({ id: event.stepId, label: event.label,
      state: "running", detail: event.detail ?? "", links: event.links ?? [] });
    if (event.type === "step.completed" || event.type === "step.failed") {
      const step = steps.value.find((step) => step.id === event.stepId);
      if (!step) throw new Error("收到未知步骤的进度");
      step.state = event.type === "step.completed" ? "completed" : "failed";
      step.detail = event.type === "step.completed" ? event.detail ?? "" : event.message;
      if (event.type === "step.completed" && event.links !== undefined) step.links = event.links;
    }
    if (event.type === "answer.reset") { text = ""; flushAnswer(); }
    if (event.type === "answer.delta") {
      text += event.text;
      // 只是合并真实片段以降低 Markdown 重绘次数，不模拟逐字打字。
      timer ??= setTimeout(flushAnswer, 50);
    }
  }

  async function start(input: ResearchAttempt, validate?: () => Promise<void>): Promise<void> {
    if (pending.value) return;
    const attempt: ResearchAttempt = { ...input, pages: input.pages.map((page) => ({ ...page })),
      noteIds: [...input.noteIds], options: { ...input.options } };
    lastAttempt.value = attempt;
    const current = ++revision;
    const request = new AbortController();
    controller = request;
    pending.value = true;
    unfinishedRun.value = true;
    phase.value = "running";
    error.value = "";
    steps.value = [];
    text = ""; flushAnswer();
    try {
      if (attempt.pages.some((page) => page.completeness !== "full")) throw new Error("网页正文不完整，请重新读取后再提问。");
      await options.beforeStart();
      request.signal.throwIfAborted();
      if (validate) await validate();
      request.signal.throwIfAborted();
      const result = await streamResearch({ question: attempt.question,
        materials: { pages: attempt.pages.map((page) => ({ ...page, completeness: "full" })), noteIds: attempt.noteIds }, options: attempt.options }, request.signal,
      (event) => { if (current === revision) receive(event); });
      if (current !== revision) return;
      flushAnswer();
      unfinishedRun.value = false;
      pending.value = false;
      phase.value = "completed";
      await options.completed(result, attempt);
    } catch (cause) {
      if (current !== revision) return;
      flushAnswer();
      error.value = request.signal.aborted ? "已停止本次研究。" : cause instanceof TypeError ? "无法连接本地服务，请确认后端正常运行后重试。" : cause instanceof Error ? cause.message : "本次研究失败，请重试。";
      phase.value = request.signal.aborted ? "stopped" : "failed";
      steps.value.forEach((step) => { if (step.state === "running") step.state = phase.value === "stopped" ? "stopped" : "failed"; });
      unfinishedRun.value = false;
    } finally {
      if (current === revision) { pending.value = false; controller = null; }
    }
  }

  function stop(): void {
    if (!pending.value) return;
    controller?.abort();
    revision += 1;
    flushAnswer();
    pending.value = false;
    unfinishedRun.value = false;
    phase.value = "stopped";
    error.value = "已停止本次研究。未完成内容不会保存到知识库。";
    steps.value.forEach((step) => { if (step.state === "running") step.state = "stopped"; });
  }

  function restore(attempt: ResearchAttempt | null, interrupted: boolean, status?: "stopped" | "failed" | null): void {
    lastAttempt.value = attempt;
    if (interrupted || status) {
      phase.value = status ?? "stopped";
      error.value = interrupted ? "上次研究已中断，没有自动重发。可以按原问题和原资料重试。"
        : status === "failed" ? "上次研究未完成，可以按原资料重试。" : "上次研究已停止，可以按原资料重试。";
    }
  }

  onUnmounted(() => {
    revision += 1;
    controller?.abort();
    clearTimeout(timer);
    // 真正卸载时保留未完成标记；恢复后交给用户决定是否重试。
  });

  return { pending, unfinishedRun, error, phase, steps, liveAnswer, lastAttempt, start, stop, restore,
    retry: () => lastAttempt.value ? start(lastAttempt.value) : Promise.resolve() };
}
