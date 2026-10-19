import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ResearchExecution } from './research-execution';
import { parseResearchInput } from './dto/research-input.dto';
import {
  ResearchResult,
  ResearchService,
} from './research.service';

@Controller('research')
export class ResearchController {
  constructor(private readonly research: ResearchService) {}

  @Post('run')
  async run(@Body() body: unknown): Promise<ResearchResult> {
    return this.research.run(parseResearchInput(body));
  }

  @Post('run/stream')
  async stream(@Body() body: unknown, @Res() response: Response): Promise<void> {
    const input = parseResearchInput(body);
    const controller = new AbortController();
    const onClose = () => { if (!response.writableEnded) controller.abort(); };
    response.on('close', onClose);
    response.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    const execution = new ResearchExecution(randomUUID(), controller.signal, (event) => {
      if (!response.destroyed) response.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => { if (!response.destroyed) response.write(': heartbeat\n\n'); }, 15_000);
    try {
      const result = await this.research.run(input, execution);
      execution.emit({ type: 'run.completed', result });
    } catch (error) {
      if (!controller.signal.aborted) execution.emit({ type: 'run.failed', message:
        error instanceof Error ? error.message : '本次研究未完成，请重试。' });
    } finally {
      clearInterval(heartbeat);
      response.off('close', onClose);
      if (!response.destroyed) response.end();
    }
  }
}
