import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../db.js';

export interface IdempotentResult {
  statusCode: number;
  body: Record<string, unknown>;
}

export function hashRequestBody(body: unknown): string {
  const canonical = JSON.stringify(body ?? null);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function extractIdempotencyKey(req: FastifyRequest): string | null {
  const raw = req.headers['idempotency-key'];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 8 || trimmed.length > 128) return null;
  return trimmed;
}

export async function runIdempotentTransaction(
  pool: Pool,
  reply: FastifyReply,
  params: {
    key: string;
    userId: string;
    endpoint: string;
    requestBody: unknown;
  },
  fn: (client: PoolClient) => Promise<IdempotentResult>
): Promise<FastifyReply> {
  const requestHash = hashRequestBody(params.requestBody);

  const outcome = await withTransaction(pool, async (client) => {
    const existing = await client.query<{
      user_id: string;
      endpoint: string;
      request_hash: string;
      status_code: number;
      response: Record<string, unknown>;
    }>(
      `SELECT user_id, endpoint, request_hash, status_code, response
         FROM idempotency_keys
        WHERE key = $1
          FOR UPDATE`,
      [params.key]
    );

    if (existing.rowCount && existing.rows[0]) {
      const row = existing.rows[0];
      if (
        row.user_id !== params.userId ||
        row.endpoint !== params.endpoint ||
        row.request_hash !== requestHash
      ) {
        return {
          statusCode: 409,
          body: {
            error: 'IDEMPOTENCY_CONFLICT',
            message: 'Idempotency-Key was already used with a different request'
          }
        };
      }
      return {
        statusCode: row.status_code,
        body: row.response
      };
    }

    const result = await fn(client);

    if (result.statusCode >= 200 && result.statusCode < 300) {
      await client.query(
        `INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, status_code, response)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          params.key,
          params.userId,
          params.endpoint,
          requestHash,
          result.statusCode,
          JSON.stringify(result.body)
        ]
      );
    }

    return result;
  });

  return reply.code(outcome.statusCode).send(outcome.body);
}
