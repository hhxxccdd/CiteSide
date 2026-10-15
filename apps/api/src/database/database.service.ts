import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    const connectionString = config.get<string>('DATABASE_URL');
    if (!connectionString) {
      throw new Error('DATABASE_URL is required. Copy apps/api/.env.example to apps/api/.env.');
    }
    this.pool = new Pool({ connectionString });
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async query<T extends QueryResultRow>(sql:string,values:unknown[] = []):Promise<QueryResult<T>>{
       return this.pool.query<T>(sql,values)
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

