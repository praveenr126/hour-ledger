import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { withTransaction } from '../../db.js';
import {
  extractIdempotencyKey,
  runIdempotentTransaction
} from '../../shared/idempotency.js';
import { deriveTrustLevel, notifyUser } from '../../shared/notifications.js';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

interface CreateJobBody {
  title: string;
  description?: string;
  checklist?: string[];
  pay_type?: 'HOURLY' | 'DAILY' | 'WEEKLY';
  rate_paise?: number;
  hourly_rate_paise?: number;
  duration?: number;
  hours?: number;
  headcount_needed?: number;
  is_urgent?: boolean;
  scheduled_at?: string;
  start_at?: string;
  locality?: string;
  lat?: number;
  lng?: number;
  radius_m?: number;
  address_text?: string;
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
          required: ['title'],
          additionalProperties: false,
          properties: {
            title: { type: 'string', minLength: 3, maxLength: 120 },
            description: { type: 'string', minLength: 1, maxLength: 2000 },
            checklist: {
              type: 'array',
              maxItems: 15,
              items: { type: 'string', minLength: 1, maxLength: 200 }
            },
            pay_type: { type: 'string', enum: ['HOURLY', 'DAILY', 'WEEKLY'] },
            rate_paise: { type: 'integer', minimum: 5000, maximum: 5000000 },
            hourly_rate_paise: { type: 'integer', minimum: 5000, maximum: 5000000 },
            duration: { type: 'integer', minimum: 1, maximum: 365 },
            hours: { type: 'integer', minimum: 1, maximum: 365 },
            headcount_needed: { type: 'integer', minimum: 1, maximum: 50 },
            is_urgent: { type: 'boolean' },
            scheduled_at: { type: 'string', format: 'date-time' },
            start_at: { type: 'string', format: 'date-time' },
            locality: { type: 'string', maxLength: 250 },
            lat: { type: 'number', minimum: -90, maximum: 90 },
            lng: { type: 'number', minimum: -180, maximum: 180 },
            radius_m: { type: 'integer', minimum: 50, maximum: 50000 },
            address_text: { type: 'string', maxLength: 250 }
          }
        }
      }
    },
    async (req, reply) => {
      const userId = req.user.sub;
      const body = req.body;
      const payType = body.pay_type ?? 'HOURLY';
      const ratePaise = body.rate_paise ?? body.hourly_rate_paise;
      const duration = body.duration ?? body.hours;
      const headcountNeeded = body.headcount_needed ?? 1;
      const isUrgent = body.is_urgent ?? false;
      const rawStart = body.scheduled_at ?? body.start_at;
      const locality = (body.locality ?? body.address_text ?? '').trim();
      const addressText = (body.address_text ?? body.locality ?? '').trim();
      const description = (body.description ?? body.title).trim();

      if (!ratePaise || !duration || !rawStart) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: 'rate_paise (or hourly_rate_paise), duration (or hours), and scheduled_at (or start_at) are required'
        });
      }

      const startDate = new Date(rawStart);
      if (Number.isNaN(startDate.getTime())) {
        return reply.code(400).send({ error: 'INVALID_START_AT', message: 'Invalid scheduled_at/start_at timestamp' });
      }

      const outcome = await withTransaction(pool, async (client) => {
        const userRes = await client.query<{
          status: string;
          age_verified_at: Date | null;
          is_18_verified: boolean;
          is_future: boolean;
        }>(
          `SELECT status, age_verified_at, is_18_verified, ($2::timestamptz > now()) AS is_future
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
        if (!u.is_18_verified && !u.age_verified_at) {
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
            message: 'Job start time must be in the future'
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
             hourly_rate_paise, hours, pay_type, rate_paise, duration,
             headcount_needed, hired_count, is_urgent, scheduled_at, locality,
             lat, lng, radius_m, address_text, start_at
           )
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, 0, $11, $12::timestamptz, $13, $14, $15, $16, $17, $12::timestamptz)
           RETURNING id, status, hourly_rate_paise, hours, start_at, created_at`,
          [
            userId,
            body.title.trim(),
            description,
            JSON.stringify(cleanChecklist),
            ratePaise,
            duration,
            payType,
            ratePaise,
            duration,
            headcountNeeded,
            isUrgent,
            startDate.toISOString(),
            locality,
            body.lat ?? 0,
            body.lng ?? 0,
            body.radius_m ?? 100,
            addressText
          ]
        );

        const job = inserted.rows[0];
        const totalPaise = ratePaise * duration * headcountNeeded;
        await client.query(
          `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
           VALUES ($1, 'job', $2, NULL, $3::jsonb)`,
          [
            userId,
            job.id,
            JSON.stringify({
              event: 'job_created',
              status: job.status,
              total_paise: totalPaise
            })
          ]
        );

        return { ok: true as const, job, cleanChecklist, totalPaise };
      });

      if (!outcome.ok) {
        return reply.code(outcome.status).send({ error: outcome.error, message: outcome.message });
      }

      return reply.code(201).send({
        id: outcome.job.id,
        poster_id: userId,
        title: body.title.trim(),
        description,
        checklist: outcome.cleanChecklist,
        pay_type: payType,
        rate_paise: ratePaise,
        hourly_rate_paise: ratePaise,
        duration,
        hours: duration,
        headcount_needed: headcountNeeded,
        hired_count: 0,
        is_urgent: isUrgent,
        total_paise: outcome.totalPaise,
        locality,
        lat: body.lat ?? 0,
        lng: body.lng ?? 0,
        radius_m: body.radius_m ?? 100,
        address_text: addressText,
        scheduled_at: outcome.job.start_at.toISOString(),
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
            title: string;
            locality: string;
            status: string;
            hourly_rate_paise: string;
            rate_paise: string | null;
            hours: number;
            duration: number;
            headcount_needed: number;
            is_future: boolean;
          }>(
            `SELECT id, poster_id, title, locality, status, hourly_rate_paise, rate_paise,
                    hours, duration, headcount_needed, (COALESCE(scheduled_at, start_at) > now()) AS is_future
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

          const unitRate = Number(job.rate_paise ?? job.hourly_rate_paise);
          const dur = job.duration || job.hours;
          const headcount = job.headcount_needed || 1;
          const totalPaise = unitRate * dur * headcount;

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

  // GET /v1/jobs (browse jobs with geo, pay_type, window, saved, status, mine filters)
  app.get<{
    Querystring: {
      lat?: number;
      lng?: number;
      radius_km?: number;
      pay_type?: string;
      window?: string;
      saved?: string;
      status?: string;
      mine?: string;
    };
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
            radius_km: { type: 'number', minimum: 0.1, maximum: 500 },
            pay_type: { type: 'string', enum: ['HOURLY', 'DAILY', 'WEEKLY'] },
            window: { type: 'string', enum: ['urgent', 'today', 'weekend', 'this_week', 'this_month'] },
            saved: { type: 'string', enum: ['true', 'false'] },
            status: { type: 'string' },
            mine: { type: 'string', enum: ['posted', 'applied'] }
          }
        }
      }
    },
    async (req, reply) => {
      const userId = req.user.sub;
      const { lat, lng, radius_km, pay_type, window: timeWindow, saved, status, mine } = req.query;
      const hasGeo = typeof lat === 'number' && typeof lng === 'number';
      const conditions: string[] = ['j.is_hidden = false'];
      const params: unknown[] = [userId];

      if (mine === 'posted') {
        conditions.push('j.poster_id = $1');
      } else if (mine === 'applied') {
        conditions.push(`EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id AND a.worker_id = $1)`);
      } else {
        conditions.push(`j.status = $${params.push(status || 'OPEN')}`);
        conditions.push('COALESCE(j.scheduled_at, j.start_at) > now()');
      }

      if (pay_type) {
        conditions.push(`j.pay_type = $${params.push(pay_type)}`);
      }
      if (saved === 'true') {
        conditions.push('sj.user_id IS NOT NULL');
      }
      if (timeWindow === 'urgent') {
        conditions.push('j.is_urgent = true');
      } else if (timeWindow === 'today') {
        conditions.push(`COALESCE(j.scheduled_at, j.start_at)::date = (now() AT TIME ZONE 'UTC')::date`);
      } else if (timeWindow === 'weekend') {
        conditions.push(`EXTRACT(DOW FROM COALESCE(j.scheduled_at, j.start_at)) IN (0, 6)`);
      } else if (timeWindow === 'this_week') {
        conditions.push(`COALESCE(j.scheduled_at, j.start_at) <= now() + INTERVAL '7 days'`);
      } else if (timeWindow === 'this_month') {
        conditions.push(`COALESCE(j.scheduled_at, j.start_at) <= now() + INTERVAL '30 days'`);
      }

      let distExpr = 'NULL::double precision AS distance_m';
      if (hasGeo) {
        const latIdx = params.push(lat);
        const lngIdx = params.push(lng);
        distExpr = `CASE WHEN j.lat = 0 AND j.lng = 0 THEN NULL ELSE (
          6371000 * 2 * ASIN(SQRT(
            POWER(SIN(RADIANS(j.lat - $${latIdx}) / 2), 2) +
            COS(RADIANS($${latIdx})) * COS(RADIANS(j.lat)) *
            POWER(SIN(RADIANS(j.lng - $${lngIdx}) / 2), 2)
          ))
        ) END AS distance_m`;
      }

      const outerWhere =
        hasGeo && typeof radius_km === 'number'
          ? `WHERE sub.distance_m IS NOT NULL AND sub.distance_m <= $${params.push(radius_km * 1000)}`
          : '';

      const orderClause = hasGeo
        ? 'ORDER BY sub.distance_m ASC NULLS LAST, sub.scheduled_at ASC'
        : 'ORDER BY sub.is_urgent DESC, sub.scheduled_at ASC';

      const sql = `
        SELECT * FROM (
          SELECT j.id, j.poster_id, u.verified_name AS poster_name,
                 u.trust_level AS poster_trust_level,
                 u.responsiveness_score AS poster_responsiveness,
                 j.title, j.description, j.checklist,
                 j.pay_type, COALESCE(j.rate_paise, j.hourly_rate_paise) AS rate_paise,
                 j.hourly_rate_paise, COALESCE(j.duration, j.hours) AS duration, j.hours,
                 j.headcount_needed, j.hired_count, j.is_urgent,
                 COALESCE(j.scheduled_at, j.start_at) AS scheduled_at,
                 COALESCE(NULLIF(j.locality, ''), j.address_text) AS locality,
                 j.lat, j.lng, j.radius_m, j.address_text, j.start_at, j.status,
                 (sj.user_id IS NOT NULL) AS is_saved,
                 ${distExpr}
            FROM jobs j
            JOIN users u ON u.id = j.poster_id
            LEFT JOIN saved_jobs sj ON sj.job_id = j.id AND sj.user_id = $1
           WHERE ${conditions.join(' AND ')}
        ) sub
        ${outerWhere}
        ${orderClause}
        LIMIT 50`;

      const res = await pool.query<{
        id: string;
        poster_id: string;
        poster_name: string | null;
        poster_trust_level: number;
        poster_responsiveness: number;
        title: string;
        description: string;
        checklist: string[];
        pay_type: string;
        rate_paise: string;
        hourly_rate_paise: string;
        duration: number;
        hours: number;
        headcount_needed: number;
        hired_count: number;
        is_urgent: boolean;
        scheduled_at: Date;
        locality: string;
        lat: number;
        lng: number;
        radius_m: number;
        address_text: string;
        start_at: Date;
        status: string;
        is_saved: boolean;
        distance_m: number | null;
      }>(sql, params);

      return reply.code(200).send({
        jobs: res.rows.map((r) => {
          const rate = Number(r.rate_paise);
          const dur = r.duration;
          const hc = r.headcount_needed || 1;
          const distM = r.distance_m !== null ? Math.round(r.distance_m) : null;
          const distKm = distM !== null ? Math.round((distM / 1000) * 10) / 10 : null;
          return {
            id: r.id,
            poster_id: r.poster_id,
            poster_name: r.poster_name,
            poster_trust_level: r.poster_trust_level,
            poster_responsiveness_score: r.poster_responsiveness,
            title: r.title,
            description: r.description,
            checklist: r.checklist,
            pay_type: r.pay_type,
            rate_paise: rate,
            hourly_rate_paise: Number(r.hourly_rate_paise),
            duration: dur,
            hours: r.hours,
            headcount_needed: hc,
            hired_count: r.hired_count,
            is_urgent: r.is_urgent,
            total_paise: rate * dur * hc,
            locality: r.locality,
            lat: r.lat,
            lng: r.lng,
            radius_m: r.radius_m,
            address_text: r.address_text,
            scheduled_at: r.scheduled_at.toISOString(),
            start_at: r.start_at.toISOString(),
            status: r.status,
            is_saved: r.is_saved,
            distance_m: distM,
            distance_km: distKm
          };
        })
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
        pay_type: string;
        rate_paise: string;
        hourly_rate_paise: string;
        duration: number;
        hours: number;
        headcount_needed: number;
        hired_count: number;
        is_urgent: boolean;
        locality: string;
        address_text: string;
        scheduled_at: Date;
        start_at: Date;
        status: string;
        pending_count: string;
      }>(
        `SELECT j.id, j.title, j.pay_type,
                COALESCE(j.rate_paise, j.hourly_rate_paise) AS rate_paise,
                j.hourly_rate_paise,
                COALESCE(j.duration, j.hours) AS duration,
                j.hours, j.headcount_needed, j.hired_count, j.is_urgent,
                COALESCE(NULLIF(j.locality, ''), j.address_text) AS locality,
                j.address_text,
                COALESCE(j.scheduled_at, j.start_at) AS scheduled_at,
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
        application_role: string;
        respond_by: Date;
        job_id: string;
        title: string;
        pay_type: string;
        rate_paise: string;
        hourly_rate_paise: string;
        duration: number;
        hours: number;
        headcount_needed: number;
        hired_count: number;
        is_urgent: boolean;
        locality: string;
        address_text: string;
        scheduled_at: Date;
        start_at: Date;
        job_status: string;
      }>(
        `SELECT a.id AS application_id, a.status AS application_status, a.role AS application_role,
                a.respond_by, j.id AS job_id, j.title, j.pay_type,
                COALESCE(j.rate_paise, j.hourly_rate_paise) AS rate_paise,
                j.hourly_rate_paise,
                COALESCE(j.duration, j.hours) AS duration,
                j.hours, j.headcount_needed, j.hired_count, j.is_urgent,
                COALESCE(NULLIF(j.locality, ''), j.address_text) AS locality,
                j.address_text,
                COALESCE(j.scheduled_at, j.start_at) AS scheduled_at,
                j.start_at, j.status AS job_status
           FROM applications a
           JOIN jobs j ON j.id = a.job_id
          WHERE a.worker_id = $1
          ORDER BY a.applied_at DESC`,
        [userId]
      )
    ]);

    return reply.code(200).send({
      posted: postedRes.rows.map((r) => {
        const rate = Number(r.rate_paise);
        const hc = r.headcount_needed || 1;
        return {
          id: r.id,
          title: r.title,
          pay_type: r.pay_type,
          rate_paise: rate,
          hourly_rate_paise: Number(r.hourly_rate_paise),
          duration: r.duration,
          hours: r.hours,
          headcount_needed: hc,
          hired_count: r.hired_count,
          is_urgent: r.is_urgent,
          total_paise: rate * r.duration * hc,
          locality: r.locality,
          address_text: r.address_text,
          scheduled_at: r.scheduled_at.toISOString(),
          start_at: r.start_at.toISOString(),
          status: r.status,
          pending_applications: Number(r.pending_count)
        };
      }),
      applied: appliedRes.rows.map((r) => {
        const rate = Number(r.rate_paise);
        const hc = r.headcount_needed || 1;
        return {
          application_id: r.application_id,
          application_status: r.application_status,
          application_role: r.application_role,
          respond_by: r.respond_by.toISOString(),
          job_id: r.job_id,
          title: r.title,
          pay_type: r.pay_type,
          rate_paise: rate,
          hourly_rate_paise: Number(r.hourly_rate_paise),
          duration: r.duration,
          hours: r.hours,
          headcount_needed: hc,
          hired_count: r.hired_count,
          is_urgent: r.is_urgent,
          total_paise: rate * r.duration * hc,
          locality: r.locality,
          address_text: r.address_text,
          scheduled_at: r.scheduled_at.toISOString(),
          start_at: r.start_at.toISOString(),
          job_status: r.job_status
        };
      })
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
          worker_trust_score: number;
          worker_cancellation_count: number;
          worker_avg_rating: string;
          worker_rating_count: number;
          worker_is_18_verified: boolean;
          worker_responsiveness: number;
          role: string;
          status: string;
          applied_at: Date;
          respond_by: Date;
        }>(
          `SELECT a.id, a.worker_id, u.verified_name AS worker_name,
                  u.trust_level AS worker_trust_level,
                  u.trust_score AS worker_trust_score,
                  u.cancellation_count AS worker_cancellation_count,
                  u.avg_rating::text AS worker_avg_rating,
                  u.rating_count AS worker_rating_count,
                  (u.is_18_verified OR u.age_verified_at IS NOT NULL) AS worker_is_18_verified,
                  u.responsiveness_score AS worker_responsiveness,
                  a.role, a.status, a.applied_at, a.respond_by
             FROM applications a
             JOIN users u ON u.id = a.worker_id
            WHERE a.job_id = $1
            ORDER BY (a.status = 'accepted') DESC, (a.status = 'backup') DESC, a.applied_at ASC`,
          [jobId]
        );
        applications = appsRes.rows.map((a) => ({
          id: a.id,
          worker_id: a.worker_id,
          worker_name: a.worker_name,
          worker_trust_level: a.worker_trust_level,
          trust_level: a.worker_trust_level,
          trust_score: a.worker_trust_score,
          cancellation_count: a.worker_cancellation_count,
          avg_rating: Number(a.worker_avg_rating ?? 0),
          rating_count: a.worker_rating_count,
          is_18_verified: a.worker_is_18_verified,
          worker_responsiveness_score: a.worker_responsiveness,
          role: a.role,
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
            title: string;
            status: string;
            headcount_needed: number;
            hired_count: number;
          }>(
            `SELECT id, poster_id, title, status, headcount_needed, hired_count
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
          if (application.status !== 'pending' && application.status !== 'backup') {
            return {
              statusCode: 409,
              body: { error: 'APPLICATION_NOT_PENDING', message: `Application is already ${application.status}` }
            };
          }
          if (application.is_expired && application.status === 'pending') {
            return {
              statusCode: 409,
              body: { error: 'APPLICATION_EXPIRED', message: 'Application deadline has passed' }
            };
          }

          await client.query(
            `UPDATE applications
                SET status = 'accepted',
                    role = 'PRIMARY',
                    responded_at = now()
              WHERE id = $1`,
            [appId]
          );

          const newHiredCount = (job.hired_count || 0) + 1;
          const headcountNeeded = job.headcount_needed || 1;
          const isNowFilled = newHiredCount >= headcountNeeded;
          const nextJobStatus = isNowFilled ? 'FILLED' : 'OPEN';

          let rejectedOthers: Array<{ id: string; worker_id: string }> = [];
          if (isNowFilled) {
            const rejRes = await client.query<{ id: string; worker_id: string }>(
              `UPDATE applications
                  SET status = 'rejected',
                      responded_at = now()
                WHERE job_id = $1
                  AND id <> $2
                  AND status = 'pending'
               RETURNING id, worker_id`,
              [jobId, appId]
            );
            rejectedOthers = rejRes.rows;
          }

          await client.query(
            `UPDATE jobs
                SET status = $2,
                    hired_count = $3,
                    version = version + 1,
                    updated_at = now()
              WHERE id = $1`,
            [jobId, nextJobStatus, newHiredCount]
          );

          void notifyUser(pool, {
            userId: application.worker_id,
            type: 'application_accepted',
            title: `Accepted: ${job.title}`,
            body: 'Your shift application was accepted as primary worker.',
            jobId
          });

          for (const other of rejectedOthers) {
            void notifyUser(pool, {
              userId: other.worker_id,
              type: 'application_rejected',
              title: `Shift filled: ${job.title}`,
              body: 'All spots for this shift have been filled.',
              jobId
            });
          }

          await client.query(
            `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
             VALUES ($1, 'job', $2, $3::jsonb, $4::jsonb)`,
            [
              posterId,
              jobId,
              JSON.stringify({ status: 'OPEN', hired_count: job.hired_count }),
              JSON.stringify({
                status: nextJobStatus,
                hired_count: newHiredCount,
                accepted_application_id: appId,
                worker_id: application.worker_id
              })
            ]
          );

          return {
            statusCode: 200,
            body: {
              job_id: jobId,
              job_status: nextJobStatus,
              hired_count: newHiredCount,
              headcount_needed: headcountNeeded,
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

  // POST /v1/jobs/:id/applications/:appId/backup (set standby backup without consuming hire slot)
  app.post<{ Params: { id: string; appId: string } }>(
    '/jobs/:id/applications/:appId/backup',
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
        const jobRes = await client.query<{ poster_id: string; title: string }>(
          `SELECT poster_id, title FROM jobs WHERE id = $1`,
          [jobId]
        );
        if (jobRes.rowCount === 0) {
          return { ok: false as const, status: 404, error: 'JOB_NOT_FOUND', message: 'Job not found' };
        }
        if (jobRes.rows[0].poster_id !== posterId) {
          return { ok: false as const, status: 403, error: 'FORBIDDEN', message: 'Only the poster can set backup applicants' };
        }

        const appRes = await client.query<{ id: string; worker_id: string; status: string }>(
          `SELECT id, worker_id, status FROM applications WHERE id = $1 AND job_id = $2 FOR UPDATE`,
          [appId, jobId]
        );
        if (appRes.rowCount === 0) {
          return { ok: false as const, status: 404, error: 'APPLICATION_NOT_FOUND', message: 'Application not found' };
        }
        if (appRes.rows[0].status !== 'pending') {
          return { ok: false as const, status: 409, error: 'INVALID_STATUS', message: `Application is ${appRes.rows[0].status}` };
        }

        await client.query(
          `UPDATE applications SET status = 'backup', role = 'BACKUP', responded_at = now() WHERE id = $1`,
          [appId]
        );

        return { ok: true as const, workerId: appRes.rows[0].worker_id, jobTitle: jobRes.rows[0].title };
      });

      if (!outcome.ok) {
        return reply.code(outcome.status).send({ error: outcome.error, message: outcome.message });
      }

      void notifyUser(pool, {
        userId: outcome.workerId,
        type: 'application_backup',
        title: `Standby Backup: ${outcome.jobTitle}`,
        body: 'You have been kept as a standby backup worker for this shift.',
        jobId
      });

      return reply.code(200).send({ application_id: appId, status: 'backup', role: 'BACKUP' });
    }
  );

  // POST /v1/jobs/:id/applications/:appId/promote-backup
  app.post<{ Params: { id: string; appId: string } }>(
    '/jobs/:id/applications/:appId/promote-backup',
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
        const jobRes = await client.query<{
          poster_id: string;
          title: string;
          status: string;
          headcount_needed: number;
          hired_count: number;
        }>(
          `SELECT poster_id, title, status, headcount_needed, hired_count
             FROM jobs WHERE id = $1 FOR UPDATE`,
          [jobId]
        );
        if (jobRes.rowCount === 0) {
          return { ok: false as const, status: 404, error: 'JOB_NOT_FOUND', message: 'Job not found' };
        }
        const job = jobRes.rows[0];
        if (job.poster_id !== posterId) {
          return { ok: false as const, status: 403, error: 'FORBIDDEN', message: 'Only the poster can promote backup workers' };
        }
        if ((job.hired_count || 0) >= (job.headcount_needed || 1)) {
          return { ok: false as const, status: 409, error: 'SLOTS_FULL', message: 'All primary spots are currently filled' };
        }

        const appRes = await client.query<{ id: string; worker_id: string; status: string }>(
          `SELECT id, worker_id, status FROM applications WHERE id = $1 AND job_id = $2 FOR UPDATE`,
          [appId, jobId]
        );
        if (appRes.rowCount === 0) {
          return { ok: false as const, status: 404, error: 'APPLICATION_NOT_FOUND', message: 'Application not found' };
        }
        if (appRes.rows[0].status !== 'backup') {
          return { ok: false as const, status: 409, error: 'NOT_BACKUP', message: 'Only backup applications can be promoted' };
        }

        const newHiredCount = (job.hired_count || 0) + 1;
        const nextStatus = newHiredCount >= (job.headcount_needed || 1) ? 'FILLED' : 'OPEN';

        await client.query(
          `UPDATE applications SET status = 'accepted', role = 'PRIMARY', responded_at = now() WHERE id = $1`,
          [appId]
        );
        await client.query(
          `UPDATE jobs SET status = $2, hired_count = $3, version = version + 1, updated_at = now() WHERE id = $1`,
          [jobId, nextStatus, newHiredCount]
        );

        return {
          ok: true as const,
          workerId: appRes.rows[0].worker_id,
          jobTitle: job.title,
          nextStatus,
          newHiredCount
        };
      });

      if (!outcome.ok) {
        return reply.code(outcome.status).send({ error: outcome.error, message: outcome.message });
      }

      void notifyUser(pool, {
        userId: outcome.workerId,
        type: 'backup_promoted',
        title: `Promoted to Primary: ${outcome.jobTitle}`,
        body: 'You have been promoted from standby backup to primary worker!',
        jobId
      });

      return reply.code(200).send({
        application_id: appId,
        status: 'accepted',
        role: 'PRIMARY',
        job_status: outcome.nextStatus,
        hired_count: outcome.newHiredCount
      });
    }
  );

  // POST /v1/jobs/:id/applications/:appId/cancel (worker cancels accepted/pending shift; applies -15 trust penalty if accepted)
  app.post<{ Params: { id: string; appId: string } }>(
    '/jobs/:id/applications/:appId/cancel',
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
      const workerId = req.user.sub;
      const { id: jobId, appId } = req.params;

      const outcome = await withTransaction(pool, async (client) => {
        const appRes = await client.query<{ id: string; worker_id: string; status: string }>(
          `SELECT id, worker_id, status FROM applications WHERE id = $1 AND job_id = $2 FOR UPDATE`,
          [appId, jobId]
        );
        if (appRes.rowCount === 0) {
          return { ok: false as const, status: 404, error: 'APPLICATION_NOT_FOUND', message: 'Application not found' };
        }
        const application = appRes.rows[0];
        if (application.worker_id !== workerId) {
          return { ok: false as const, status: 403, error: 'FORBIDDEN', message: 'Only the applicant can cancel' };
        }
        if (application.status !== 'accepted' && application.status !== 'pending' && application.status !== 'backup') {
          return { ok: false as const, status: 409, error: 'INVALID_STATUS', message: `Cannot cancel from status ${application.status}` };
        }

        const jobRes = await client.query<{ poster_id: string; title: string; status: string; hired_count: number }>(
          `SELECT poster_id, title, status, hired_count FROM jobs WHERE id = $1 FOR UPDATE`,
          [jobId]
        );
        const job = jobRes.rows[0];

        await client.query(
          `UPDATE applications SET status = 'cancelled', responded_at = now() WHERE id = $1`,
          [appId]
        );

        let penalized = false;
        let newTrustScore: number | null = null;
        if (application.status === 'accepted') {
          penalized = true;
          const userRes = await client.query<{ trust_score: number }>(
            `SELECT trust_score FROM users WHERE id = $1 FOR UPDATE`,
            [workerId]
          );
          const currentScore = userRes.rows[0]?.trust_score ?? 100;
          newTrustScore = Math.max(0, currentScore - 15);
          const newTrustLevel = deriveTrustLevel(newTrustScore);

          await client.query(
            `UPDATE users
                SET cancellation_count = cancellation_count + 1,
                    trust_score = $2,
                    trust_level = $3,
                    updated_at = now()
              WHERE id = $1`,
            [workerId, newTrustScore, newTrustLevel]
          );

          const nextHired = Math.max(0, (job.hired_count || 1) - 1);
          const nextJobStatus = job.status === 'FILLED' ? 'OPEN' : job.status;
          await client.query(
            `UPDATE jobs
                SET hired_count = $2,
                    status = $3,
                    version = version + 1,
                    updated_at = now()
              WHERE id = $1`,
            [jobId, nextHired, nextJobStatus]
          );
        }

        return { ok: true as const, penalized, newTrustScore, posterId: job.poster_id, jobTitle: job.title };
      });

      if (!outcome.ok) {
        return reply.code(outcome.status).send({ error: outcome.error, message: outcome.message });
      }

      if (outcome.penalized) {
        void notifyUser(pool, {
          userId: outcome.posterId,
          type: 'worker_cancelled',
          title: `Worker cancelled: ${outcome.jobTitle}`,
          body: 'An accepted worker cancelled. A slot is open again (check backup workers).',
          jobId
        });
      }

      return reply.code(200).send({
        application_id: appId,
        status: 'cancelled',
        penalty_applied: outcome.penalized,
        trust_score: outcome.newTrustScore
      });
    }
  );

  // POST /v1/jobs/:id/save (idempotent bookmark)
  app.post<{ Params: { id: string } }>(
    '/jobs/:id/save',
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
      await pool.query(
        `INSERT INTO saved_jobs (user_id, job_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.user.sub, req.params.id]
      );
      return reply.code(200).send({ job_id: req.params.id, saved: true });
    }
  );

  // DELETE /v1/jobs/:id/save (idempotent unbookmark)
  app.delete<{ Params: { id: string } }>(
    '/jobs/:id/save',
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
      await pool.query(
        `DELETE FROM saved_jobs WHERE user_id = $1 AND job_id = $2`,
        [req.user.sub, req.params.id]
      );
      return reply.code(200).send({ job_id: req.params.id, saved: false });
    }
  );
}
