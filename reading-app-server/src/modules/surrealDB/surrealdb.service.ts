import { Injectable, OnModuleInit } from '@nestjs/common';
import { config } from '../../config/runtime-config';

type SurrealStatementResult<T> = {
  status: string;
  result: T;
  detail?: string;
  kind?: string;
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');
const stripSurrealMetadata = <T extends object>(record: T): T => {
  const sanitized = { ...(record as Record<string, unknown>) };
  delete sanitized.id;
  return sanitized as T;
};

@Injectable()
export class SurrealService implements OnModuleInit {
  private endpoint = '';

  async onModuleInit(): Promise<void> {
    const missing = [
      ['SURREAL_URL', config.surrealUrl],
      ['SURREAL_NS', config.surrealNamespace],
      ['SURREAL_DB', config.surrealDatabase],
      ['SURREAL_USER', config.surrealUser],
      ['SURREAL_PASS', config.surrealPass],
    ].filter(([, value]) => value.trim() === '');

    if (missing.length > 0) {
      throw new Error(`Missing SurrealDB configuration: ${missing.map(([key]) => key).join(', ')}`);
    }

    this.endpoint = trimTrailingSlash(config.surrealUrl);
    await this.healthcheck();
  }

  async query<T>(sql: string): Promise<T[]> {
    this.ensureConfigured();
    const response = await fetch(`${this.endpoint}/sql`, {
      method: 'POST',
      headers: {
        ...this.createHeaders(),
        'Content-Type': 'text/plain',
      },
      body: sql,
    });

    const payload = await this.parseJson<SurrealStatementResult<T>[]>(response);
    if (!response.ok) {
      throw new Error(`SurrealDB query failed with HTTP ${response.status}`);
    }

    for (const statement of payload) {
      if (statement.status !== 'OK') {
        const detail = typeof statement.detail === 'string' && statement.detail.trim().length > 0
          ? statement.detail
          : undefined;
        const result = typeof statement.result === 'string' && statement.result.trim().length > 0
          ? statement.result
          : undefined;
        const kind = statement.kind ? `[${statement.kind}] ` : '';
        throw new Error(`${kind}${detail ?? result ?? 'SurrealDB query returned a non-OK statement status'}`);
      }
    }

    return payload.map((statement) => statement.result);
  }

  async selectTable<T>(table: string): Promise<T[]> {
    const [result = []] = await this.query<T[]>(`SELECT * FROM ${table};`);
    return result;
  }

  async selectRecord<T>(table: string, id: string): Promise<T | null> {
    const [result = []] = await this.query<T[]>(`SELECT * FROM ${table}:${id};`);
    return result[0] ?? null;
  }

  async putRecord<T extends object>(table: string, id: string, record: T): Promise<void> {
    this.ensureConfigured();
    const sanitizedRecord = stripSurrealMetadata(record);
    const response = await fetch(`${this.endpoint}/key/${table}/${id}`, {
      method: 'PUT',
      headers: {
        ...this.createHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sanitizedRecord),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`SurrealDB write failed with HTTP ${response.status}${body ? `: ${body}` : ''}`);
    }
  }

  async putRelationRecord<T extends object>(
    table: string,
    id: string,
    inRef: string,
    outRef: string,
    record: T,
  ): Promise<void> {
    const relationContent = { ...(stripSurrealMetadata(record) as Record<string, unknown>) };
    delete relationContent.in;
    delete relationContent.out;
    const content = JSON.stringify(relationContent);
    await this.query<unknown>([
      `DELETE ONLY ${table}:${id};`,
      `RELATE ${inRef}->${table}:${id}->${outRef} CONTENT ${content};`,
    ].join('\n'));
  }

  private async healthcheck(): Promise<void> {
    const response = await fetch(`${this.endpoint}/health`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`SurrealDB healthcheck failed with HTTP ${response.status}`);
    }
  }

  private createHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${config.surrealUser}:${config.surrealPass}`, 'utf8').toString('base64')}`,
      'Surreal-NS': config.surrealNamespace,
      'Surreal-DB': config.surrealDatabase,
    };
  }

  private ensureConfigured(): void {
    if (this.endpoint.trim() === '') {
      throw new Error('SurrealDB client is not initialized');
    }
  }

  private async parseJson<T>(response: Response): Promise<T> {
    try {
      return await response.json() as T;
    } catch (error) {
      throw new Error(
        `Failed to parse SurrealDB response JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
