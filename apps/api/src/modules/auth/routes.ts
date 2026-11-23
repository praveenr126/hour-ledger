import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from '../../config.js';
import { withTransaction } from '../../db.js';
import {
  generateOtpCode,
  generateRefreshToken,
  hashOtpCode,
  hashRefreshToken,
  verifyOtpHash
} from './crypto.js';
import type { OtpSender } from './otp-sender.js';

const PHONE_PATTERN = '^\\+[1-9]\\d{9,14}$';
const OTP_PATTERN = '^\\d{6}$';
const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const REFRESH_TTL_DAYS = 30;

interface AuthPluginDeps {
  pool: Pool;
  config: AppConfig;
  otpSender: OtpSender;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthPluginDeps
): Promise<void> {
  const { pool, config, otpSender } = deps;

  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid or expired access token' });
    }
  };

  // POST /v1/auth/otp/request
  app.post<{ Body: { phone: string } }>(
    '/auth/otp/request',
    {
      schema: {
        body: {
          type: 'object',
          required: ['phone'],
          additionalProperties: false,
          properties: {
            phone: { type: 'string', pattern: PHONE_PATTERN }
          }
        }
      }
    },
    async (req, reply) => {
      const { phone } = req.body;
      const code = generateOtpCode();
      const codeHash = hashOtpCode(phone, code, config.otpPepper);

      const { expiresAt } = await withTransaction(pool, async (client) => {
        // Invalidate any older pending OTP for this phone
        await client.query(
          `UPDATE otp_challenges
              SET consumed_at = now()
            WHERE phone = $1 AND consumed_at IS NULL`,
          [phone]
        );

        const res = await client.query<{ expires_at: Date }>(
          `INSERT INTO otp_challenges (phone, code_hash, expires_at)
           VALUES ($1, $2, now() + ($3 || ' minutes')::interval)
           RETURNING expires_at`,
          [phone, codeHash, OTP_TTL_MINUTES]
        );
        return { expiresAt: res.rows[0].expires_at.toISOString() };
      });

      await otpSender.sendOtp(phone, code);

      const payload: Record<string, unknown> = {
        status: 'sent',
        expires_at: expiresAt
      };
      if (config.devShowOtp) {
        payload.dev_otp = code;
      }

      return reply.code(200).send(payload);
    }
  );

  // POST /v1/auth/otp/verify
  app.post<{ Body: { phone: string; code: string } }>(
    '/auth/otp/verify',
    {
      schema: {
        body: {
          type: 'object',
          required: ['phone', 'code'],
          additionalProperties: false,
          properties: {
            phone: { type: 'string', pattern: PHONE_PATTERN },
            code: { type: 'string', pattern: OTP_PATTERN }
          }
        }
      }
    },
    async (req, reply) => {
      const { phone, code } = req.body;
      const providedHash = hashOtpCode(phone, code, config.otpPepper);

      const outcome = await withTransaction(pool, async (client) => {
        const otpRes = await client.query<{
          id: string;
          code_hash: string;
          attempts: number;
          is_expired: boolean;
        }>(
          `SELECT id, code_hash, attempts, (expires_at <= now()) AS is_expired
             FROM otp_challenges
            WHERE phone = $1 AND consumed_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1
              FOR UPDATE`,
          [phone]
        );

        if (otpRes.rowCount === 0) {
          return { ok: false as const, error: 'OTP_INVALID', message: 'No active OTP challenge found' };
        }

        const challenge = otpRes.rows[0];
        if (challenge.is_expired) {
          await client.query(`UPDATE otp_challenges SET consumed_at = now() WHERE id = $1`, [challenge.id]);
          return { ok: false as const, error: 'OTP_EXPIRED', message: 'OTP has expired' };
        }

        if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
          await client.query(`UPDATE otp_challenges SET consumed_at = now() WHERE id = $1`, [challenge.id]);
          return { ok: false as const, error: 'OTP_MAX_ATTEMPTS', message: 'Too many invalid attempts' };
        }

        if (!verifyOtpHash(challenge.code_hash, providedHash)) {
          await client.query(
            `UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1`,
            [challenge.id]
          );
          return { ok: false as const, error: 'OTP_INVALID', message: 'Incorrect OTP code' };
        }

        // Mark OTP consumed so concurrent requests cannot reuse it
        await client.query(`UPDATE otp_challenges SET consumed_at = now() WHERE id = $1`, [challenge.id]);

        // Create user and wallet if new
        const insertedUser = await client.query<{ id: string; role: string; status: string }>(
          `INSERT INTO users (phone)
           VALUES ($1)
           ON CONFLICT (phone) DO NOTHING
           RETURNING id, role, status`,
          [phone]
        );

        let user = insertedUser.rows[0];
        let isNewUser = false;

        if (user) {
          isNewUser = true;
          await client.query(
            `INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
            [user.id]
          );
          await client.query(
            `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
             VALUES ($1, 'user', $1, NULL, $2::jsonb)`,
            [user.id, JSON.stringify({ event: 'user_created', phone, role: user.role, status: user.status })]
          );
        } else {
          const existing = await client.query<{ id: string; role: string; status: string }>(
            `SELECT id, role, status FROM users WHERE phone = $1`,
            [phone]
          );
          user = existing.rows[0];
        }

        if (user.status !== 'active') {
          return { ok: false as const, error: 'ACCOUNT_DISABLED', message: 'Account is not active' };
        }

        const rawRefresh = generateRefreshToken();
        const refreshHash = hashRefreshToken(rawRefresh);
        const tokenRes = await client.query<{ id: string; expires_at: Date }>(
          `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, now() + ($3 || ' days')::interval)
           RETURNING id, expires_at`,
          [user.id, refreshHash, REFRESH_TTL_DAYS]
        );

        await client.query(
          `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
           VALUES ($1, 'refresh_token', $2, NULL, $3::jsonb)`,
          [user.id, tokenRes.rows[0].id, JSON.stringify({ event: 'login_otp' })]
        );

        return {
          ok: true as const,
          user,
          isNewUser,
          refreshToken: rawRefresh,
          refreshExpiresAt: tokenRes.rows[0].expires_at.toISOString()
        };
      });

      if (!outcome.ok) {
        const status = outcome.error === 'ACCOUNT_DISABLED' ? 403 : 401;
        return reply.code(status).send({ error: outcome.error, message: outcome.message });
      }

      const accessToken = app.jwt.sign(
        { sub: outcome.user.id, role: outcome.user.role },
        { expiresIn: '15m' }
      );

      return reply.code(200).send({
        access_token: accessToken,
        refresh_token: outcome.refreshToken,
        refresh_expires_at: outcome.refreshExpiresAt,
        is_new_user: outcome.isNewUser,
        user: {
          id: outcome.user.id,
          role: outcome.user.role,
          status: outcome.user.status
        }
      });
    }
  );

  // POST /v1/auth/refresh (single-use rotating refresh token)
  app.post<{ Body: { refresh_token: string } }>(
    '/auth/refresh',
    {
      schema: {
        body: {
          type: 'object',
          required: ['refresh_token'],
          additionalProperties: false,
          properties: {
            refresh_token: { type: 'string', minLength: 20 }
          }
        }
      }
    },
    async (req, reply) => {
      const tokenHash = hashRefreshToken(req.body.refresh_token);

      const outcome = await withTransaction(pool, async (client) => {
        const currentRes = await client.query<{
          id: string;
          user_id: string;
          is_expired: boolean;
        }>(
          `SELECT id, user_id, (expires_at <= now()) AS is_expired
             FROM refresh_tokens
            WHERE token_hash = $1 AND revoked_at IS NULL
              FOR UPDATE`,
          [tokenHash]
        );

        if (currentRes.rowCount === 0) {
          return { ok: false as const, error: 'REFRESH_INVALID', message: 'Invalid or already used refresh token' };
        }

        const current = currentRes.rows[0];
        if (current.is_expired) {
          await client.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [current.id]);
          return { ok: false as const, error: 'REFRESH_EXPIRED', message: 'Refresh token expired' };
        }

        const userRes = await client.query<{ id: string; role: string; status: string }>(
          `SELECT id, role, status FROM users WHERE id = $1`,
          [current.user_id]
        );
        const user = userRes.rows[0];
        if (!user || user.status !== 'active') {
          await client.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [current.id]);
          return { ok: false as const, error: 'ACCOUNT_DISABLED', message: 'Account is not active' };
        }

        const nextRaw = generateRefreshToken();
        const nextHash = hashRefreshToken(nextRaw);
        const nextRes = await client.query<{ id: string; expires_at: Date }>(
          `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, now() + ($3 || ' days')::interval)
           RETURNING id, expires_at`,
          [user.id, nextHash, REFRESH_TTL_DAYS]
        );

        await client.query(
          `UPDATE refresh_tokens
              SET revoked_at = now(), replaced_by = $2
            WHERE id = $1`,
          [current.id, nextRes.rows[0].id]
        );

        await client.query(
          `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
           VALUES ($1, 'refresh_token', $2, $3::jsonb, $4::jsonb)`,
          [
            user.id,
            current.id,
            JSON.stringify({ revoked: false }),
            JSON.stringify({ revoked: true, replaced_by: nextRes.rows[0].id })
          ]
        );

        return {
          ok: true as const,
          user,
          refreshToken: nextRaw,
          refreshExpiresAt: nextRes.rows[0].expires_at.toISOString()
        };
      });

      if (!outcome.ok) {
        const status = outcome.error === 'ACCOUNT_DISABLED' ? 403 : 401;
        return reply.code(status).send({ error: outcome.error, message: outcome.message });
      }

      const accessToken = app.jwt.sign(
        { sub: outcome.user.id, role: outcome.user.role },
        { expiresIn: '15m' }
      );

      return reply.code(200).send({
        access_token: accessToken,
        refresh_token: outcome.refreshToken,
        refresh_expires_at: outcome.refreshExpiresAt
      });
    }
  );

  // POST /v1/auth/logout (idempotent revocation)
  app.post<{ Body: { refresh_token: string } }>(
    '/auth/logout',
    {
      schema: {
        body: {
          type: 'object',
          required: ['refresh_token'],
          additionalProperties: false,
          properties: {
            refresh_token: { type: 'string', minLength: 20 }
          }
        }
      }
    },
    async (req, reply) => {
      const tokenHash = hashRefreshToken(req.body.refresh_token);

      await withTransaction(pool, async (client) => {
        const res = await client.query<{ id: string; user_id: string }>(
          `UPDATE refresh_tokens
              SET revoked_at = now()
            WHERE token_hash = $1 AND revoked_at IS NULL
            RETURNING id, user_id`,
          [tokenHash]
        );

        if (res.rowCount && res.rows[0]) {
          await client.query(
            `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
             VALUES ($1, 'refresh_token', $2, $3::jsonb, $4::jsonb)`,
            [res.rows[0].user_id, res.rows[0].id, JSON.stringify({ revoked: false }), JSON.stringify({ revoked: true, event: 'logout' })]
          );
        }
      });

      return reply.code(200).send({ status: 'logged_out' });
    }
  );

  // GET /v1/me (protected endpoint returning server-side user + wallet state)
  app.get('/me', { preHandler: [authenticate] }, async (req, reply) => {
    const res = await pool.query<{
      id: string;
      phone: string;
      role: string;
      status: string;
      age_verified_at: Date | null;
      trust_level: number;
      responsiveness_score: number;
      balance_paise: string;
    }>(
      `SELECT u.id, u.phone, u.role, u.status, u.age_verified_at,
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
      age_verified: row.age_verified_at !== null,
      trust_level: row.trust_level,
      responsiveness_score: row.responsiveness_score,
      wallet_balance_paise: Number(row.balance_paise)
    });
  });
}
