import crypto from 'node:crypto';
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

async function setupFilledJob(
  instance: FastifyInstance,
  posterToken: string,
  workerToken: string,
  hourlyRatePaise = 30000,
  hours = 2
) {
  await instance.inject({
    method: 'POST',
    url: '/v1/wallet/topup',
    headers: {
      authorization: `Bearer ${posterToken}`,
      'idempotency-key': `topup-${crypto.randomUUID()}`
    },
    payload: { amount_paise: 100000 }
  });

  const jobRes = await instance.inject({
    method: 'POST',
    url: '/v1/jobs',
    headers: { authorization: `Bearer ${posterToken}` },
    payload: {
      title: 'Warehouse sorting',
      description: 'Sort incoming cartons',
      checklist: ['Scan barcodes', 'Stack by zone'],
      hourly_rate_paise: hourlyRatePaise,
      hours,
      lat: 12.9141,
      lng: 74.856,
      radius_m: 100,
      start_at: new Date(Date.now() + 3600 * 1000).toISOString()
    }
  });
  const jobId = jobRes.json().id as string;

  await instance.inject({
    method: 'POST',
    url: `/v1/jobs/${jobId}/fund`,
    headers: {
      authorization: `Bearer ${posterToken}`,
      'idempotency-key': `fund-${crypto.randomUUID()}`
    }
  });

  const appRes = await instance.inject({
    method: 'POST',
    url: `/v1/jobs/${jobId}/apply`,
    headers: { authorization: `Bearer ${workerToken}` }
  });
  const appId = appRes.json().id as string;

  await instance.inject({
    method: 'POST',
    url: `/v1/jobs/${jobId}/applications/${appId}/accept`,
    headers: {
      authorization: `Bearer ${posterToken}`,
      'idempotency-key': `accept-${crypto.randomUUID()}`
    }
  });

  return jobId;
}

beforeAll(async () => {
  config = loadConfig({
    databaseUrl: testDbUrl,
    jwtSecret: 'test_jwt_secret_at_least_32_characters_long_0001',
    otpPepper: 'test_otp_pepper_at_least_16_chars',
    idHashSalt: 'test_id_hash_salt_at_least_16_chars',
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

describe('Phase 2 Step 1: QR + GPS check-in, time card, checkout, and escrow settlement', () => {
  it('blocks tampered QR and out-of-geofence GPS, then checks in within radius', async () => {
    const poster = await createVerifiedUser(app, '+919444444401', 'Poster Geo', 'ABCDE7001A');
    const worker = await createVerifiedUser(app, '+919444444402', 'Worker Geo', 'ABCDE7002B');
    const jobId = await setupFilledJob(app, poster.token, worker.token);

    const qrRes = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${jobId}/checkin-qr`,
      headers: { authorization: `Bearer ${poster.token}` }
    });
    expect(qrRes.statusCode).toBe(200);
    const { qr_payload } = qrRes.json();

    // 1. Tampered QR signature -> 400
    const badQr = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/checkin`,
      headers: { authorization: `Bearer ${worker.token}` },
      payload: {
        qr_payload: qr_payload.replace(/"sig":"[0-9a-f]+"/, '"sig":"00000000000000000000000000000000"'),
        lat: 12.9141,
        lng: 74.856
      }
    });
    expect(badQr.statusCode).toBe(400);
    expect(badQr.json().error).toBe('INVALID_CHECKIN_QR');

    // 2. Far GPS coordinates (~2.5 km away) -> 400 OUTSIDE_GEOFENCE
    const farGps = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/checkin`,
      headers: { authorization: `Bearer ${worker.token}` },
      payload: { qr_payload, lat: 12.936, lng: 74.856 }
    });
    expect(farGps.statusCode).toBe(400);
    expect(farGps.json().error).toBe('OUTSIDE_GEOFENCE');

    // 3. Valid GPS within 100m radius -> 200 IN_PROGRESS
    const okCheckin = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/checkin`,
      headers: { authorization: `Bearer ${worker.token}` },
      payload: { qr_payload, lat: 12.9143, lng: 74.8561 }
    });
    expect(okCheckin.statusCode).toBe(200);
    expect(okCheckin.json().status).toBe('IN_PROGRESS');
  });

  it('settles partial-hour shift accurately (95% worker, 5% fee, unused escrow refunded) with zero-sum ledger', async () => {
    const poster = await createVerifiedUser(app, '+919444444403', 'Poster Settle', 'ABCDE7003C');
    const worker = await createVerifiedUser(app, '+919444444404', 'Worker Settle', 'ABCDE7004D');
    // Rs 300/hr * 2h = Rs 600 (60000 paise) held in escrow; poster wallet has Rs 400 (40000 paise) left
    const jobId = await setupFilledJob(app, poster.token, worker.token, 30000, 2);

    const { qr_payload } = (
      await app.inject({
        method: 'GET',
        url: `/v1/jobs/${jobId}/checkin-qr`,
        headers: { authorization: `Bearer ${poster.token}` }
      })
    ).json();

    await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/checkin`,
      headers: { authorization: `Bearer ${worker.token}` },
      payload: { qr_payload, lat: 12.9141, lng: 74.856 }
    });

    // Update checklist
    const clRes = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/checklist`,
      headers: { authorization: `Bearer ${worker.token}` },
      payload: { completed_items: ['Scan barcodes', 'Not in list'] }
    });
    expect(clRes.statusCode).toBe(200);
    expect(clRes.json().completed_checklist).toEqual(['Scan barcodes']);

    // Simulate 60 minutes worked out of 120 scheduled minutes -> gross Rs 300 (30000 paise)
    // Worker 95% = 28500 paise, Platform fee 5% = 1500 paise, Poster refund = 30000 paise
    await pool.query(
      `UPDATE job_shifts SET checked_in_at = now() - INTERVAL '60 minutes' WHERE job_id = $1`,
      [jobId]
    );

    const checkoutRes = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/checkout`,
      headers: { authorization: `Bearer ${worker.token}` }
    });
    expect(checkoutRes.statusCode).toBe(200);
    expect(checkoutRes.json()).toMatchObject({
      status: 'AWAITING_APPROVAL',
      payable_minutes: 60,
      gross_earned_paise: 30000,
      worker_payout_paise: 28500,
      platform_fee_paise: 1500,
      poster_refund_paise: 30000
    });

    // Concurrency: 10 simultaneous approve calls with distinct idempotency keys -> exactly 1 succeeds
    const approvals = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({
          method: 'POST',
          url: `/v1/jobs/${jobId}/approve`,
          headers: {
            authorization: `Bearer ${poster.token}`,
            'idempotency-key': `approve-${crypto.randomUUID()}`
          }
        })
      )
    );
    expect(approvals.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(approvals.filter((r) => r.statusCode === 409)).toHaveLength(9);

    // Verify balances after API restart
    const restarted = await buildApp({ config, logger: false });
    await restarted.ready();

    const workerLedger = (
      await restarted.inject({
        method: 'GET',
        url: '/v1/wallet/ledger',
        headers: { authorization: `Bearer ${worker.token}` }
      })
    ).json();
    expect(workerLedger.wallet_balance_paise).toBe(28500);

    const posterLedger = (
      await restarted.inject({
        method: 'GET',
        url: '/v1/wallet/ledger',
        headers: { authorization: `Bearer ${poster.token}` }
      })
    ).json();
    // 40000 remaining + 30000 unused escrow refund = 70000 paise
    expect(posterLedger.wallet_balance_paise).toBe(70000);

    const sumRes = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount_paise), 0)::bigint AS total FROM ledger_entries`
    );
    expect(Number(sumRes.rows[0].total)).toBe(0);

    await restarted.close();
  });
});
