import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import {
  extractIdempotencyKey,
  runIdempotentTransaction
} from '../../shared/idempotency.js';

export async function registerWalletRoutes(
  app: FastifyInstance,
  deps: { pool: Pool }
): Promise<void> {
  const { pool } = deps;

  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid or expired access token' });
    }
  };

  // POST /v1/wallet/topup (simulated funding for demo; idempotent)
  app.post<{ Body: { amount_paise: number } }>(
    '/wallet/topup',
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['amount_paise'],
          additionalProperties: false,
          properties: {
            amount_paise: { type: 'integer', minimum: 1000, maximum: 5000000 }
          }
        }
      }
    },
    async (req, reply) => {
      const idemKey = extractIdempotencyKey(req);
      if (!idemKey) {
        return reply.code(400).send({
          error: 'MISSING_IDEMPOTENCY_KEY',
          message: 'Idempotency-Key header (8-128 chars) is required'
        });
      }

      const userId = req.user.sub;
      const { amount_paise } = req.body;

      return runIdempotentTransaction(
        pool,
        reply,
        {
          key: idemKey,
          userId,
          endpoint: 'POST /v1/wallet/topup',
          requestBody: req.body
        },
        async (client) => {
          const userRes = await client.query<{ status: string }>(
            `SELECT status FROM users WHERE id = $1 FOR UPDATE`,
            [userId]
          );
          if (userRes.rowCount === 0) {
            return { statusCode: 404, body: { error: 'USER_NOT_FOUND', message: 'User not found' } };
          }
          if (userRes.rows[0].status !== 'active') {
            return { statusCode: 403, body: { error: 'ACCOUNT_DISABLED', message: 'Account is not active' } };
          }

          const txnId = crypto.randomUUID();
          await client.query(
            `INSERT INTO ledger_entries (txn_id, account, amount_paise, reason)
             VALUES
               ($1, 'external_funding', $2, 'simulated_topup'),
               ($1, $3, $4, 'simulated_topup')`,
            [txnId, -amount_paise, `wallet:${userId}`, amount_paise]
          );

          const walletRes = await client.query<{ balance_paise: string }>(
            `SELECT balance_paise FROM wallets WHERE user_id = $1`,
            [userId]
          );
          const newBalance = Number(walletRes.rows[0].balance_paise);

          await client.query(
            `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
             VALUES ($1, 'wallet', $1, NULL, $2::jsonb)`,
            [
              userId,
              JSON.stringify({
                event: 'simulated_topup',
                txn_id: txnId,
                amount_paise,
                balance_paise: newBalance
              })
            ]
          );

          return {
            statusCode: 200,
            body: {
              txn_id: txnId,
              amount_paise,
              wallet_balance_paise: newBalance
            }
          };
        }
      );
    }
  );

  // GET /v1/wallet/ledger
  app.get('/wallet/ledger', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = req.user.sub;

    const [walletRes, entriesRes] = await Promise.all([
      pool.query<{ balance_paise: string }>(
        `SELECT balance_paise FROM wallets WHERE user_id = $1`,
        [userId]
      ),
      pool.query<{
        id: string;
        txn_id: string;
        account: string;
        amount_paise: string;
        reason: string;
        job_id: string | null;
        created_at: Date;
      }>(
        `SELECT id, txn_id, account, amount_paise, reason, job_id, created_at
           FROM ledger_entries
          WHERE account = $1
          ORDER BY created_at DESC
          LIMIT 50`,
        [`wallet:${userId}`]
      )
    ]);

    if (walletRes.rowCount === 0) {
      return reply.code(404).send({ error: 'WALLET_NOT_FOUND', message: 'Wallet not found' });
    }

    return reply.code(200).send({
      wallet_balance_paise: Number(walletRes.rows[0].balance_paise),
      entries: entriesRes.rows.map((r) => ({
        id: r.id,
        txn_id: r.txn_id,
        account: r.account,
        amount_paise: Number(r.amount_paise),
        reason: r.reason,
        job_id: r.job_id,
        created_at: r.created_at.toISOString()
      }))
    });
  });
}
