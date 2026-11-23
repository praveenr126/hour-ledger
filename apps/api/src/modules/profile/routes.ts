import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../../config.js';
import { withTransaction } from '../../db.js';

type IdType = 'pan' | 'driving_licence' | 'college_id';
type LivenessPrompt = 'blink' | 'head_turn';

interface VerifyBody {
  verified_name: string;
  dob: string;
  id_type: IdType;
  id_number: string;
  liveness_passed: boolean;
  liveness_prompt: LivenessPrompt;
}

const ID_PATTERNS: Record<IdType, RegExp> = {
  pan: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  driving_licence: /^[A-Z0-9]{8,20}$/,
  college_id: /^[A-Z0-9]{4,20}$/
};

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function normalizeIdNumber(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, '');
}

function hashIdNumber(idType: IdType, normalizedId: string, salt: string): string {
  return crypto
    .createHmac('sha256', salt)
    .update(`${idType}:${normalizedId}`)
    .digest('hex');
}

export async function registerProfileRoutes(
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

  // GET /v1/profile
  app.get('/profile', { preHandler: [authenticate] }, async (req, reply) => {
    const res = await pool.query<{
      id: string;
      phone: string;
      role: string;
      status: string;
      verified_name: string | null;
      age_verified_at: Date | null;
      id_type: string | null;
      id_last4: string | null;
      trust_level: number;
      responsiveness_score: number;
      balance_paise: string;
    }>(
      `SELECT u.id, u.phone, u.role, u.status, u.verified_name,
              u.age_verified_at, u.id_type, u.id_last4,
              u.trust_level, u.responsiveness_score, w.balance_paise
         FROM users u
         JOIN wallets w ON w.user_id = u.id
        WHERE u.id = $1`,
      [req.user.sub]
    );

    if (res.rowCount === 0) {
      return reply.code(404).send({ error: 'USER_NOT_FOUND', message: 'User not found' });
    }

    const row = res.rows[0];
    return reply.code(200).send({
      id: row.id,
      phone: row.phone,
      role: row.role,
      status: row.status,
      verified_name: row.verified_name,
      age_verified: row.age_verified_at !== null,
      age_verified_at: row.age_verified_at ? row.age_verified_at.toISOString() : null,
      id_type: row.id_type,
      id_last4: row.id_last4,
      trust_level: row.trust_level,
      responsiveness_score: row.responsiveness_score,
      wallet_balance_paise: Number(row.balance_paise)
    });
  });

  // POST /v1/profile/verify
  app.post<{ Body: VerifyBody }>(
    '/profile/verify',
    {
      preHandler: [authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['verified_name', 'dob', 'id_type', 'id_number', 'liveness_passed', 'liveness_prompt'],
          additionalProperties: false,
          properties: {
            verified_name: { type: 'string', minLength: 2, maxLength: 100 },
            dob: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            id_type: { type: 'string', enum: ['pan', 'driving_licence', 'college_id'] },
            id_number: { type: 'string', minLength: 4, maxLength: 32 },
            liveness_passed: { type: 'boolean' },
            liveness_prompt: { type: 'string', enum: ['blink', 'head_turn'] }
          }
        }
      }
    },
    async (req, reply) => {
      const { verified_name, dob, id_type, id_number, liveness_passed, liveness_prompt } = req.body;
      const trimmedName = verified_name.trim();

      if (trimmedName.length < 2) {
        return reply.code(400).send({ error: 'INVALID_NAME', message: 'Verified name is required' });
      }
      if (!liveness_passed) {
        return reply.code(400).send({ error: 'LIVENESS_REQUIRED', message: 'Live selfie check did not pass' });
      }
      if (!isValidIsoDate(dob)) {
        return reply.code(400).send({ error: 'INVALID_DOB', message: 'Date of birth is not a valid calendar date' });
      }

      const normalizedId = normalizeIdNumber(id_number);
      if (!ID_PATTERNS[id_type].test(normalizedId)) {
        return reply.code(400).send({ error: 'INVALID_ID_FORMAT', message: `Invalid format for ${id_type}` });
      }

      const idHash = hashIdNumber(id_type, normalizedId, config.idHashSalt);
      const idLast4 = normalizedId.slice(-4);

      try {
        const result = await withTransaction(pool, async (client) => {
          const ageRes = await client.query<{ is_adult: boolean; is_past: boolean }>(
            `SELECT (EXTRACT(YEAR FROM age((now() AT TIME ZONE 'UTC')::date, $1::date)) >= 18) AS is_adult,
                    ($1::date <= (now() AT TIME ZONE 'UTC')::date) AS is_past`,
            [dob]
          );
          if (!ageRes.rows[0].is_past || !ageRes.rows[0].is_adult) {
            return { ok: false as const, status: 400, error: 'UNDERAGE', message: 'User must be at least 18 years old' };
          }

          const userRes = await client.query<{
            id: string;
            status: string;
            age_verified_at: Date | null;
          }>(
            `SELECT id, status, age_verified_at
               FROM users
              WHERE id = $1
                FOR UPDATE`,
            [req.user.sub]
          );

          if (userRes.rowCount === 0) {
            return { ok: false as const, status: 404, error: 'USER_NOT_FOUND', message: 'User not found' };
          }
          if (userRes.rows[0].status !== 'active') {
            return { ok: false as const, status: 403, error: 'ACCOUNT_DISABLED', message: 'Account is not active' };
          }
          if (userRes.rows[0].age_verified_at !== null) {
            return { ok: false as const, status: 409, error: 'ALREADY_VERIFIED', message: 'Profile is already verified' };
          }

          const updated = await client.query<{
            id: string;
            verified_name: string;
            id_type: string;
            id_last4: string;
            age_verified_at: Date;
            trust_level: number;
          }>(
            `UPDATE users
                SET verified_name = $2,
                    dob = $3::date,
                    age_verified_at = now(),
                    id_type = $4,
                    id_last4 = $5,
                    id_hash = $6,
                    updated_at = now()
              WHERE id = $1
             RETURNING id, verified_name, id_type, id_last4, age_verified_at, trust_level`,
            [req.user.sub, trimmedName, dob, id_type, idLast4, idHash]
          );

          const row = updated.rows[0];
          // Store only non-sensitive metadata in audit_log (never raw ID or image)
          await client.query(
            `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
             VALUES ($1, 'user', $1, $2::jsonb, $3::jsonb)`,
            [
              row.id,
              JSON.stringify({ age_verified: false }),
              JSON.stringify({
                event: 'profile_verified',
                age_verified: true,
                verified_name: row.verified_name,
                id_type: row.id_type,
                id_last4: row.id_last4,
                liveness_prompt,
                face_match: 'mock_passed'
              })
            ]
          );

          return { ok: true as const, row };
        });

        if (!result.ok) {
          return reply.code(result.status).send({ error: result.error, message: result.message });
        }

        return reply.code(200).send({
          id: result.row.id,
          verified_name: result.row.verified_name,
          age_verified: true,
          age_verified_at: result.row.age_verified_at.toISOString(),
          id_type: result.row.id_type,
          id_last4: result.row.id_last4,
          trust_level: result.row.trust_level,
          face_match: 'mock_passed'
        });
      } catch (err) {
        const pgErr = err as { code?: string };
        if (pgErr?.code === '23505') {
          return reply.code(409).send({
            error: 'DUPLICATE_ID',
            message: 'This ID is already linked to another account'
          });
        }
        throw err;
      }
    }
  );
}
