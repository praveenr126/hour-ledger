import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { withTransaction } from '../../db.js';
import {
  extractIdempotencyKey,
  runIdempotentTransaction
} from '../../shared/idempotency.js';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

interface CreateJobBody {
  title: string;
  description: string;
  checklist?: string[];
  hourly_rate_paise: number;
  hours: number;
  lat?: number;
  lng?: number;
  radius_m?: number;
  address_text?: string;
  start_at: string;
}

export async function registerJobRoutes(
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

  // POST /v1/jobs (creates a DRAFT job; requires 18+ verification)
  app.post<{ Body: CreateJobBody }>(
    '/jobs',
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['title', 'description', 'hourly_rate_paise', 'hours', 'start_at'],
          additionalProperties: false,
          properties: {
            title: { type: 'string', minLength: 3, maxLength: 120 },
            description: { type: 'string', minLength: 5, maxLength: 2000 },
            checklist: {
              type: 'array',
              maxItems: 15,
              items: { type: 'string', minLength: 1, maxLength: 200 }
            },
            hourly_rate_paise: { type: 'integer', minimum: 5000, maximum: 500000 },
            hours: { type: 'integer', minimum: 1, maximum: 12 },
            lat: { type: 'number', minimum: -90, maximum: 90 },
            lng: { type: 'number', minimum: -180, maximum: 180 },
            radius_m: { type: 'integer', minimum: 50, maximum: 2000 },
            address_text: { type: 'string', maxLength: 250 },
            start_at: { type: 'string', format: 'date-time' }
          }
        }
      }
    },
    async (req, reply) => {
      const userId = req.user.sub;
      const body = req.body;
      const startDate = new Date(body.start_at);
      if (Number.isNaN(startDate.getTime())) {
        return reply.code(400).send({ error: 'INVALID_START_AT', message: 'Invalid start_at timestamp' });
      }

      const outcome = await withTransaction(pool, async (client) => {
        const userRes = await client.query<{
          status: string;
          age_verified_at: Date | null;
          is_future: boolean;
        }>(
          `SELECT status, age_verified_at, ($2::timestamptz > now()) AS is_future
             FROM users
            WHERE id = $1`,
          [userId, startDate.toISOString()]
        );

        if (userRes.rowCount === 0) {
          return { ok: false as const, status: 404, error: 'USER_NOT_FOUND', message: 'User not found' };
        }
        const u = userRes.rows[0];
        if (u.status !== 'active') {
          return { ok: false as const, status: 403, error: 'ACCOUNT_DISABLED', message: 'Account is not active' };
        }
        if (!u.age_verified_at) {
          return {
            ok: false as const,
            status: 403,
            error: 'VERIFICATION_REQUIRED',
            message: 'Complete 18+ verification before posting a job'
          };
        }
        if (!u.is_future) {
          return {
            ok: false as const,
            status: 400,
            error: 'START_AT_IN_PAST',
            message: 'Job start_at must be in the future'
          };
        }

        const cleanChecklist = (body.checklist ?? []).map((item) => item.trim()).filter(Boolean);
        const inserted = await client.query<{
          id: string;
          status: string;
          hourly_rate_paise: string;
          hours: number;
          start_at: Date;
          created_at: Date;
        }>(
          `INSERT INTO jobs (
             poster_id, title, description, checklist,
             hourly_rate_paise, hours, lat, lng, radius_m, address_text, start_at
           )
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11::timestamptz)
           RETURNING id, status, hourly_rate_paise, hours, start_at, created_at`,
          [
            userId,
            body.title.trim(),
            body.description.trim(),
            JSON.stringify(cleanChecklist),
            body.hourly_rate_paise,
            body.hours,
            body.lat ?? 0,
            body.lng ?? 0,
            body.radius_m ?? 100,
            (body.address_text ?? '').trim(),
            startDate.toISOString()
          ]
        );

        const job = inserted.rows[0];
        await client.query(
          `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
           VALUES ($1, 'job', $2, NULL, $3::jsonb)`,
          [
            userId,
            job.id,
            JSON.stringify({
              event: 'job_created',
              status: job.status,
              total_paise: Number(job.hourly_rate_paise) * job.hours
            })
          ]
        );

        return { ok: true as const, job, cleanChecklist };
      });

      if (!outcome.ok) {
        return reply.code(outcome.status).send({ error: outcome.error, message: outcome.message });
      }

      const totalPaise = Number(outcome.job.hourly_rate_paise) * outcome.job.hours;
      return reply.code(201).send({
        id: outcome.job.id,
        poster_id: userId,
        title: body.title.trim(),
        description: body.description.trim(),
        checklist: outcome.cleanChecklist,
        hourly_rate_paise: Number(outcome.job.hourly_rate_paise),
        hours: outcome.job.hours,
        total_paise: totalPaise,
        lat: body.lat ?? 0,
        lng: body.lng ?? 0,
        radius_m: body.radius_m ?? 100,
        address_text: (body.address_text ?? '').trim(),
        start_at: outcome.job.start_at.toISOString(),
        status: outcome.job.status,
        created_at: outcome.job.created_at.toISOString()
      });
    }
  );

  // POST /v1/jobs/:id/fund (debits poster wallet, credits escrow:<job_id>, transitions DRAFT -> OPEN)
  app.post<{ Params: { id: string } }>(
    '/jobs/:id/fund',
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

      const userId = req.user.sub;
      const jobId = req.params.id;

      return runIdempotentTransaction(
        pool,
        reply,
        {
          key: idemKey,
          userId,
          endpoint: `POST /v1/jobs/${jobId}/fund`,
          requestBody: { job_id: jobId }
        },
        async (client) => {
          const jobRes = await client.query<{
            id: string;
            poster_id: string;
            status: string;
            hourly_rate_paise: string;
            hours: number;
            is_future: boolean;
          }>(
            `SELECT id, poster_id, status, hourly_rate_paise, hours, (start_at > now()) AS is_future
               FROM jobs
              WHERE id = $1
                FOR UPDATE`,
            [jobId]
          );

          if (jobRes.rowCount === 0) {
            return { statusCode: 404, body: { error: 'JOB_NOT_FOUND', message: 'Job not found' } };
          }

          const job = jobRes.rows[0];
          if (job.poster_id !== userId) {
            return { statusCode: 403, body: { error: 'FORBIDDEN', message: 'Only the poster can fund this job' } };
          }
          if (job.status !== 'DRAFT') {
            return {
              statusCode: 409,
              body: { error: 'INVALID_JOB_STATUS', message: `Job cannot be funded from status ${job.status}` }
            };
          }
          if (!job.is_future) {
            return {
              statusCode: 400,
              body: { error: 'START_AT_IN_PAST', message: 'Cannot fund a job whose start_at has passed' }
            };
          }

          const totalPaise = Number(job.hourly_rate_paise) * job.hours;

          const walletRes = await client.query<{ balance_paise: string }>(
            `SELECT balance_paise FROM wallets WHERE user_id = $1 FOR UPDATE`,
            [userId]
          );
          const currentBalance = Number(walletRes.rows[0].balance_paise);
          if (currentBalance < totalPaise) {
            return {
              statusCode: 400,
              body: {
                error: 'INSUFFICIENT_FUNDS',
                message: `Need ${totalPaise} paise in wallet, available ${currentBalance} paise`
              }
            };
          }

          const txnId = crypto.randomUUID();
          await client.query(
            `INSERT INTO ledger_entries (txn_id, account, amount_paise, reason, job_id)
             VALUES
               ($1, $2, $3, 'fund_job_escrow', $4),
               ($1, $5, $6, 'fund_job_escrow', $4)`,
            [
              txnId,
              `wallet:${userId}`,
              -totalPaise,
              job.id,
              `escrow:${job.id}`,
              totalPaise
            ]
          );

          await client.query(
            `UPDATE jobs
                SET status = 'OPEN',
                    version = version + 1,
                    updated_at = now()
              WHERE id = $1`,
            [job.id]
          );

          const updatedWallet = await client.query<{ balance_paise: string }>(
            `SELECT balance_paise FROM wallets WHERE user_id = $1`,
            [userId]
          );
          const remainingBalance = Number(updatedWallet.rows[0].balance_paise);

          await client.query(
            `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
             VALUES ($1, 'job', $2, $3::jsonb, $4::jsonb)`,
            [
              userId,
              job.id,
              JSON.stringify({ status: 'DRAFT' }),
              JSON.stringify({
                status: 'OPEN',
                txn_id: txnId,
                escrow_held_paise: totalPaise
              })
            ]
          );

          return {
            statusCode: 200,
            body: {
              job_id: job.id,
              status: 'OPEN',
              txn_id: txnId,
              escrow_held_paise: totalPaise,
              wallet_balance_paise: remainingBalance
            }
          };
        }
      );
    }
  );

  // GET /v1/jobs (browse OPEN jobs with optional Haversine distance filter)
  app.get<{
    Querystring: { lat?: number; lng?: number; radius_km?: number };
  }>(
    '/jobs',
    {
      preHandler: [authenticate],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            lat: { type: 'number', minimum: -90, maximum: 90 },
            lng: { type: 'number', minimum: -180, maximum: 180 },
            radius_km: { type: 'number', minimum: 0.1, maximum: 100 }
          }
        }
      }
    },
    async (req, reply) => {
      const { lat, lng, radius_km = 10 } = req.query;
      const hasGeo = typeof lat === 'number' && typeof lng === 'number';

      if (hasGeo) {
        const res = await pool.query<{
          id: string;
          poster_id: string;
          poster_name: string | null;
          poster_trust_level: number;
          poster_responsiveness: number;
          title: string;
          description: string;
          checklist: string[];
          hourly_rate_paise: string;
          hours: number;
          lat: number;
          lng: number;
          radius_m: number;
          address_text: string;
          start_at: Date;
          status: string;
          distance_m: number;
        }>(
          `SELECT * FROM (
             SELECT j.id, j.poster_id, u.verified_name AS poster_name,
                    u.trust_level AS poster_trust_level,
                    u.responsiveness_score AS poster_responsiveness,
                    j.title, j.description, j.checklist,
                    j.hourly_rate_paise, j.hours, j.lat, j.lng, j.radius_m,
                    j.address_text, j.start_at, j.status,
                    ROUND(
                      6371000 * 2 * ASIN(SQRT(
                        POWER(SIN(RADIANS(j.lat - $1) / 2), 2) +
                        COS(RADIANS($1)) * COS(RADIANS(j.lat)) *
                        POWER(SIN(RADIANS(j.lng - $2) / 2), 2)
                      ))
                    )::integer AS distance_m
               FROM jobs j
               JOIN users u ON u.id = j.poster_id
              WHERE j.status = 'OPEN'
                AND j.is_hidden = false
                AND j.start_at > now()
           ) sub
           WHERE sub.distance_m <= ($3 * 1000)
           ORDER BY sub.distance_m ASC, sub.start_at ASC
           LIMIT 50`,
          [lat, lng, radius_km]
        );

        return reply.code(200).send({
          jobs: res.rows.map((r) => ({
            id: r.id,
            poster_id: r.poster_id,
            poster_name: r.poster_name,
            poster_trust_level: r.poster_trust_level,
            poster_responsiveness_score: r.poster_responsiveness,
            title: r.title,
            description: r.description,
            checklist: r.checklist,
            hourly_rate_paise: Number(r.hourly_rate_paise),
            hours: r.hours,
            total_paise: Number(r.hourly_rate_paise) * r.hours,
            lat: r.lat,
            lng: r.lng,
            radius_m: r.radius_m,
            address_text: r.address_text,
            start_at: r.start_at.toISOString(),
            status: r.status,
            distance_m: r.distance_m
          }))
        });
      }

      const res = await pool.query<{
        id: string;
        poster_id: string;
        poster_name: string | null;
        poster_trust_level: number;
        poster_responsiveness: number;
        title: string;
        description: string;
        checklist: string[];
        hourly_rate_paise: string;
        hours: number;
        lat: number;
        lng: number;
        radius_m: number;
        address_text: string;
        start_at: Date;
        status: string;
      }>(
        `SELECT j.id, j.poster_id, u.verified_name AS poster_name,
                u.trust_level AS poster_trust_level,
                u.responsiveness_score AS poster_responsiveness,
                j.title, j.description, j.checklist,
                j.hourly_rate_paise, j.hours, j.lat, j.lng, j.radius_m,
                j.address_text, j.start_at, j.status
           FROM jobs j
           JOIN users u ON u.id = j.poster_id
          WHERE j.status = 'OPEN'
            AND j.is_hidden = false
            AND j.start_at > now()
          ORDER BY j.start_at ASC
          LIMIT 50`
      );

      return reply.code(200).send({
        jobs: res.rows.map((r) => ({
          id: r.id,
          poster_id: r.poster_id,
          poster_name: r.poster_name,
          poster_trust_level: r.poster_trust_level,
          poster_responsiveness_score: r.poster_responsiveness,
          title: r.title,
          description: r.description,
          checklist: r.checklist,
          hourly_rate_paise: Number(r.hourly_rate_paise),
          hours: r.hours,
          total_paise: Number(r.hourly_rate_paise) * r.hours,
          lat: r.lat,
          lng: r.lng,
          radius_m: r.radius_m,
          address_text: r.address_text,
          start_at: r.start_at.toISOString(),
          status: r.status,
          distance_m: null
        }))
      });
    }
  );

  // GET /v1/my/jobs (jobs posted by user + jobs applied to by user)
  app.get('/my/jobs', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = req.user.sub;

    const [postedRes, appliedRes] = await Promise.all([
      pool.query<{
        id: string;
        title: string;
        hourly_rate_paise: string;
        hours: number;
        address_text: string;
        start_at: Date;
        status: string;
        pending_count: string;
      }>(
        `SELECT j.id, j.title, j.hourly_rate_paise, j.hours, j.address_text,
                j.start_at, j.status,
                COUNT(a.id) FILTER (WHERE a.status = 'pending') AS pending_count
           FROM jobs j
           LEFT JOIN applications a ON a.job_id = j.id
          WHERE j.poster_id = $1 AND j.is_hidden = false
          GROUP BY j.id
          ORDER BY j.created_at DESC`,
        [userId]
      ),
      pool.query<{
        application_id: string;
        application_status: string;
        respond_by: Date;
        job_id: string;
        title: string;
        hourly_rate_paise: string;
        hours: number;
        address_text: string;
        start_at: Date;
        job_status: string;
      }>(
        `SELECT a.id AS application_id, a.status AS application_status, a.respond_by,
                j.id AS job_id, j.title, j.hourly_rate_paise, j.hours,
                j.address_text, j.start_at, j.status AS job_status
           FROM applications a
           JOIN jobs j ON j.id = a.job_id
          WHERE a.worker_id = $1
          ORDER BY a.applied_at DESC`,
        [userId]
      )
    ]);

    return reply.code(200).send({
      posted: postedRes.rows.map((r) => ({
        id: r.id,
        title: r.title,
        hourly_rate_paise: Number(r.hourly_rate_paise),
        hours: r.hours,
        total_paise: Number(r.hourly_rate_paise) * r.hours,
        address_text: r.address_text,
        start_at: r.start_at.toISOString(),
        status: r.status,
        pending_applications: Number(r.pending_count)
      })),
      applied: appliedRes.rows.map((r) => ({
        application_id: r.application_id,
        application_status: r.application_status,
        respond_by: r.respond_by.toISOString(),
        job_id: r.job_id,
        title: r.title,
        hourly_rate_paise: Number(r.hourly_rate_paise),
        hours: r.hours,
        total_paise: Number(r.hourly_rate_paise) * r.hours,
        address_text: r.address_text,
        start_at: r.start_at.toISOString(),
        job_status: r.job_status
      }))
    });
  });

  // GET /v1/jobs/:id
  app.get<{ Params: { id: string } }>(
    '/jobs/:id',
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
      const userId = req.user.sub;
      const jobId = req.params.id;

      const jobRes = await pool.query<{
        id: string;
        poster_id: string;
        poster_name: string | null;
        poster_trust_level: number;
        poster_responsiveness: number;
        title: string;
        description: string;
        checklist: string[];
        hourly_rate_paise: string;
        hours: number;
        lat: number;
        lng: number;
        radius_m: number;
        address_text: string;
        start_at: Date;
        status: string;
        escrow_held_paise: string;
      }>(
        `SELECT j.id, j.poster_id, u.verified_name AS poster_name,
                u.trust_level AS poster_trust_level,
                u.responsiveness_score AS poster_responsiveness,
                j.title, j.description, j.checklist,
                j.hourly_rate_paise, j.hours, j.lat, j.lng, j.radius_m,
                j.address_text, j.start_at, j.status,
                COALESCE((
                  SELECT SUM(amount_paise)
                    FROM ledger_entries
                   WHERE account = 'escrow:' || j.id::text
                ), 0)::bigint AS escrow_held_paise
           FROM jobs j
           JOIN users u ON u.id = j.poster_id
          WHERE j.id = $1`,
        [jobId]
      );

      if (jobRes.rowCount === 0) {
        return reply.code(404).send({ error: 'JOB_NOT_FOUND', message: 'Job not found' });
      }

      const job = jobRes.rows[0];
      const isPoster = job.poster_id === userId;

      let applications: Array<Record<string, unknown>> = [];
      let myApplication: Record<string, unknown> | null = null;

      if (isPoster) {
        const appsRes = await pool.query<{
          id: string;
          worker_id: string;
          worker_name: string | null;
          worker_trust_level: number;
          worker_responsiveness: number;
          status: string;
          applied_at: Date;
          respond_by: Date;
        }>(
          `SELECT a.id, a.worker_id, u.verified_name AS worker_name,
                  u.trust_level AS worker_trust_level,
                  u.responsiveness_score AS worker_responsiveness,
                  a.status, a.applied_at, a.respond_by
             FROM applications a
             JOIN users u ON u.id = a.worker_id
            WHERE a.job_id = $1
            ORDER BY a.applied_at ASC`,
          [jobId]
        );
        applications = appsRes.rows.map((a) => ({
          id: a.id,
          worker_id: a.worker_id,
          worker_name: a.worker_name,
          worker_trust_level: a.worker_trust_level,
          worker_responsiveness_score: a.worker_responsiveness,
          status: a.status,
          applied_at: a.applied_at.toISOString(),
          respond_by: a.respond_by.toISOString()
        }));
      } else {
        const mineRes = await pool.query<{
          id: string;
          status: string;
          applied_at: Date;
          respond_by: Date;
        }>(
          `SELECT id, status, applied_at, respond_by
             FROM applications
            WHERE job_id = $1 AND worker_id = $2`,
          [jobId, userId]
        );
        if (mineRes.rowCount && mineRes.rows[0]) {
          const m = mineRes.rows[0];
          myApplication = {
            id: m.id,
            status: m.status,
            applied_at: m.applied_at.toISOString(),
            respond_by: m.respond_by.toISOString()
          };
        }
      }

      const shiftRes = await pool.query<{
        worker_id: string;
        checked_in_at: Date | null;
        checkin_distance_m: number | null;
        completed_checklist: string[];
        checked_out_at: Date | null;
        actual_minutes: number | null;
        payable_minutes: number | null;
        gross_earned_paise: string | null;
        worker_payout_paise: string | null;
        platform_fee_paise: string | null;
        poster_refund_paise: string | null;
        approved_at: Date | null;
      }>(
        `SELECT worker_id, checked_in_at, checkin_distance_m, completed_checklist,
                checked_out_at, actual_minutes, payable_minutes,
                gross_earned_paise, worker_payout_paise, platform_fee_paise,
                poster_refund_paise, approved_at
           FROM job_shifts
          WHERE job_id = $1`,
        [jobId]
      );
      const sr = shiftRes.rows[0];
      const shift = sr
        ? {
            worker_id: sr.worker_id,
            checked_in_at: sr.checked_in_at ? sr.checked_in_at.toISOString() : null,
            checkin_distance_m: sr.checkin_distance_m,
            completed_checklist: sr.completed_checklist ?? [],
            checked_out_at: sr.checked_out_at ? sr.checked_out_at.toISOString() : null,
            actual_minutes: sr.actual_minutes,
            payable_minutes: sr.payable_minutes,
            gross_earned_paise: sr.gross_earned_paise !== null ? Number(sr.gross_earned_paise) : null,
            worker_payout_paise: sr.worker_payout_paise !== null ? Number(sr.worker_payout_paise) : null,
            platform_fee_paise: sr.platform_fee_paise !== null ? Number(sr.platform_fee_paise) : null,
            poster_refund_paise: sr.poster_refund_paise !== null ? Number(sr.poster_refund_paise) : null,
            approved_at: sr.approved_at ? sr.approved_at.toISOString() : null
          }
        : null;

      const myRatingRes = await pool.query<{ id: string; comment: string | null; created_at: Date }>(
        `SELECT id, comment, created_at FROM ratings WHERE job_id = $1 AND rater_id = $2`,
        [jobId, userId]
      );
      const myRating = myRatingRes.rows[0]
        ? {
            id: myRatingRes.rows[0].id,
            comment: myRatingRes.rows[0].comment ?? "",
            created_at: myRatingRes.rows[0].created_at.toISOString()
          }
        : null;

      const disputeRes = await pool.query<{
        raised_by: string;
        reason: string;
        evidence_note: string;
        status: string;
        resolution_note: string | null;
        worker_payout_paise: string | null;
        platform_fee_paise: string | null;
        poster_refund_paise: string | null;
        resolved_at: Date | null;
        created_at: Date;
      }>(
        `SELECT raised_by, reason, evidence_note, status, resolution_note,
                worker_payout_paise, platform_fee_paise, poster_refund_paise,
                resolved_at, created_at
           FROM job_disputes
          WHERE job_id = $1`,
        [jobId]
      );
      const dr = disputeRes.rows[0];
      const dispute = dr
        ? {
            raised_by: dr.raised_by,
            reason: dr.reason,
            evidence_note: dr.evidence_note,
            status: dr.status,
            resolution_note: dr.resolution_note,
            worker_payout_paise: dr.worker_payout_paise !== null ? Number(dr.worker_payout_paise) : null,
            platform_fee_paise: dr.platform_fee_paise !== null ? Number(dr.platform_fee_paise) : null,
            poster_refund_paise: dr.poster_refund_paise !== null ? Number(dr.poster_refund_paise) : null,
            resolved_at: dr.resolved_at ? dr.resolved_at.toISOString() : null,
            created_at: dr.created_at.toISOString()
          }
        : null;

      return reply.code(200).send({
        id: job.id,
        poster_id: job.poster_id,
        poster_name: job.poster_name,
        poster_trust_level: job.poster_trust_level,
        poster_responsiveness_score: job.poster_responsiveness,
        title: job.title,
        description: job.description,
        checklist: job.checklist,
        hourly_rate_paise: Number(job.hourly_rate_paise),
        hours: job.hours,
        total_paise: Number(job.hourly_rate_paise) * job.hours,
        escrow_held_paise: Number(job.escrow_held_paise),
        lat: job.lat,
        lng: job.lng,
        radius_m: job.radius_m,
        address_text: job.address_text,
        start_at: job.start_at.toISOString(),
        status: job.status,
        is_poster: isPoster,
        applications,
        my_application: myApplication,
        shift,
        my_rating: myRating,
        dispute
      });
    }
  );

  // POST /v1/jobs/:id/apply
  app.post<{ Params: { id: string } }>(
    '/jobs/:id/apply',
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

      try {
        const outcome = await withTransaction(pool, async (client) => {
          const workerRes = await client.query<{
            status: string;
            age_verified_at: Date | null;
          }>(
            `SELECT status, age_verified_at FROM users WHERE id = $1`,
            [workerId]
          );
          if (workerRes.rowCount === 0) {
            return { ok: false as const, status: 404, error: 'USER_NOT_FOUND', message: 'User not found' };
          }
          if (workerRes.rows[0].status !== 'active') {
            return { ok: false as const, status: 403, error: 'ACCOUNT_DISABLED', message: 'Account is not active' };
          }
          if (!workerRes.rows[0].age_verified_at) {
            return {
              ok: false as const,
              status: 403,
              error: 'VERIFICATION_REQUIRED',
              message: 'Complete 18+ verification before applying to jobs'
            };
          }

          const jobRes = await client.query<{
            id: string;
            poster_id: string;
            status: string;
            is_future: boolean;
          }>(
            `SELECT id, poster_id, status, (start_at > now()) AS is_future
               FROM jobs
              WHERE id = $1
                FOR SHARE`,
            [jobId]
          );

          if (jobRes.rowCount === 0) {
            return { ok: false as const, status: 404, error: 'JOB_NOT_FOUND', message: 'Job not found' };
          }
          const job = jobRes.rows[0];
          if (job.poster_id === workerId) {
            return { ok: false as const, status: 400, error: 'CANNOT_APPLY_OWN_JOB', message: 'Cannot apply to your own job' };
          }
          if (job.status !== 'OPEN') {
            return { ok: false as const, status: 409, error: 'JOB_NOT_OPEN', message: `Job is ${job.status}` };
          }
          if (!job.is_future) {
            return { ok: false as const, status: 400, error: 'JOB_ALREADY_STARTED', message: 'Job start time has passed' };
          }

          const inserted = await client.query<{
            id: string;
            status: string;
            applied_at: Date;
            respond_by: Date;
          }>(
            `INSERT INTO applications (job_id, worker_id, respond_by)
             VALUES (
               $1,
               $2,
               LEAST(now() + INTERVAL '2 hours', (SELECT start_at FROM jobs WHERE id = $1))
             )
             RETURNING id, status, applied_at, respond_by`,
            [jobId, workerId]
          );

          const appRow = inserted.rows[0];

          await client.query(
            `INSERT INTO notifications (user_id, type, payload)
             VALUES ($1, 'new_application', $2::jsonb)`,
            [job.poster_id, JSON.stringify({ job_id: jobId, application_id: appRow.id, worker_id: workerId })]
          );

          await client.query(
            `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
             VALUES ($1, 'application', $2, NULL, $3::jsonb)`,
            [workerId, appRow.id, JSON.stringify({ event: 'applied', job_id: jobId, status: appRow.status })]
          );

          return { ok: true as const, appRow };
        });

        if (!outcome.ok) {
          return reply.code(outcome.status).send({ error: outcome.error, message: outcome.message });
        }

        return reply.code(201).send({
          id: outcome.appRow.id,
          job_id: jobId,
          worker_id: workerId,
          status: outcome.appRow.status,
          applied_at: outcome.appRow.applied_at.toISOString(),
          respond_by: outcome.appRow.respond_by.toISOString()
        });
      } catch (err) {
        const pgErr = err as { code?: string };
        if (pgErr?.code === '23505') {
          return reply.code(409).send({
            error: 'ALREADY_APPLIED',
            message: 'You have already applied for this job'
          });
        }
        throw err;
      }
    }
  );

  // POST /v1/jobs/:id/applications/:appId/accept (OPEN -> FILLED, rejects other pending applicants)
  app.post<{ Params: { id: string; appId: string } }>(
    '/jobs/:id/applications/:appId/accept',
    {
      preHandler: [authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id', 'appId'],
          properties: {
            id: { type: 'string', pattern: UUID_PATTERN },
            appId: { type: 'string', pattern: UUID_PATTERN }
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

      const posterId = req.user.sub;
      const { id: jobId, appId } = req.params;

      return runIdempotentTransaction(
        pool,
        reply,
        {
          key: idemKey,
          userId: posterId,
          endpoint: `POST /v1/jobs/${jobId}/applications/${appId}/accept`,
          requestBody: { job_id: jobId, application_id: appId }
        },
        async (client) => {
          const jobRes = await client.query<{
            id: string;
            poster_id: string;
            status: string;
          }>(
            `SELECT id, poster_id, status
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
            return { statusCode: 403, body: { error: 'FORBIDDEN', message: 'Only the poster can accept applicants' } };
          }
          if (job.status !== 'OPEN') {
            return {
              statusCode: 409,
              body: { error: 'JOB_NOT_OPEN', message: `Cannot accept applicant when job is ${job.status}` }
            };
          }

          const appRes = await client.query<{
            id: string;
            worker_id: string;
            status: string;
            is_expired: boolean;
          }>(
            `SELECT id, worker_id, status, (respond_by <= now()) AS is_expired
               FROM applications
              WHERE id = $1 AND job_id = $2
                FOR UPDATE`,
            [appId, jobId]
          );

          if (appRes.rowCount === 0) {
            return { statusCode: 404, body: { error: 'APPLICATION_NOT_FOUND', message: 'Application not found' } };
          }
          const application = appRes.rows[0];
          if (application.status !== 'pending') {
            return {
              statusCode: 409,
              body: { error: 'APPLICATION_NOT_PENDING', message: `Application is already ${application.status}` }
            };
          }
          if (application.is_expired) {
            return {
              statusCode: 409,
              body: { error: 'APPLICATION_EXPIRED', message: 'Application deadline has passed' }
            };
          }

          await client.query(
            `UPDATE applications
                SET status = 'accepted',
                    responded_at = now()
              WHERE id = $1`,
            [appId]
          );

          const rejectedOthers = await client.query<{ id: string; worker_id: string }>(
            `UPDATE applications
                SET status = 'rejected',
                    responded_at = now()
              WHERE job_id = $1
                AND id <> $2
                AND status = 'pending'
             RETURNING id, worker_id`,
            [jobId, appId]
          );

          await client.query(
            `UPDATE jobs
                SET status = 'FILLED',
                    version = version + 1,
                    updated_at = now()
              WHERE id = $1`,
            [jobId]
          );

          await client.query(
            `INSERT INTO notifications (user_id, type, payload)
             VALUES ($1, 'application_accepted', $2::jsonb)`,
            [application.worker_id, JSON.stringify({ job_id: jobId, application_id: appId })]
          );

          for (const other of rejectedOthers.rows) {
            await client.query(
              `INSERT INTO notifications (user_id, type, payload)
               VALUES ($1, 'application_rejected', $2::jsonb)`,
              [other.worker_id, JSON.stringify({ job_id: jobId, application_id: other.id })]
            );
          }

          await client.query(
            `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
             VALUES ($1, 'job', $2, $3::jsonb, $4::jsonb)`,
            [
              posterId,
              jobId,
              JSON.stringify({ status: 'OPEN' }),
              JSON.stringify({
                status: 'FILLED',
                accepted_application_id: appId,
                worker_id: application.worker_id
              })
            ]
          );

          return {
            statusCode: 200,
            body: {
              job_id: jobId,
              job_status: 'FILLED',
              accepted_application_id: appId,
              worker_id: application.worker_id
            }
          };
        }
      );
    }
  );

  // POST /v1/jobs/:id/applications/:appId/reject
  app.post<{ Params: { id: string; appId: string } }>(
    '/jobs/:id/applications/:appId/reject',
    {
      preHandler: [authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id', 'appId'],
          properties: {
            id: { type: 'string', pattern: UUID_PATTERN },
            appId: { type: 'string', pattern: UUID_PATTERN }
          }
        }
      }
    },
    async (req, reply) => {
      const posterId = req.user.sub;
      const { id: jobId, appId } = req.params;

      const outcome = await withTransaction(pool, async (client) => {
        const jobRes = await client.query<{ poster_id: string }>(
          `SELECT poster_id FROM jobs WHERE id = $1`,
          [jobId]
        );
        if (jobRes.rowCount === 0) {
          return { ok: false as const, status: 404, error: 'JOB_NOT_FOUND', message: 'Job not found' };
        }
        if (jobRes.rows[0].poster_id !== posterId) {
          return { ok: false as const, status: 403, error: 'FORBIDDEN', message: 'Only the poster can reject applicants' };
        }

        const appRes = await client.query<{ id: string; worker_id: string; status: string }>(
          `SELECT id, worker_id, status
             FROM applications
            WHERE id = $1 AND job_id = $2
              FOR UPDATE`,
          [appId, jobId]
        );
        if (appRes.rowCount === 0) {
          return { ok: false as const, status: 404, error: 'APPLICATION_NOT_FOUND', message: 'Application not found' };
        }
        if (appRes.rows[0].status !== 'pending') {
          return {
            ok: false as const,
            status: 409,
            error: 'APPLICATION_NOT_PENDING',
            message: `Application is already ${appRes.rows[0].status}`
          };
        }

        await client.query(
          `UPDATE applications
              SET status = 'rejected',
                  responded_at = now()
            WHERE id = $1`,
          [appId]
        );

        await client.query(
          `INSERT INTO notifications (user_id, type, payload)
           VALUES ($1, 'application_rejected', $2::jsonb)`,
          [appRes.rows[0].worker_id, JSON.stringify({ job_id: jobId, application_id: appId })]
        );

        await client.query(
          `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
           VALUES ($1, 'application', $2, $3::jsonb, $4::jsonb)`,
          [
            posterId,
            appId,
            JSON.stringify({ status: 'pending' }),
            JSON.stringify({ status: 'rejected' })
          ]
        );

        return { ok: true as const };
      });

      if (!outcome.ok) {
        return reply.code(outcome.status).send({ error: outcome.error, message: outcome.message });
      }

      return reply.code(200).send({
        application_id: appId,
        status: 'rejected'
      });
    }
  );

  // DELETE /v1/jobs/:id (poster removes a non-active job)
  app.delete<{ Params: { id: string } }>(
    '/jobs/:id',
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
      const userId = req.user.sub;
      const jobId = req.params.id;
      const jobRes = await pool.query<{ id: string; poster_id: string; status: string }>(
        'SELECT id, poster_id, status FROM jobs WHERE id = $1',
        [jobId]
      );
      if (jobRes.rowCount === 0) {
        return reply.code(404).send({ error: 'JOB_NOT_FOUND', message: 'Job not found' });
      }
      const job = jobRes.rows[0];
      if (job.poster_id !== userId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Only the job poster can remove this job' });
      }
      if (job.status === 'IN_PROGRESS') {
        return reply.code(409).send({ error: 'INVALID_JOB_STATUS', message: 'Cannot remove a job that is currently in progress' });
      }
      await pool.query('DELETE FROM applications WHERE job_id = $1', [jobId]).catch(() => {});
      await pool.query('DELETE FROM job_shifts WHERE job_id = $1', [jobId]).catch(() => {});
      try {
        await pool.query('DELETE FROM jobs WHERE id = $1 AND poster_id = $2', [jobId, userId]);
      } catch {
        await pool.query('UPDATE jobs SET is_hidden = true WHERE id = $1', [jobId]);
      }
      return reply.code(200).send({ deleted: true, id: jobId });
    }
  );
}
