import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health.controller';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { ResearchModule } from './research/research.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule,KnowledgeModule,ResearchModule],
  controllers: [HealthController],
})
export class AppModule {}

