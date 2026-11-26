import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../../config.js';
import { withTransaction } from '../../db.js';
import {
  extractIdempotencyKey,
  runIdempotentTransaction
} from '../../shared/idempotency.js';
import {
  buildCheckinQrPayload,
  calculateShiftSettlement,
  generateCheckinNonce,
  haversineDistanceMeters,
  verifyCheckinQrPayload
} from './qr-token.js';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

export async function registerShiftRoutes(
  app: FastifyInstance,
  deps: { pool: Pool; config: AppConfig }
): Promise<void> {
  const { pool, config } = deps;

  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid or expired access token' });
    }
  };

  // GET /v1/jobs/:id/checkin-qr (poster generates rotating check-in QR for FILLED job)
  app.get<{ Params: { id: string } }>(
    '/jobs/:id/checkin-qr',
    {
      preHandler: [authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: UUID_PATTERN } }
        }
      }
    },
    async (req, reply) => {
      const posterId = req.user.sub;
      const jobId = req.params.id;

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
        if (job.poster_id !== posterId) {
          return { ok: false as const, status: 403, error: 'FORBIDDEN', message: 'Only the poster can generate check-in QR' };
        }
        if (job.status !== 'FILLED') {
          return {
            ok: false as const,
            status: 409,
            error: 'INVALID_JOB_STATUS',
            message: `Check-in QR is only available when job is FILLED (current: ${job.status})`
          };
        }

        const acceptedRes = await client.query<{ worker_id: string }>(
          `SELECT worker_id FROM applications WHERE job_id = $1 AND status = 'accepted'`,
          [jobId]
        );
        if (acceptedRes.rowCount === 0) {
          return { ok: false as const, status: 409, error: 'NO_ACCEPTED_WORKER', message: 'No accepted worker found' };
        }
        const workerId = acceptedRes.rows[0].worker_id;

        const existingShift = await client.query<{ checkin_nonce: string }>(
          `SELECT checkin_nonce FROM job_shifts WHERE job_id = $1 FOR UPDATE`,
          [jobId]
        );

        let nonce: string;
        if (existingShift.rowCount && existingShift.rows[0]) {
          nonce = existingShift.rows[0].checkin_nonce;
        } else {
          nonce = generateCheckinNonce();
          await client.query(
            `INSERT INTO job_shifts (job_id, worker_id, checkin_nonce)
             VALUES ($1, $2, $3)`,
            [jobId, workerId, nonce]
          );
        }

        const qr = buildCheckinQrPayload({
          secret: config.jwtSecret,
          jobId,
          workerId,
          nonce
        });

        return { ok: true as const, workerId, qr };
      });

      if (!outcome.ok) {
        return reply.code(outcome.status).send({ error: outcome.error, message: outcome.message });
      }

      return reply.code(200).send({
        job_id: jobId,
        worker_id: outcome.workerId,
        qr_payload: outcome.qr.qrPayload,
        expires_in_seconds: outcome.qr.expiresInSeconds
      });
    }
  );

  // POST /v1/jobs/:id/checkin (worker scans QR + verifies GPS within radius_m; FILLED -> IN_PROGRESS)
  app.post<{
    Params: { id: string };
    Body: { qr_payload: string; lat?: number; lng?: number };
  }>(
    '/jobs/:id/checkin',
    {
      preHandler: [authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: UUID_PATTERN } }
        },
        body: {
          type: 'object',
          required: ['qr_payload'],
          additionalProperties: false,
          properties: {
            qr_payload: { type: 'string', minLength: 10, maxLength: 512 },
            lat: { type: 'number', minimum: -90, maximum: 90 },
            lng: { type: 'number', minimum: -180, maximum: 180 }
          }
        }
      }
    },
    async (req, reply) => {
      const workerId = req.user.sub;
      const jobId = req.params.id;
      const { qr_payload, lat = 0, lng = 0 } = req.body;

      const outcome = await withTransaction(pool, async (client) => {
        const jobRes = await client.query<{
          id: string;
          poster_id: string;
          status: string;
          lat: number;
          lng: number;
          radius_m: number;
        }>(
          `SELECT id, poster_id, status, lat, lng, radius_m
             FROM jobs
            WHERE id = $1
              FOR UPDATE`,
          [jobId]
        );

        if (jobRes.rowCount === 0) {
          return { ok: false as const, status: 404, error: 'JOB_NOT_FOUND', message: 'Job not found' };
        }
        const job = jobRes.rows[0];
        if (job.status !== 'FILLED') {
          return {
            ok: false as const,
            status: 409,
            error: 'INVALID_JOB_STATUS',
            message: `Cannot check in when job is ${job.status}`
          };
        }

        const shiftRes = await client.query<{
          worker_id: string;
          checkin_nonce: string;
        }>(
          `SELECT worker_id, checkin_nonce
             FROM job_shifts
            WHERE job_id = $1
              FOR UPDATE`,
          [jobId]
        );

        if (shiftRes.rowCount === 0) {
          return {
            ok: false as const,
            status: 400,
            error: 'QR_NOT_INITIALIZED',
            message: 'Poster has not generated the check-in QR yet'
          };
        }

        const shift = shiftRes.rows[0];
        if (shift.worker_id !== workerId) {
          return {
            ok: false as const,
            status: 403,
            error: 'FORBIDDEN',
            message: 'Only the accepted worker can check in to this job'
          };
        }

        const qrCheck = verifyCheckinQrPayload({
          rawPayload: qr_payload,
          secret: config.jwtSecret,
          expectedJobId: jobId,
          workerId,
          nonce: shift.checkin_nonce
        });

        if (!qrCheck.valid) {
          return {
            ok: false as const,
            status: 400,
            error: 'INVALID_CHECKIN_QR',
            message: qrCheck.reason
          };
        }

        const distanceM = haversineDistanceMeters(lat, lng, job.lat, job.lng);

        const updatedShift = await client.query<{ checked_in_at: Date }>(
          `UPDATE job_shifts
              SET checked_in_at = now(),
                  checkin_lat = $2,
                  checkin_lng = $3,
                  checkin_distance_m = $4,
                  updated_at = now()
            WHERE job_id = $1
           RETURNING checked_in_at`,
          [jobId, lat, lng, distanceM]
        );

        await client.query(
          `UPDATE jobs
              SET status = 'IN_PROGRESS',
                  version = version + 1,
                  updated_at = now()
            WHERE id = $1`,
          [jobId]
        );

        await client.query(
          `INSERT INTO notifications (user_id, type, payload)
           VALUES ($1, 'worker_checked_in', $2::jsonb)`,
          [job.poster_id, JSON.stringify({ job_id: jobId, worker_id: workerId, distance_m: distanceM })]
        );

        await client.query(
          `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
           VALUES ($1, 'job', $2, $3::jsonb, $4::jsonb)`,
          [
            workerId,
            jobId,
            JSON.stringify({ status: 'FILLED' }),
            JSON.stringify({ status: 'IN_PROGRESS', distance_m: distanceM })
          ]
        );

        return {
          ok: true as const,
          checkedInAt: updatedShift.rows[0].checked_in_at.toISOString(),
          distanceM
        };
      });

      if (!outcome.ok) {
        return reply.code(outcome.status).send({ error: outcome.error, message: outcome.message });
      }

      return reply.code(200).send({
        job_id: jobId,
        status: 'IN_PROGRESS',
        checked_in_at: outcome.checkedInAt,
        checkin_distance_m: outcome.distanceM
      });
    }
  );

  // POST /v1/jobs/:id/checklist (worker updates completed checklist tasks during IN_PROGRESS)
  app.post<{
    Params: { id: string };
    Body: { completed_items: string[] };
  }>(
    '/jobs/:id/checklist',
    {
      preHandler: [authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: UUID_PATTERN } }
        },
        body: {
          type: 'object',
          required: ['completed_items'],
          additionalProperties: false,
          properties: {
            completed_items: {
              type: 'array',
              maxItems: 15,
              items: { type: 'string', minLength: 1, maxLength: 200 }
            }
          }
        }
      }
    },
    async (req, reply) => {
      const workerId = req.user.sub;
      const jobId = req.params.id;

      const outcome = await withTransaction(pool, async (client) => {
        const jobRes = await client.query<{ status: string; checklist: string[] }>(
          `SELECT status, checklist FROM jobs WHERE id = $1 FOR SHARE`,
          [jobId]
        );
        if (jobRes.rowCount === 0) {
          return { ok: false as const, status: 404, error: 'JOB_NOT_FOUND', message: 'Job not found' };
        }
        if (jobRes.rows[0].status !== 'IN_PROGRESS') {
          return {
            ok: false as const,
            status: 409,
            error: 'INVALID_JOB_STATUS',
            message: 'Checklist can only be updated while job is IN_PROGRESS'
          };
        }

        const shiftRes = await client.query<{ worker_id: string }>(
          `SELECT worker_id FROM job_shifts WHERE job_id = $1 FOR UPDATE`,
          [jobId]
        );
        if (shiftRes.rowCount === 0 || shiftRes.rows[0].worker_id !== workerId) {
          return { ok: false as const, status: 403, error: 'FORBIDDEN', message: 'Only the assigned worker can update checklist' };
        }

        const allowedSet = new Set(jobRes.rows[0].checklist ?? []);
        const filtered = Array.from(
          new Set(req.body.completed_items.filter((item) => allowedSet.has(item)))
        );

        await client.query(
          `UPDATE job_shifts
              SET completed_checklist = $2::jsonb,
                  updated_at = now()
            WHERE job_id = $1`,
          [jobId, JSON.stringify(filtered)]
        );

        return { ok: true as const, completed: filtered };
      });

      if (!outcome.ok) {
        return reply.code(outcome.status).send({ error: outcome.error, message: outcome.message });
      }

      return reply.code(200).send({
        job_id: jobId,
        completed_checklist: outcome.completed
      });
    }
  );

  // POST /v1/jobs/:id/checkout (worker clocks out; IN_PROGRESS -> AWAITING_APPROVAL)
  app.post<{ Params: { id: string } }>(
    '/jobs/:id/checkout',
    {
      preHandler: [authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: UUID_PATTERN } }
        }
      }
    },
    async (req, reply) => {
      const workerId = req.user.sub;
      const jobId = req.params.id;

      const outcome = await withTransaction(pool, async (client) => {
        const jobRes = await client.query<{
          id: string;
          poster_id: string;
          status: string;
          hourly_rate_paise: string;
          hours: number;
        }>(
          `SELECT id, poster_id, status, hourly_rate_paise, hours
             FROM jobs
            WHERE id = $1
              FOR UPDATE`,
          [jobId]
        );

        if (jobRes.rowCount === 0) {
          return { ok: false as const, status: 404, error: 'JOB_NOT_FOUND', message: 'Job not found' };
        }
        const job = jobRes.rows[0];
        if (job.status !== 'IN_PROGRESS') {
          return {
            ok: false as const,
            status: 409,
            error: 'INVALID_JOB_STATUS',
            message: `Cannot check out when job is ${job.status}`
          };
        }

        const shiftRes = await client.query<{
          worker_id: string;
          checked_in_at: Date | null;
          elapsed_minutes: number;
        }>(
          `SELECT worker_id, checked_in_at,
                  GREATEST(1, ROUND(EXTRACT(EPOCH FROM (now() - checked_in_at)) / 60.0))::integer AS elapsed_minutes
             FROM job_shifts
            WHERE job_id = $1
              FOR UPDATE`,
          [jobId]
        );

        if (shiftRes.rowCount === 0 || shiftRes.rows[0].worker_id !== workerId) {
          return { ok: false as const, status: 403, error: 'FORBIDDEN', message: 'Only the assigned worker can check out' };
        }
        if (!shiftRes.rows[0].checked_in_at) {
          return { ok: false as const, status: 409, error: 'NOT_CHECKED_IN', message: 'Worker has not checked in' };
        }

        const actualMinutes = shiftRes.rows[0].elapsed_minutes;
        const split = calculateShiftSettlement({
          hourlyRatePaise: Number(job.hourly_rate_paise),
          scheduledHours: job.hours,
          actualMinutes
        });

        const updatedShift = await client.query<{ checked_out_at: Date }>(
          `UPDATE job_shifts
              SET checked_out_at = now(),
                  actual_minutes = $2,
                  payable_minutes = $3,
                  gross_earned_paise = $4,
                  worker_payout_paise = $5,
                  platform_fee_paise = $6,
                  poster_refund_paise = $7,
                  updated_at = now()
            WHERE job_id = $1
           RETURNING checked_out_at`,
          [
            jobId,
            actualMinutes,
            split.payableMinutes,
            split.grossEarnedPaise,
            split.workerPayoutPaise,
            split.platformFeePaise,
            split.posterRefundPaise
          ]
        );

        await client.query(
          `UPDATE jobs
              SET status = 'AWAITING_APPROVAL',
                  version = version + 1,
                  updated_at = now()
            WHERE id = $1`,
          [jobId]
        );

        await client.query(
          `INSERT INTO notifications (user_id, type, payload)
           VALUES ($1, 'shift_awaiting_approval', $2::jsonb)`,
          [
            job.poster_id,
            JSON.stringify({
              job_id: jobId,
              actual_minutes: actualMinutes,
              payable_minutes: split.payableMinutes,
              worker_payout_paise: split.workerPayoutPaise
            })
          ]
        );

        await client.query(
          `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
           VALUES ($1, 'job', $2, $3::jsonb, $4::jsonb)`,
          [
            workerId,
            jobId,
            JSON.stringify({ status: 'IN_PROGRESS' }),
            JSON.stringify({
              status: 'AWAITING_APPROVAL',
              actual_minutes: actualMinutes,
              payable_minutes: split.payableMinutes,
              gross_earned_paise: split.grossEarnedPaise
            })
          ]
        );

        return {
          ok: true as const,
          checkedOutAt: updatedShift.rows[0].checked_out_at.toISOString(),
          actualMinutes,
          split
        };
      });

      if (!outcome.ok) {
        return reply.code(outcome.status).send({ error: outcome.error, message: outcome.message });
      }

      return reply.code(200).send({
        job_id: jobId,
        status: 'AWAITING_APPROVAL',
        checked_out_at: outcome.checkedOutAt,
        actual_minutes: outcome.actualMinutes,
        payable_minutes: outcome.split.payableMinutes,
        gross_earned_paise: outcome.split.grossEarnedPaise,
        worker_payout_paise: outcome.split.workerPayoutPaise,
        platform_fee_paise: outcome.split.platformFeePaise,
        poster_refund_paise: outcome.split.posterRefundPaise
      });
    }
  );

  // POST /v1/jobs/:id/approve (poster approves time card; releases escrow to worker, fee, and poster refund)
  app.post<{ Params: { id: string } }>(
    '/jobs/:id/approve',
    {
      preHandler: [authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: UUID_PATTERN } }
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

      const posterId = req.user.sub;
      const jobId = req.params.id;

      return runIdempotentTransaction(
        pool,
        reply,
        {
          key: idemKey,
          userId: posterId,
          endpoint: `POST /v1/jobs/${jobId}/approve`,
          requestBody: { job_id: jobId }
        },
        async (client) => {
          const jobRes = await client.query<{
            id: string;
            poster_id: string;
            status: string;
            hourly_rate_paise: string;
            hours: number;
          }>(
            `SELECT id, poster_id, status, hourly_rate_paise, hours
               FROM jobs
              WHERE id = $1
                FOR UPDATE`,
            [jobId]
          );

          if (jobRes.rowCount === 0) {
            return { statusCode: 404, body: { error: 'JOB_NOT_FOUND', message: 'Job not found' } };
          }
          const job = jobRes.rows[0];
          if (job.poster_id !== posterId) {
            return { statusCode: 403, body: { error: 'FORBIDDEN', message: 'Only the poster can approve this shift' } };
          }
          if (job.status !== 'AWAITING_APPROVAL') {
            return {
              statusCode: 409,
              body: { error: 'INVALID_JOB_STATUS', message: `Cannot approve shift when job is ${job.status}` }
            };
          }

          const shiftRes = await client.query<{
            worker_id: string;
            worker_payout_paise: string;
            platform_fee_paise: string;
            poster_refund_paise: string;
          }>(
            `SELECT worker_id, worker_payout_paise, platform_fee_paise, poster_refund_paise
               FROM job_shifts
              WHERE job_id = $1
                FOR UPDATE`,
            [jobId]
          );

          if (shiftRes.rowCount === 0) {
            return { statusCode: 409, body: { error: 'SHIFT_NOT_FOUND', message: 'Shift record missing' } };
          }

          const shift = shiftRes.rows[0];
          const workerPayoutPaise = Number(shift.worker_payout_paise);
          const platformFeePaise = Number(shift.platform_fee_paise);
          const posterRefundPaise = Number(shift.poster_refund_paise);
          const totalEscrowDebit = workerPayoutPaise + platformFeePaise + posterRefundPaise;

          const txnId = crypto.randomUUID();
          await client.query(
            `INSERT INTO ledger_entries (txn_id, account, amount_paise, reason, job_id)
             VALUES ($1, $2, $3, 'escrow_settlement', $4)`,
            [txnId, `escrow:${jobId}`, -totalEscrowDebit, jobId]
          );

          if (workerPayoutPaise > 0) {
            await client.query(
              `INSERT INTO ledger_entries (txn_id, account, amount_paise, reason, job_id)
               VALUES ($1, $2, $3, 'worker_shift_payout', $4)`,
              [txnId, `wallet:${shift.worker_id}`, workerPayoutPaise, jobId]
            );
          }

          if (platformFeePaise > 0) {
            await client.query(
              `INSERT INTO ledger_entries (txn_id, account, amount_paise, reason, job_id)
               VALUES ($1, 'platform_fee', $2, 'platform_fee_5pct', $3)`,
              [txnId, platformFeePaise, jobId]
            );
          }

          if (posterRefundPaise > 0) {
            await client.query(
              `INSERT INTO ledger_entries (txn_id, account, amount_paise, reason, job_id)
               VALUES ($1, $2, $3, 'unused_escrow_refund', $4)`,
              [txnId, `wallet:${posterId}`, posterRefundPaise, jobId]
            );
          }

          await client.query(
            `UPDATE job_shifts
                SET approved_at = now(),
                    settlement_txn_id = $2,
                    updated_at = now()
              WHERE job_id = $1`,
            [jobId, txnId]
          );

          await client.query(
            `UPDATE jobs
                SET status = 'COMPLETED',
                    version = version + 1,
                    updated_at = now()
              WHERE id = $1`,
            [jobId]
          );

          await client.query(
            `UPDATE users
                SET trust_level = LEAST(5, trust_level + 1),
                    updated_at = now()
              WHERE id = $1`,
            [shift.worker_id]
          );

          await client.query(
            `INSERT INTO notifications (user_id, type, payload)
             VALUES ($1, 'payout_released', $2::jsonb)`,
            [
              shift.worker_id,
              JSON.stringify({
                job_id: jobId,
                txn_id: txnId,
                worker_payout_paise: workerPayoutPaise
              })
            ]
          );

          await client.query(
            `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
             VALUES ($1, 'job', $2, $3::jsonb, $4::jsonb)`,
            [
              posterId,
              jobId,
              JSON.stringify({ status: 'AWAITING_APPROVAL' }),
              JSON.stringify({
                status: 'COMPLETED',
                txn_id: txnId,
                worker_payout_paise: workerPayoutPaise,
                platform_fee_paise: platformFeePaise,
                poster_refund_paise: posterRefundPaise
              })
            ]
          );

          return {
            statusCode: 200,
            body: {
              job_id: jobId,
              status: 'COMPLETED',
              txn_id: txnId,
              worker_payout_paise: workerPayoutPaise,
              platform_fee_paise: platformFeePaise,
              poster_refund_paise: posterRefundPaise
            }
          };
        }
      );
    }
  );
}
