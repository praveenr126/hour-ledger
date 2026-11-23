import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';

const testDbUrl =
  process.env.TEST_DATABASE_URL ??
  'postgres://hourledger:hourledger_dev_password@127.0.0.1:5432/hourledger_api_test';

let config: AppConfig;
let pool: Pool;
let app: FastifyInstance;

beforeAll(async () => {
  config = loadConfig({
    databaseUrl: testDbUrl,
    jwtSecret: 'test_jwt_secret_at_least_32_characters_long_0001',
    otpPepper: 'test_otp_pepper_at_least_16_chars',
    devShowOtp: true
  });
  pool = new Pool({ connectionString: testDbUrl });
  app = await buildApp({ config, pool, logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('Phase 0 Step 2: /v1 health and mock OTP auth', () => {
  it('returns healthy status with UTC server time', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe('up');
    expect(body.server_time_utc).toMatch(/Z$/);
  });

  it('rejects invalid phone numbers via JSON schema validation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: 'not-a-phone', extraField: true }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
  });

  it('creates user, wallet, and audit_log on OTP verify and serves /v1/me', async () => {
    const phone = '+919111111101';

    const reqRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone }
    });
    expect(reqRes.statusCode).toBe(200);
    const { dev_otp } = reqRes.json();
    expect(dev_otp).toMatch(/^\d{6}$/);

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: { phone, code: dev_otp }
    });
    expect(verifyRes.statusCode).toBe(200);
    const auth = verifyRes.json();
    expect(auth.is_new_user).toBe(true);
    expect(auth.access_token).toBeTruthy();
    expect(auth.refresh_token).toBeTruthy();

    const meRes = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${auth.access_token}` }
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json()).toMatchObject({
      phone,
      wallet_balance_paise: 0,
      age_verified: false,
      trust_level: 0
    });

    const auditCount = await pool.query<{ count: string }>(
      `SELECT count(*) FROM audit_log WHERE actor_id = $1`,
      [auth.user.id]
    );
    expect(Number(auditCount.rows[0].count)).toBeGreaterThanOrEqual(2);
  });

  it('concurrency: 10 simultaneous OTP verify calls with same code -> exactly 1 succeeds', async () => {
    const phone = '+919111111102';
    const reqRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone }
    });
    const { dev_otp } = reqRes.json();

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({
          method: 'POST',
          url: '/v1/auth/otp/verify',
          payload: { phone, code: dev_otp }
        })
      )
    );

    const successes = results.filter((r) => r.statusCode === 200);
    const failures = results.filter((r) => r.statusCode === 401);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(9);
  });

  it('concurrency: 10 simultaneous refresh calls with same token -> exactly 1 succeeds', async () => {
    const phone = '+919111111103';
    const { dev_otp } = (
      await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } })
    ).json();
    const { refresh_token } = (
      await app.inject({
        method: 'POST',
        url: '/v1/auth/otp/verify',
        payload: { phone, code: dev_otp }
      })
    ).json();

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({
          method: 'POST',
          url: '/v1/auth/refresh',
          payload: { refresh_token }
        })
      )
    );

    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 401)).toHaveLength(9);
  });

  it('idempotency: calling logout twice with same refresh token returns 200 both times and blocks refresh', async () => {
    const phone = '+919111111104';
    const { dev_otp } = (
      await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } })
    ).json();
    const { refresh_token } = (
      await app.inject({
        method: 'POST',
        url: '/v1/auth/otp/verify',
        payload: { phone, code: dev_otp }
      })
    ).json();

    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      payload: { refresh_token }
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      payload: { refresh_token }
    });
    const refreshAfter = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token }
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(refreshAfter.statusCode).toBe(401);
  });

  it('restart persistence: pending OTP and refresh token survive a full API server restart', async () => {
    const phone = '+919111111105';

    // Server instance #1 requests OTP, then shuts down completely
    const server1 = await buildApp({ config, logger: false });
    await server1.ready();
    const { dev_otp } = (
      await server1.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } })
    ).json();
    await server1.close();

    // Server instance #2 (fresh process state + fresh DB pool) verifies the pending OTP
    const server2 = await buildApp({ config, logger: false });
    await server2.ready();
    const verifyRes = await server2.inject({
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: { phone, code: dev_otp }
    });
    expect(verifyRes.statusCode).toBe(200);
    const { refresh_token } = verifyRes.json();
    await server2.close();

    // Server instance #3 rotates the refresh token and reads /v1/me
    const server3 = await buildApp({ config, logger: false });
    await server3.ready();
    const refreshRes = await server3.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token }
    });
    expect(refreshRes.statusCode).toBe(200);

    const meRes = await server3.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${refreshRes.json().access_token}` }
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().phone).toBe(phone);
    await server3.close();
  });
});
