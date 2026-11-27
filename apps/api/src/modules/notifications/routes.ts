import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

export async function registerNotificationRoutes(
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

  // GET /v1/notifications
  app.get('/notifications', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = req.user.sub;

    const [listRes, countRes] = await Promise.all([
      pool.query<{
        id: string;
        type: string;
        title: string;
        body: string;
        job_id: string | null;
        payload: Record<string, unknown>;
        is_read: boolean;
        read_at: Date | null;
        created_at: Date;
      }>(
        `SELECT id, type, title, body, job_id, payload, is_read, read_at, created_at
           FROM notifications
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 50`,
        [userId]
      ),
      pool.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt
           FROM notifications
          WHERE user_id = $1 AND is_read = false AND read_at IS NULL`,
        [userId]
      )
    ]);

    return reply.code(200).send({
      unread_count: Number(countRes.rows[0]?.cnt ?? 0),
      notifications: listRes.rows.map((n) => {
        const p = n.payload ?? {};
        const fallbackTitle = typeof p.title === 'string' && p.title ? p.title : n.type.replace(/_/g, ' ');
        const fallbackBody = typeof p.body === 'string' ? p.body : '';
        const jobId = n.job_id ?? (typeof p.job_id === 'string' ? p.job_id : null);
        return {
          id: n.id,
          type: n.type,
          title: n.title || fallbackTitle,
          body: n.body || fallbackBody,
          job_id: jobId,
          is_read: n.is_read || n.read_at !== null,
          created_at: n.created_at.toISOString()
        };
      })
    });
  });

  // POST /v1/notifications/:id/read
  app.post<{ Params: { id: string } }>(
    '/notifications/:id/read',
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
      const notifId = req.params.id;
      await pool.query(
        `UPDATE notifications
            SET is_read = true,
                read_at = COALESCE(read_at, now())
          WHERE id = $1 AND user_id = $2`,
        [notifId, userId]
      );
      return reply.code(200).send({ id: notifId, is_read: true });
    }
  );

  // POST /v1/notifications/read-all
  app.post('/notifications/read-all', { preHandler: [authenticate] }, async (req, reply) => {
    const userId = req.user.sub;
    await pool.query(
      `UPDATE notifications
          SET is_read = true,
              read_at = COALESCE(read_at, now())
        WHERE user_id = $1 AND (is_read = false OR read_at IS NULL)`,
      [userId]
    );
    return reply.code(200).send({ status: 'ok' });
  });

  // POST /v1/users/me/fcm-token
  app.post<{ Body: { token: string } }>(
    '/users/me/fcm-token',
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['token'],
          additionalProperties: false,
          properties: {
            token: { type: 'string', minLength: 10, maxLength: 512 }
          }
        }
      }
    },
    async (req, reply) => {
      await pool.query(
        `UPDATE users SET fcm_token = $2, updated_at = now() WHERE id = $1`,
        [req.user.sub, req.body.token.trim()]
      );
      return reply.code(200).send({ status: 'ok' });
    }
  );
}
