import type { QwenRequestOptions } from "../llm/qwen.client";
import type { ResearchResult } from "./research.service";

export interface ResearchStepInfo {
  detail?: string;
  links?: Array<{ title: string; url: string }>;
}

export type ResearchEventData =
  | { type: "run.started" }
  | ({ type: "step.started"; stepId: string; label: string } & ResearchStepInfo)
  | ({ type: "step.completed"; stepId: string } & ResearchStepInfo)
  | { type: "step.failed"; stepId: string; message: string }
  | { type: "answer.reset" }
  | { type: "answer.delta"; text: string }
  | { type: "run.completed"; result: ResearchResult }
  | { type: "run.failed"; message: string };

export type ResearchEvent = ResearchEventData & { runId: string; sequence: number };

// 每次请求各有一个实例。这里只记录实际执行，不决定模型该调用什么工具。
export class ResearchExecution {
  private sequence = 0;
  private stepNumber = 0;

  constructor(
    readonly runId: string,
    readonly signal: AbortSignal,
    private readonly publish: (event: ResearchEvent) => void,
  ) {}

  emit(event: ResearchEventData): void {
    this.signal.throwIfAborted();
    this.publish({ ...event, runId: this.runId, sequence: ++this.sequence });
  }

  answerOptions(): QwenRequestOptions {
    this.emit({ type: "answer.reset" });
    return { signal: this.signal, onDelta: (text) => this.emit({ type: "answer.delta", text }) };
  }

  async step<T>(label: string, task: () => Promise<T>, describe?: (result: T) => string | ResearchStepInfo,
    initial?: ResearchStepInfo): Promise<T> {
    const stepId = `step-${++this.stepNumber}`;
    this.emit({ type: "step.started", stepId, label, ...initial });
    try {
      const result = await task();
      this.signal.throwIfAborted();
      const info = describe?.(result);
      this.emit({ type: "step.completed", stepId, ...(typeof info === "string" ? { detail: info } : info) });
      return result;
    } catch (error) {
      this.signal.throwIfAborted();
      this.emit({ type: "step.failed", stepId, message: error instanceof Error ? error.message : "执行失败" });
      throw error;
    }
  }
}

export function researchStep<T>(execution: ResearchExecution | undefined, label: string,
  task: () => Promise<T>, describe?: (result: T) => string | ResearchStepInfo, initial?: ResearchStepInfo): Promise<T> {
  return execution ? execution.step(label, task, describe, initial) : task();
}
