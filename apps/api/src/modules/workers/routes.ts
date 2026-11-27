import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { notifyUser } from '../../shared/notifications.js';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

export async function registerWorkerRoutes(
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

  // GET /v1/past-workers (previously hired workers with ratings)
  app.get('/past-workers', { preHandler: [authenticate] }, async (req, reply) => {
    const employerId = req.user.sub;

    const res = await pool.query<{
      worker_id: string;
      verified_name: string | null;
      avg_rating: string;
      rating_count: number;
      trust_score: number;
      trust_level: number;
      is_18_verified: boolean;
      shifts_together: string;
      last_job_title: string | null;
    }>(
      `SELECT u.id AS worker_id,
              COALESCE(u.verified_name, 'Worker') AS verified_name,
              u.avg_rating::text,
              u.rating_count,
              u.trust_score,
              u.trust_level,
              u.is_18_verified,
              COUNT(DISTINCT j.id)::text AS shifts_together,
              MAX(j.title) AS last_job_title
         FROM jobs j
         JOIN applications a ON a.job_id = j.id AND a.status = 'accepted'
         JOIN users u ON u.id = a.worker_id
        WHERE j.poster_id = $1
        GROUP BY u.id
        ORDER BY MAX(j.created_at) DESC
        LIMIT 50`,
      [employerId]
    );

    return reply.code(200).send({
      workers: res.rows.map((w) => ({
        worker_id: w.worker_id,
        name: w.verified_name ?? 'Worker',
        avg_rating: Number(w.avg_rating ?? 0),
        rating_count: w.rating_count,
        trust_score: w.trust_score,
        trust_level: w.trust_level,
        is_18_verified: w.is_18_verified,
        shifts_together: Number(w.shifts_together),
        last_job_title: w.last_job_title ?? ''
      }))
    });
  });

  // POST /v1/jobs/:id/invite (create invite notification for past worker)
  app.post<{ Params: { id: string }; Body: { worker_id: string } }>(
    '/jobs/:id/invite',
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
          required: ['worker_id'],
          additionalProperties: false,
          properties: {
            worker_id: { type: 'string', pattern: UUID_PATTERN }
          }
        }
      }
    },
    async (req, reply) => {
      const employerId = req.user.sub;
      const jobId = req.params.id;
      const { worker_id } = req.body;

      const jobRes = await pool.query<{ id: string; poster_id: string; title: string; status: string }>(
        `SELECT id, poster_id, title, status FROM jobs WHERE id = $1`,
        [jobId]
      );
      if (jobRes.rowCount === 0) {
        return reply.code(404).send({ error: 'JOB_NOT_FOUND', message: 'Job not found' });
      }
      const job = jobRes.rows[0];
      if (job.poster_id !== employerId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Only the job owner can invite workers' });
      }

      await notifyUser(pool, {
        userId: worker_id,
        type: 'job_invite',
        title: `Invited to shift: ${job.title}`,
        body: 'An employer you worked with invited you to apply for an open shift.',
        jobId
      });

      return reply.code(200).send({ status: 'invited', job_id: jobId, worker_id });
    }
  );
}
