import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../../config.js';
import { withTransaction } from '../../db.js';
import {
  extractIdempotencyKey,
  runIdempotentTransaction
} from '../../shared/idempotency.js';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const SYSTEM_ADMIN_ID = '00000000-0000-0000-0000-000000000001';

export async function registerAdminAndDisputeRoutes(
  app: FastifyInstance,
  deps: { pool: Pool; config: AppConfig }
): Promise<void> {
  const { pool, config } = deps;

  const authenticateUser = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid or expired access token' });
    }
  };

  const authenticateAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = req.headers['x-admin-key'];
    if (typeof raw !== 'string') {
      return reply.code(401).send({ error: 'ADMIN_UNAUTHORIZED', message: 'Missing x-admin-key header' });
    }
    const provided = Buffer.from(raw.trim(), 'utf8');
    const expected = Buffer.from(config.adminApiKey, 'utf8');
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      return reply.code(401).send({ error: 'ADMIN_UNAUTHORIZED', message: 'Invalid admin key' });
    }
  };

  // POST /v1/jobs/:id/dispute (poster or assigned worker freezes escrow during IN_PROGRESS or AWAITING_APPROVAL)
  app.post<{
    Params: { id: string };
    Body: { reason: string; evidence_note?: string };
  }>(
    '/jobs/:id/dispute',
    {
      preHandler: [authenticateUser],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: UUID_PATTERN } }
        },
        body: {
          type: 'object',
          required: ['reason'],
          additionalProperties: false,
          properties: {
            reason: { type: 'string', minLength: 5, maxLength: 300 },
            evidence_note: { type: 'string', maxLength: 1000 }
          }
        }
      }
    },
    async (req, reply) => {
      const actorId = req.user.sub;
      const jobId = req.params.id;
      const reason = req.body.reason.trim();
      const evidenceNote = (req.body.evidence_note ?? '').trim();

      try {
        const outcome = await withTransaction(pool, async (client) => {
          const jobRes = await client.query<{
            id: string;
            poster_id: string;
            status: string;
          }>(
            `SELECT id, poster_id, status FROM jobs WHERE id = $1 FOR UPDATE`,
            [jobId]
          );

          if (jobRes.rowCount === 0) {
            return { ok: false as const, status: 404, error: 'JOB_NOT_FOUND', message: 'Job not found' };
          }
          const job = jobRes.rows[0];
          if (job.status === 'DISPUTED') {
            return { ok: false as const, status: 409, error: 'ALREADY_DISPUTED', message: 'Job is already disputed' };
          }
          if (job.status !== 'IN_PROGRESS' && job.status !== 'AWAITING_APPROVAL') {
            return {
              ok: false as const,
              status: 409,
              error: 'INVALID_JOB_STATUS',
              message: `Disputes can only be raised during IN_PROGRESS or AWAITING_APPROVAL (current: ${job.status})`
            };
          }

          const shiftRes = await client.query<{ worker_id: string }>(
            `SELECT worker_id FROM job_shifts WHERE job_id = $1 FOR SHARE`,
            [jobId]
          );
          if (shiftRes.rowCount === 0) {
            return { ok: false as const, status: 409, error: 'SHIFT_NOT_FOUND', message: 'Shift record missing' };
          }
          const workerId = shiftRes.rows[0].worker_id;

          if (actorId !== job.poster_id && actorId !== workerId) {
            return {
              ok: false as const,
              status: 403,
              error: 'FORBIDDEN',
              message: 'Only the poster or assigned worker can dispute this job'
            };
          }

          const insertRes = await client.query<{ created_at: Date }>(
            `INSERT INTO job_disputes (job_id, raised_by, reason, evidence_note)
             VALUES ($1, $2, $3, $4)
             RETURNING created_at`,
            [jobId, actorId, reason, evidenceNote]
          );

          await client.query(
            `UPDATE jobs
                SET status = 'DISPUTED',
                    version = version + 1,
                    updated_at = now()
              WHERE id = $1`,
            [jobId]
          );

          const otherPartyId = actorId === job.poster_id ? workerId : job.poster_id;
          await client.query(
            `INSERT INTO notifications (user_id, type, payload)
             VALUES ($1, 'job_disputed', $2::jsonb)`,
            [otherPartyId, JSON.stringify({ job_id: jobId, raised_by: actorId, reason })]
          );

          await client.query(
            `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
             VALUES ($1, 'job', $2, $3::jsonb, $4::jsonb)`,
            [
              actorId,
              jobId,
              JSON.stringify({ status: job.status }),
              JSON.stringify({ status: 'DISPUTED', reason })
            ]
          );

          return {
            ok: true as const,
            createdAt: insertRes.rows[0].created_at.toISOString()
          };
        });

        if (!outcome.ok) {
          return reply.code(outcome.status).send({ error: outcome.error, message: outcome.message });
        }

        return reply.code(201).send({
          job_id: jobId,
          status: 'DISPUTED',
          raised_by: actorId,
          reason,
          evidence_note: evidenceNote,
          created_at: outcome.createdAt
        });
      } catch (err) {
        const pgErr = err as { code?: string };
        if (pgErr?.code === '23505') {
          return reply.code(409).send({ error: 'ALREADY_DISPUTED', message: 'Job is already disputed' });
        }
        throw err;
      }
    }
  );

  // GET /v1/admin/overview (ledger invariant, disputes, jobs, users)
  app.get('/admin/overview', { preHandler: [authenticateAdmin] }, async (_req, reply) => {
    const [invariantRes, disputesRes, jobsRes, usersRes] = await Promise.all([
      pool.query<{ sum_paise: string; total_entries: string }>(
        `SELECT COALESCE(SUM(amount_paise), 0)::bigint AS sum_paise,
                COUNT(*)::bigint AS total_entries
           FROM ledger_entries`
      ),
      pool.query<{
        job_id: string;
        job_title: string;
        poster_id: string;
        poster_name: string | null;
        worker_id: string;
        worker_name: string | null;
        raised_by: string;
        reason: string;
        evidence_note: string;
        status: string;
        resolution_note: string | null;
        escrow_held_paise: string;
        worker_payout_paise: string | null;
        platform_fee_paise: string | null;
        poster_refund_paise: string | null;
        created_at: Date;
        resolved_at: Date | null;
      }>(
        `SELECT d.job_id, j.title AS job_title,
                j.poster_id, p.verified_name AS poster_name,
                s.worker_id, w.verified_name AS worker_name,
                d.raised_by, d.reason, d.evidence_note, d.status, d.resolution_note,
                COALESCE((
                  SELECT SUM(amount_paise)
                    FROM ledger_entries
                   WHERE account = 'escrow:' || d.job_id::text
                ), 0)::bigint AS escrow_held_paise,
                d.worker_payout_paise, d.platform_fee_paise, d.poster_refund_paise,
                d.created_at, d.resolved_at
           FROM job_disputes d
           JOIN jobs j ON j.id = d.job_id
           JOIN job_shifts s ON s.job_id = d.job_id
           JOIN users p ON p.id = j.poster_id
           JOIN users w ON w.id = s.worker_id
          ORDER BY d.created_at DESC`
      ),
      pool.query<{
        id: string;
        title: string;
        status: string;
        is_hidden: boolean;
        hourly_rate_paise: string;
        hours: number;
        poster_name: string | null;
        escrow_held_paise: string;
        created_at: Date;
      }>(
        `SELECT j.id, j.title, j.status, j.is_hidden, j.hourly_rate_paise, j.hours,
                u.verified_name AS poster_name,
                COALESCE((
                  SELECT SUM(amount_paise)
                    FROM ledger_entries
                   WHERE account = 'escrow:' || j.id::text
                ), 0)::bigint AS escrow_held_paise,
                j.created_at
           FROM jobs j
           JOIN users u ON u.id = j.poster_id
          ORDER BY j.created_at DESC
          LIMIT 50`
      ),
      pool.query<{
        id: string;
        phone: string;
        verified_name: string | null;
        status: string;
        age_verified_at: Date | null;
        trust_level: number;
        responsiveness_score: number;
        balance_paise: string;
      }>(
        `SELECT u.id, u.phone, u.verified_name, u.status, u.age_verified_at,
                u.trust_level, u.responsiveness_score, w.balance_paise
           FROM users u
           JOIN wallets w ON w.user_id = u.id
          WHERE u.id <> $1
          ORDER BY u.created_at DESC
          LIMIT 50`,
        [SYSTEM_ADMIN_ID]
      )
    ]);

    const sumPaise = Number(invariantRes.rows[0].sum_paise);

    return reply.code(200).send({
      ledger_invariant: {
        sum_paise: sumPaise,
        is_zero_sum: sumPaise === 0,
        total_entries: Number(invariantRes.rows[0].total_entries)
      },
      disputes: disputesRes.rows.map((d) => ({
        job_id: d.job_id,
        job_title: d.job_title,
        poster_id: d.poster_id,
        poster_name: d.poster_name ?? 'Poster',
        worker_id: d.worker_id,
        worker_name: d.worker_name ?? 'Worker',
        raised_by: d.raised_by,
        reason: d.reason,
        evidence_note: d.evidence_note,
        status: d.status,
        resolution_note: d.resolution_note,
        escrow_held_paise: Number(d.escrow_held_paise),
        worker_payout_paise: d.worker_payout_paise !== null ? Number(d.worker_payout_paise) : null,
        platform_fee_paise: d.platform_fee_paise !== null ? Number(d.platform_fee_paise) : null,
        poster_refund_paise: d.poster_refund_paise !== null ? Number(d.poster_refund_paise) : null,
        created_at: d.created_at.toISOString(),
        resolved_at: d.resolved_at ? d.resolved_at.toISOString() : null
      })),
      jobs: jobsRes.rows.map((j) => ({
        id: j.id,
        title: j.title,
        status: j.status,
        is_hidden: j.is_hidden,
        total_paise: Number(j.hourly_rate_paise) * j.hours,
        escrow_held_paise: Number(j.escrow_held_paise),
        poster_name: j.poster_name ?? 'Unverified',
        created_at: j.created_at.toISOString()
      })),
      users: usersRes.rows.map((u) => ({
        id: u.id,
        phone: u.phone,
        verified_name: u.verified_name,
        status: u.status,
        age_verified: u.age_verified_at !== null,
        trust_level: u.trust_level,
        responsiveness_score: u.responsiveness_score,
        wallet_balance_paise: Number(u.balance_paise)
      }))
    });
  });

  // POST /v1/admin/disputes/:jobId/resolve (idempotent escrow split resolution; DISPUTED -> COMPLETED)
  app.post<{
    Params: { jobId: string };
    Body: {
      worker_payout_paise: number;
      platform_fee_paise: number;
      poster_refund_paise: number;
      resolution_note: string;
    };
  }>(
    '/admin/disputes/:jobId/resolve',
    {
      preHandler: [authenticateAdmin],
      schema: {
        params: {
          type: 'object',
          required: ['jobId'],
          properties: { jobId: { type: 'string', pattern: UUID_PATTERN } }
        },
        body: {
          type: 'object',
          required: [
            'worker_payout_paise',
            'platform_fee_paise',
            'poster_refund_paise',
            'resolution_note'
          ],
          additionalProperties: false,
          properties: {
            worker_payout_paise: { type: 'integer', minimum: 0 },
            platform_fee_paise: { type: 'integer', minimum: 0 },
            poster_refund_paise: { type: 'integer', minimum: 0 },
            resolution_note: { type: 'string', minLength: 3, maxLength: 500 }
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

      const { jobId } = req.params;
      const {
        worker_payout_paise,
        platform_fee_paise,
        poster_refund_paise,
        resolution_note
      } = req.body;

      return runIdempotentTransaction(
        pool,
        reply,
        {
          key: idemKey,
          userId: SYSTEM_ADMIN_ID,
          endpoint: `POST /v1/admin/disputes/${jobId}/resolve`,
          requestBody: req.body
        },
        async (client) => {
          const jobRes = await client.query<{
            id: string;
            poster_id: string;
            status: string;
          }>(
            `SELECT id, poster_id, status FROM jobs WHERE id = $1 FOR UPDATE`,
            [jobId]
          );

          if (jobRes.rowCount === 0) {
            return { statusCode: 404, body: { error: 'JOB_NOT_FOUND', message: 'Job not found' } };
          }
          const job = jobRes.rows[0];
          if (job.status !== 'DISPUTED') {
            return {
              statusCode: 409,
              body: { error: 'INVALID_JOB_STATUS', message: `Job is not DISPUTED (current: ${job.status})` }
            };
          }

          const shiftRes = await client.query<{ worker_id: string }>(
            `SELECT worker_id FROM job_shifts WHERE job_id = $1 FOR UPDATE`,
            [jobId]
          );
          if (shiftRes.rowCount === 0) {
            return { statusCode: 409, body: { error: 'SHIFT_NOT_FOUND', message: 'Shift record missing' } };
          }
          const workerId = shiftRes.rows[0].worker_id;

          const escrowAccount = `escrow:${jobId}`;
          const heldRes = await client.query<{ held: string }>(
            `SELECT COALESCE(SUM(amount_paise), 0)::bigint AS held
               FROM ledger_entries
              WHERE account = $1`,
            [escrowAccount]
          );
          const heldPaise = Number(heldRes.rows[0].held);
          const requestedTotal = worker_payout_paise + platform_fee_paise + poster_refund_paise;

          if (requestedTotal !== heldPaise) {
            return {
              statusCode: 400,
              body: {
                error: 'SPLIT_MISMATCH',
                message: `Split total (${requestedTotal}) must equal held escrow (${heldPaise})`
              }
            };
          }

          const txnId = crypto.randomUUID();
          if (heldPaise > 0) {
            await client.query(
              `INSERT INTO ledger_entries (txn_id, account, amount_paise, reason, job_id)
               VALUES ($1, $2, $3, 'dispute_resolution_settlement', $4)`,
              [txnId, escrowAccount, -heldPaise, jobId]
            );
          }

          if (worker_payout_paise > 0) {
            await client.query(
              `INSERT INTO ledger_entries (txn_id, account, amount_paise, reason, job_id)
               VALUES ($1, $2, $3, 'dispute_worker_payout', $4)`,
              [txnId, `wallet:${workerId}`, worker_payout_paise, jobId]
            );
          }

          if (platform_fee_paise > 0) {
            await client.query(
              `INSERT INTO ledger_entries (txn_id, account, amount_paise, reason, job_id)
               VALUES ($1, 'platform_fee', $2, 'dispute_platform_fee', $3)`,
              [txnId, platform_fee_paise, jobId]
            );
          }

          if (poster_refund_paise > 0) {
            await client.query(
              `INSERT INTO ledger_entries (txn_id, account, amount_paise, reason, job_id)
               VALUES ($1, $2, $3, 'dispute_poster_refund', $4)`,
              [txnId, `wallet:${job.poster_id}`, poster_refund_paise, jobId]
            );
          }

          const cleanNote = resolution_note.trim();
          await client.query(
            `UPDATE job_disputes
                SET status = 'resolved',
                    resolution_note = $2,
                    worker_payout_paise = $3,
                    platform_fee_paise = $4,
                    poster_refund_paise = $5,
                    settlement_txn_id = $6,
                    resolved_at = now(),
                    updated_at = now()
              WHERE job_id = $1`,
            [jobId, cleanNote, worker_payout_paise, platform_fee_paise, poster_refund_paise, txnId]
          );

          await client.query(
            `UPDATE jobs
                SET status = 'COMPLETED',
                    version = version + 1,
                    updated_at = now()
              WHERE id = $1`,
            [jobId]
          );

          for (const recipientId of [job.poster_id, workerId]) {
            await client.query(
              `INSERT INTO notifications (user_id, type, payload)
               VALUES ($1, 'dispute_resolved', $2::jsonb)`,
              [
                recipientId,
                JSON.stringify({
                  job_id: jobId,
                  txn_id: txnId,
                  worker_payout_paise,
                  platform_fee_paise,
                  poster_refund_paise,
                  resolution_note: cleanNote
                })
              ]
            );
          }

          await client.query(
            `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
             VALUES ($1, 'job', $2, $3::jsonb, $4::jsonb)`,
            [
              SYSTEM_ADMIN_ID,
              jobId,
              JSON.stringify({ status: 'DISPUTED' }),
              JSON.stringify({
                status: 'COMPLETED',
                txn_id: txnId,
                worker_payout_paise,
                platform_fee_paise,
                poster_refund_paise,
                resolution_note: cleanNote
              })
            ]
          );

          return {
            statusCode: 200,
            body: {
              job_id: jobId,
              status: 'COMPLETED',
              txn_id: txnId,
              worker_payout_paise,
              platform_fee_paise,
              poster_refund_paise,
              resolution_note: cleanNote
            }
          };
        }
      );
    }
  );

  // POST /v1/admin/jobs/:id/moderate (hide/unhide job)
  app.post<{
    Params: { id: string };
    Body: { is_hidden: boolean; reason?: string };
  }>(
    '/admin/jobs/:id/moderate',
    {
      preHandler: [authenticateAdmin],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: UUID_PATTERN } }
        },
        body: {
          type: 'object',
          required: ['is_hidden'],
          additionalProperties: false,
          properties: {
            is_hidden: { type: 'boolean' },
            reason: { type: 'string', maxLength: 300 }
          }
        }
      }
    },
    async (req, reply) => {
      const jobId = req.params.id;
      const { is_hidden, reason } = req.body;

      const updated = await withTransaction(pool, async (client) => {
        const res = await client.query<{ id: string; is_hidden: boolean }>(
          `UPDATE jobs
              SET is_hidden = $2,
                  updated_at = now()
            WHERE id = $1
           RETURNING id, is_hidden`,
          [jobId, is_hidden]
        );
        if (res.rowCount === 0) return null;

        await client.query(
          `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
           VALUES ($1, 'job', $2, NULL, $3::jsonb)`,
          [SYSTEM_ADMIN_ID, jobId, JSON.stringify({ is_hidden, reason: (reason ?? '').trim() })]
        );
        return res.rows[0];
      });

      if (!updated) {
        return reply.code(404).send({ error: 'JOB_NOT_FOUND', message: 'Job not found' });
      }
      return reply.code(200).send(updated);
    }
  );

  // POST /v1/admin/users/:id/status (suspend/reactivate user)
  app.post<{
    Params: { id: string };
    Body: { status: 'active' | 'suspended'; reason?: string };
  }>(
    '/admin/users/:id/status',
    {
      preHandler: [authenticateAdmin],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: UUID_PATTERN } }
        },
        body: {
          type: 'object',
          required: ['status'],
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: ['active', 'suspended'] },
            reason: { type: 'string', maxLength: 300 }
          }
        }
      }
    },
    async (req, reply) => {
      const userId = req.params.id;
      const { status, reason } = req.body;

      const updated = await withTransaction(pool, async (client) => {
        const res = await client.query<{ id: string; status: string }>(
          `UPDATE users
              SET status = $2,
                  updated_at = now()
            WHERE id = $1
           RETURNING id, status`,
          [userId, status]
        );
        if (res.rowCount === 0) return null;

        if (status === 'suspended') {
          await client.query(
            `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
            [userId]
          );
        }

        await client.query(
          `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
           VALUES ($1, 'user', $2, NULL, $3::jsonb)`,
          [SYSTEM_ADMIN_ID, userId, JSON.stringify({ status, reason: (reason ?? '').trim() })]
        );
        return res.rows[0];
      });

      if (!updated) {
        return reply.code(404).send({ error: 'USER_NOT_FOUND', message: 'User not found' });
      }
      return reply.code(200).send(updated);
    }
  );
}
