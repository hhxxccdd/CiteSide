import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // 容纳单篇最多 8 MiB 正文及 JSON 转义，与模型上下文容量独立。
  app.useBodyParser('json', { limit: '50mb' });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '127.0.0.1');
}

void bootstrap();

