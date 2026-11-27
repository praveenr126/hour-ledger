import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { withTransaction } from '../../db.js';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

export async function registerRatingRoutes(
  app: FastifyInstance,
  deps: { pool: Pool }
): Promise<void> {
  const { pool } = deps;

  const colRes = await pool.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'ratings'
        AND column_name IN ('stars', 'rating', 'score')`
  );
  const scoreCol = colRes.rows[0]?.column_name ?? 'stars';

  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid or expired access token' });
    }
  };

  // POST /v1/jobs/:id/rate (mutual 1-5 star rating on COMPLETED job)
  app.post<{
    Params: { id: string };
    Body: { stars: number; comment?: string; review?: string };
  }>(
    '/jobs/:id/rate',
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
          required: ['stars'],
          additionalProperties: false,
          properties: {
            stars: { type: 'integer', minimum: 1, maximum: 5 },
            comment: { type: 'string', maxLength: 500 },
            review: { type: 'string', maxLength: 500 }
          }
        }
      }
    },
    async (req, reply) => {
      const raterId = req.user.sub;
      const jobId = req.params.id;
      const { stars, comment, review } = req.body;
      const trimmedComment = (review ?? comment ?? '').trim();

      try {
        const outcome = await withTransaction(pool, async (client) => {
          const jobRes = await client.query<{
            id: string;
            poster_id: string;
            status: string;
          }>(
            `SELECT id, poster_id, status FROM jobs WHERE id = $1 FOR SHARE`,
            [jobId]
          );

          if (jobRes.rowCount === 0) {
            return { ok: false as const, status: 404, error: 'JOB_NOT_FOUND', message: 'Job not found' };
          }
          const job = jobRes.rows[0];
          if (job.status !== 'COMPLETED') {
            return {
              ok: false as const,
              status: 409,
              error: 'JOB_NOT_COMPLETED',
              message: `Ratings are only allowed after job is COMPLETED (current: ${job.status})`
            };
          }

          const shiftRes = await client.query<{ worker_id: string }>(
            `SELECT worker_id FROM job_shifts WHERE job_id = $1`,
            [jobId]
          );
          if (shiftRes.rowCount === 0) {
            return { ok: false as const, status: 409, error: 'SHIFT_NOT_FOUND', message: 'Shift record missing' };
          }
          const workerId = shiftRes.rows[0].worker_id;

          let rateeId: string;
          if (raterId === job.poster_id) {
            rateeId = workerId;
          } else if (raterId === workerId) {
            rateeId = job.poster_id;
          } else {
            return {
              ok: false as const,
              status: 403,
              error: 'FORBIDDEN',
              message: 'Only the poster and assigned worker can rate this job'
            };
          }

          const dupRes = await client.query<{ id: string }>(
            `SELECT id FROM ratings WHERE job_id = $1 AND rater_id = $2`,
            [jobId, raterId]
          );
          if (dupRes.rowCount && dupRes.rows[0]) {
            return {
              ok: false as const,
              status: 409,
              error: 'ALREADY_RATED',
              message: 'You have already submitted a rating for this job'
            };
          }

          const insertRes = await client.query<{ id: string; created_at: Date }>(
            `INSERT INTO ratings (job_id, rater_id, ratee_id, ${scoreCol}, comment, review)
             VALUES ($1, $2, $3, $4, $5, $5)
             RETURNING id, created_at`,
            [jobId, raterId, rateeId, stars, trimmedComment]
          );

          await client.query(
            `UPDATE users
                SET avg_rating = (SELECT COALESCE(ROUND(AVG(${scoreCol})::numeric, 2), 0) FROM ratings WHERE ratee_id = $1),
                    rating_count = (SELECT COUNT(*)::integer FROM ratings WHERE ratee_id = $1),
                    trust_level = CASE WHEN $2 >= 4 THEN LEAST(5, trust_level + 1) ELSE trust_level END,
                    updated_at = now()
              WHERE id = $1`,
            [rateeId, stars]
          );

          await client.query(
            `INSERT INTO notifications (user_id, type, payload)
             VALUES ($1, 'rating_received', $2::jsonb)`,
            [rateeId, JSON.stringify({ job_id: jobId, stars })]
          );

          await client.query(
            `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
             VALUES ($1, 'rating', $2, NULL, $3::jsonb)`,
            [
              raterId,
              insertRes.rows[0].id,
              JSON.stringify({ job_id: jobId, ratee_id: rateeId, stars })
            ]
          );

          return {
            ok: true as const,
            ratingId: insertRes.rows[0].id,
            rateeId,
            createdAt: insertRes.rows[0].created_at.toISOString()
          };
        });

        if (!outcome.ok) {
          return reply.code(outcome.status).send({ error: outcome.error, message: outcome.message });
        }

        return reply.code(201).send({
          id: outcome.ratingId,
          job_id: jobId,
          rater_id: raterId,
          ratee_id: outcome.rateeId,
          stars,
          comment: trimmedComment,
          created_at: outcome.createdAt
        });
      } catch (err) {
        const pgErr = err as { code?: string };
        if (pgErr?.code === '23505') {
          return reply.code(409).send({
            error: 'ALREADY_RATED',
            message: 'You have already submitted a rating for this job'
          });
        }
        throw err;
      }
    }
  );
}
