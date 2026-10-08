import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from './database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  async check(): Promise<{ api: 'ok'; database: 'ok' }> {
    try {
      await this.database.ping();
      return { api: 'ok', database: 'ok' };
    } catch {
      throw new ServiceUnavailableException('PostgreSQL is unavailable');
    }
  }
}

