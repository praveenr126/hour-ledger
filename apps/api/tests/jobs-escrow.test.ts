import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { runExpirySweep } from '../src/modules/jobs/expiry-worker.js';

const testDbUrl =
  process.env.TEST_DATABASE_URL ??
  'postgres://hourledger:hourledger_dev_password@127.0.0.1:5432/hourledger_api_test';

let config: AppConfig;
let pool: Pool;
let app: FastifyInstance;

async function createVerifiedUser(
  instance: FastifyInstance,
  phone: string,
  name: string,
  pan: string
) {
  const { dev_otp } = (
    await instance.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } })
  ).json();
  const auth = (
    await instance.inject({
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: { phone, code: dev_otp }
    })
  ).json() as { access_token: string; user: { id: string } };

  const verifyRes = await instance.inject({
    method: 'POST',
    url: '/v1/profile/verify',
    headers: { authorization: `Bearer ${auth.access_token}` },
    payload: {
      verified_name: name,
      dob: '1999-06-15',
      id_type: 'pan',
      id_number: pan,
      liveness_passed: true,
      liveness_prompt: 'blink'
    }
  });
  expect(verifyRes.statusCode).toBe(200);
  return { token: auth.access_token, userId: auth.user.id };
}

beforeAll(async () => {
  config = loadConfig({
    databaseUrl: testDbUrl,
    jwtSecret: 'test_jwt_secret_at_least_32_characters_long_0001',
    otpPepper: 'test_otp_pepper_at_least_16_chars',
    idHashSalt: 'test_id_hash_salt_at_least_16_chars',
    adminApiKey: 'test_admin_api_key_at_least_16_chars',
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

describe('Phase 1 Step 1: Jobs, escrow ledger, applications, and expiry worker', () => {
  it('idempotency: duplicate top-up and fund calls replay once and reject payload reuse', async () => {
    const poster = await createVerifiedUser(app, '+919333333301', 'Poster One', 'ABCDE1111A');
    const headers = { authorization: `Bearer ${poster.token}` };
    const topupKey = `idem-topup-${crypto.randomUUID()}`;

    const t1 = await app.inject({
      method: 'POST',
      url: '/v1/wallet/topup',
      headers: { ...headers, 'idempotency-key': topupKey },
      payload: { amount_paise: 100000 }
    });
    const t2 = await app.inject({
      method: 'POST',
      url: '/v1/wallet/topup',
      headers: { ...headers, 'idempotency-key': topupKey },
      payload: { amount_paise: 100000 }
    });
    expect(t1.statusCode).toBe(200);
    expect(t2.statusCode).toBe(200);
    expect(t2.json().txn_id).toBe(t1.json().txn_id);
    expect(t2.json().wallet_balance_paise).toBe(100000);

    // Same key with different amount -> 409 conflict
    const tConflict = await app.inject({
      method: 'POST',
      url: '/v1/wallet/topup',
      headers: { ...headers, 'idempotency-key': topupKey },
      payload: { amount_paise: 200000 }
    });
    expect(tConflict.statusCode).toBe(409);
    expect(tConflict.json().error).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('escrow funding: blocks insufficient funds, funds valid job, and keeps global ledger sum = 0', async () => {
    const poster = await createVerifiedUser(app, '+919333333302', 'Poster Two', 'ABCDE2222B');
    const headers = { authorization: `Bearer ${poster.token}` };

    await app.inject({
      method: 'POST',
      url: '/v1/wallet/topup',
      headers: { ...headers, 'idempotency-key': `topup-${crypto.randomUUID()}` },
      payload: { amount_paise: 50000 } // Rs 500
    });

    const startAt = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers,
      payload: {
        title: 'Store inventory count',
        description: 'Count boxes in backroom',
        checklist: ['Count aisle A', 'Count aisle B'],
        hourly_rate_paise: 30000, // Rs 300/hr * 3h = Rs 900 (90000 paise)
        hours: 3,
        lat: 12.9141,
        lng: 74.856,
        address_text: 'MG Road, Mangaluru',
        start_at: startAt
      }
    });
    expect(createRes.statusCode).toBe(201);
    const jobId = createRes.json().id as string;

    // Insufficient wallet balance (50000 < 90000)
    const failFund = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/fund`,
      headers: { ...headers, 'idempotency-key': `fund-${crypto.randomUUID()}` }
    });
    expect(failFund.statusCode).toBe(400);
    expect(failFund.json().error).toBe('INSUFFICIENT_FUNDS');

    // Top up another Rs 500 -> total Rs 1000, then fund Rs 900
    await app.inject({
      method: 'POST',
      url: '/v1/wallet/topup',
      headers: { ...headers, 'idempotency-key': `topup-${crypto.randomUUID()}` },
      payload: { amount_paise: 50000 }
    });

    const fundKey = `fund-${crypto.randomUUID()}`;
    const okFund = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/fund`,
      headers: { ...headers, 'idempotency-key': fundKey }
    });
    expect(okFund.statusCode).toBe(200);
    expect(okFund.json()).toMatchObject({
      job_id: jobId,
      status: 'OPEN',
      escrow_held_paise: 90000,
      wallet_balance_paise: 10000
    });

    // Global ledger invariant check
    const sumRes = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount_paise), 0)::bigint AS total FROM ledger_entries`
    );
    expect(Number(sumRes.rows[0].total)).toBe(0);
  });

  it('concurrency: poster accepting two applicants simultaneously -> exactly 1 succeeds and job is FILLED', async () => {
    const poster = await createVerifiedUser(app, '+919333333303', 'Poster Three', 'ABCDE3333C');
    const workerA = await createVerifiedUser(app, '+919333333304', 'Worker A', 'ABCDE4444D');
    const workerB = await createVerifiedUser(app, '+919333333305', 'Worker B', 'ABCDE5555E');

    await app.inject({
      method: 'POST',
      url: '/v1/wallet/topup',
      headers: { authorization: `Bearer ${poster.token}`, 'idempotency-key': `topup-${crypto.randomUUID()}` },
      payload: { amount_paise: 100000 }
    });

    const jobRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { authorization: `Bearer ${poster.token}` },
      payload: {
        title: 'Event registration desk',
        description: 'Check in guests at front desk',
        hourly_rate_paise: 25000,
        hours: 2,
        lat: 12.915,
        lng: 74.857,
        start_at: new Date(Date.now() + 4 * 3600 * 1000).toISOString()
      }
    });
    const jobId = jobRes.json().id as string;

    await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/fund`,
      headers: { authorization: `Bearer ${poster.token}`, 'idempotency-key': `fund-${crypto.randomUUID()}` }
    });

    const appA = (
      await app.inject({
        method: 'POST',
        url: `/v1/jobs/${jobId}/apply`,
        headers: { authorization: `Bearer ${workerA.token}` }
      })
    ).json().id as string;

    const appB = (
      await app.inject({
        method: 'POST',
        url: `/v1/jobs/${jobId}/apply`,
        headers: { authorization: `Bearer ${workerB.token}` }
      })
    ).json().id as string;

    // Fire both accept requests concurrently
    const [resA, resB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/v1/jobs/${jobId}/applications/${appA}/accept`,
        headers: {
          authorization: `Bearer ${poster.token}`,
          'idempotency-key': `accept-a-${crypto.randomUUID()}`
        }
      }),
      app.inject({
        method: 'POST',
        url: `/v1/jobs/${jobId}/applications/${appB}/accept`,
        headers: {
          authorization: `Bearer ${poster.token}`,
          'idempotency-key': `accept-b-${crypto.randomUUID()}`
        }
      })
    ]);

    const statuses = [resA.statusCode, resB.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    const detail = (
      await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}`,
        headers: { authorization: `Bearer ${poster.token}` }
      })
    ).json();
    expect(detail.status).toBe('FILLED');
    expect(detail.applications.filter((a: { status: string }) => a.status === 'accepted')).toHaveLength(1);
    expect(detail.applications.filter((a: { status: string }) => a.status === 'rejected')).toHaveLength(1);
  });

  it('concurrency & restart: two simultaneous expiry sweeps refund an expired OPEN job exactly once and survive restart', async () => {
    const poster = await createVerifiedUser(app, '+919333333306', 'Poster Expiry', 'ABCDE6666F');

    await app.inject({
      method: 'POST',
      url: '/v1/wallet/topup',
      headers: { authorization: `Bearer ${poster.token}`, 'idempotency-key': `topup-${crypto.randomUUID()}` },
      payload: { amount_paise: 80000 }
    });

    const jobRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { authorization: `Bearer ${poster.token}` },
      payload: {
        title: 'Quick delivery helper',
        description: 'Unload cartons',
        hourly_rate_paise: 40000,
        hours: 2,
        lat: 12.91,
        lng: 74.85,
        start_at: new Date(Date.now() + 3600 * 1000).toISOString()
      }
    });
    const jobId = jobRes.json().id as string;

    await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/fund`,
      headers: { authorization: `Bearer ${poster.token}`, 'idempotency-key': `fund-${crypto.randomUUID()}` }
    });

    // Simulate time passing beyond start_at
    await pool.query(`UPDATE jobs SET start_at = now() - INTERVAL '1 minute' WHERE id = $1`, [jobId]);

    // Run two expiry sweeps in parallel (testing FOR UPDATE SKIP LOCKED)
    const [sweep1, sweep2] = await Promise.all([runExpirySweep(pool), runExpirySweep(pool)]);
    expect(sweep1.expiredJobs + sweep2.expiredJobs).toBe(1);

    // Restart API server and confirm wallet balance is 80000 (refunded once) and job is EXPIRED
    const restarted = await buildApp({ config, logger: false });
    await restarted.ready();

    const ledgerRes = await restarted.inject({
      method: 'GET',
      url: '/v1/wallet/ledger',
      headers: { authorization: `Bearer ${poster.token}` }
    });
    expect(ledgerRes.statusCode).toBe(200);
    expect(ledgerRes.json().wallet_balance_paise).toBe(80000);

    const jobAfter = await restarted.inject({
      method: 'GET',
      url: `/v1/jobs/${jobId}`,
      headers: { authorization: `Bearer ${poster.token}` }
    });
    expect(jobAfter.json().status).toBe('EXPIRED');
    expect(jobAfter.json().escrow_held_paise).toBe(0);

    const sumRes = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount_paise), 0)::bigint AS total FROM ledger_entries`
    );
    expect(Number(sumRes.rows[0].total)).toBe(0);

    await restarted.close();
  });
});
