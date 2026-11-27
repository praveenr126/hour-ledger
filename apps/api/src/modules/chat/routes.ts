import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { notifyUser } from '../../shared/notifications.js';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

export async function registerChatRoutes(
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

  async function canAccessJobChat(jobId: string, userId: string): Promise<{
    allowed: boolean;
    jobTitle?: string;
    posterId?: string;
  }> {
    const jobRes = await pool.query<{ id: string; title: string; poster_id: string }>(
      `SELECT id, title, poster_id FROM jobs WHERE id = $1`,
      [jobId]
    );
    if (jobRes.rowCount === 0) return { allowed: false };
    const job = jobRes.rows[0];
    if (job.poster_id === userId) {
      return { allowed: true, jobTitle: job.title, posterId: job.poster_id };
    }
    const appRes = await pool.query<{ id: string }>(
      `SELECT id FROM applications
        WHERE job_id = $1 AND worker_id = $2
          AND status IN ('pending', 'accepted', 'backup')`,
      [jobId, userId]
    );
    if (appRes.rowCount && appRes.rowCount > 0) {
      return { allowed: true, jobTitle: job.title, posterId: job.poster_id };
    }
    return { allowed: false };
  }

  // GET /v1/chats (per-job conversation list; never exposes phone numbers)
  app.get('/chats', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = req.user.sub;

    const res = await pool.query<{
      job_id: string;
      job_title: string;
      job_status: string;
      counterpart_name: string | null;
      last_message: string | null;
      last_message_at: Date | null;
    }>(
      `SELECT j.id AS job_id,
              j.title AS job_title,
              j.status AS job_status,
              CASE
                WHEN j.poster_id = $1 THEN COALESCE(
                  (SELECT COALESCE(u.verified_name, 'Worker')
                     FROM applications a
                     JOIN users u ON u.id = a.worker_id
                    WHERE a.job_id = j.id AND a.status IN ('accepted', 'pending', 'backup')
                    ORDER BY (a.status = 'accepted') DESC, a.applied_at DESC
                    LIMIT 1),
                  'Applicants'
                )
                ELSE COALESCE(p.verified_name, 'Employer')
              END AS counterpart_name,
              lm.body AS last_message,
              lm.created_at AS last_message_at
         FROM jobs j
         JOIN users p ON p.id = j.poster_id
         LEFT JOIN LATERAL (
           SELECT m.body, m.created_at
             FROM job_messages m
            WHERE m.job_id = j.id
            ORDER BY m.created_at DESC
            LIMIT 1
         ) lm ON true
        WHERE j.is_hidden = false
          AND (
            (j.poster_id = $1 AND EXISTS (
              SELECT 1 FROM applications a
               WHERE a.job_id = j.id AND a.status IN ('pending', 'accepted', 'backup')
            ))
            OR EXISTS (
              SELECT 1 FROM applications a
               WHERE a.job_id = j.id AND a.worker_id = $1 AND a.status IN ('pending', 'accepted', 'backup')
            )
            OR EXISTS (
              SELECT 1 FROM job_messages m WHERE m.job_id = j.id AND m.sender_id = $1
            )
          )
        ORDER BY COALESCE(lm.created_at, j.updated_at) DESC
        LIMIT 50`,
      [userId]
    );

    return reply.code(200).send({
      chats: res.rows.map((r) => ({
        job_id: r.job_id,
        job_title: r.job_title,
        job_status: r.job_status,
        counterpart_name: r.counterpart_name ?? 'Member',
        last_message: r.last_message ?? 'Tap to start chatting',
        last_message_at: r.last_message_at ? r.last_message_at.toISOString() : null,
        unread_count: 0
      }))
    });
  });

  // GET /v1/jobs/:id/messages
  app.get<{ Params: { id: string } }>(
    '/jobs/:id/messages',
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
      const access = await canAccessJobChat(jobId, userId);
      if (!access.allowed) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not authorized to view messages for this job' });
      }

      const res = await pool.query<{
        id: string;
        job_id: string;
        sender_id: string;
        sender_name: string | null;
        body: string;
        created_at: Date;
      }>(
        `SELECT m.id, m.job_id, m.sender_id,
                COALESCE(u.verified_name, CASE WHEN j.poster_id = m.sender_id THEN 'Employer' ELSE 'Worker' END) AS sender_name,
                m.body, m.created_at
           FROM job_messages m
           JOIN users u ON u.id = m.sender_id
           JOIN jobs j ON j.id = m.job_id
          WHERE m.job_id = $1
          ORDER BY m.created_at ASC
          LIMIT 200`,
        [jobId]
      );

      return reply.code(200).send({
        job_id: jobId,
        job_title: access.jobTitle ?? '',
        messages: res.rows.map((m) => ({
          id: m.id,
          job_id: m.job_id,
          sender_id: m.sender_id,
          sender_name: m.sender_name ?? 'Member',
          is_mine: m.sender_id === userId,
          body: m.body,
          created_at: m.created_at.toISOString()
        }))
      });
    }
  );

  // POST /v1/jobs/:id/messages
  app.post<{ Params: { id: string }; Body: { body: string } }>(
    '/jobs/:id/messages',
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
          required: ['body'],
          additionalProperties: false,
          properties: {
            body: { type: 'string', minLength: 1, maxLength: 1000 }
          }
        }
      }
    },
    async (req, reply) => {
      const userId = req.user.sub;
      const jobId = req.params.id;
      const text = req.body.body.trim();
      if (!text) {
        return reply.code(400).send({ error: 'EMPTY_MESSAGE', message: 'Message body cannot be empty' });
      }

      const access = await canAccessJobChat(jobId, userId);
      if (!access.allowed) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not authorized to message on this job' });
      }

      const inserted = await pool.query<{ id: string; created_at: Date }>(
        `INSERT INTO job_messages (job_id, sender_id, body)
         VALUES ($1, $2, $3)
         RETURNING id, created_at`,
        [jobId, userId, text]
      );

      // Notify counterpart(s) without failing parent request
      if (access.posterId && access.posterId !== userId) {
        void notifyUser(pool, {
          userId: access.posterId,
          type: 'chat_message',
          title: `New message: ${access.jobTitle ?? 'Shift'}`,
          body: text.slice(0, 100),
          jobId
        });
      } else {
        const workersRes = await pool.query<{ worker_id: string }>(
          `SELECT worker_id FROM applications
            WHERE job_id = $1 AND status IN ('accepted', 'pending', 'backup')`,
          [jobId]
        );
        for (const w of workersRes.rows) {
          if (w.worker_id !== userId) {
            void notifyUser(pool, {
              userId: w.worker_id,
              type: 'chat_message',
              title: `New message: ${access.jobTitle ?? 'Shift'}`,
              body: text.slice(0, 100),
              jobId
            });
          }
        }
      }

      return reply.code(201).send({
        id: inserted.rows[0].id,
        job_id: jobId,
        sender_id: userId,
        is_mine: true,
        body: text,
        created_at: inserted.rows[0].created_at.toISOString()
      });
    }
  );
}
