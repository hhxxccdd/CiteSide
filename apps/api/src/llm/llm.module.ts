import { Module } from '@nestjs/common';
import { QwenClient } from './qwen.client';

@Module({
  providers: [QwenClient],
  exports: [QwenClient],
})
export class LlmModule {}