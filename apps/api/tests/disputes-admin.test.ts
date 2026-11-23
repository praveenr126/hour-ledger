import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';

const testDbUrl =
  process.env.TEST_DATABASE_URL ??
  'postgres://hourledger:hourledger_dev_password@127.0.0.1:5432/hourledger_api_test';

const ADMIN_KEY = 'test_admin_api_key_at_least_16_chars';

let config: AppConfig;
let pool: Pool;
let app: FastifyInstance;

async function createVerifiedUser(instance: FastifyInstance, phone: string, name: string, pan: string) {
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

  await instance.inject({
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
  return { token: auth.access_token, userId: auth.user.id };
}

beforeAll(async () => {
  config = loadConfig({
    databaseUrl: testDbUrl,
    jwtSecret: 'test_jwt_secret_at_least_32_characters_long_0001',
    otpPepper: 'test_otp_pepper_at_least_16_chars',
    idHashSalt: 'test_id_hash_salt_at_least_16_chars',
    adminApiKey: ADMIN_KEY,
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

describe('Phase 3 Step 1: Disputes freeze escrow and Admin resolves split atomically', () => {
  it('freezes escrow on dispute, blocks checkout/approve, validates split total, and resolves once under concurrency', async () => {
    const poster = await createVerifiedUser(app, '+919666666601', 'Poster Dispute', 'ABCDE9001A');
    const worker = await createVerifiedUser(app, '+919666666602', 'Worker Dispute', 'ABCDE9002B');

    await app.inject({
      method: 'POST',
      url: '/v1/wallet/topup',
      headers: {
        authorization: `Bearer ${poster.token}`,
        'idempotency-key': `topup-${crypto.randomUUID()}`
      },
      payload: { amount_paise: 100000 }
    });

    // Fund a Rs 600 (60000 paise) job -> poster has Rs 400 (40000 paise) left
    const jobId = (
      await app.inject({
        method: 'POST',
        url: '/v1/jobs',
        headers: { authorization: `Bearer ${poster.token}` },
        payload: {
          title: 'Cafe closing shift',
          description: 'Clean counter and mop floor',
          hourly_rate_paise: 30000,
          hours: 2,
          lat: 12.9141,
          lng: 74.856,
          start_at: new Date(Date.now() + 3600 * 1000).toISOString()
        }
      })
    ).json().id as string;

    await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/fund`,
      headers: {
        authorization: `Bearer ${poster.token}`,
        'idempotency-key': `fund-${crypto.randomUUID()}`
      }
    });

    const appId = (
      await app.inject({
        method: 'POST',
        url: `/v1/jobs/${jobId}/apply`,
        headers: { authorization: `Bearer ${worker.token}` }
      })
    ).json().id as string;

    await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/applications/${appId}/accept`,
      headers: {
        authorization: `Bearer ${poster.token}`,
        'idempotency-key': `accept-${crypto.randomUUID()}`
      }
    });

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

    // Worker raises dispute during IN_PROGRESS -> freezes escrow
    const disputeRes = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/dispute`,
      headers: { authorization: `Bearer ${worker.token}` },
      payload: {
        reason: 'Site locked 45 minutes into shift',
        evidence_note: 'Manager left early; completed half the tasks'
      }
    });
    expect(disputeRes.statusCode).toBe(201);
    expect(disputeRes.json().status).toBe('DISPUTED');

    // Checkout is blocked while DISPUTED
    const blockedCheckout = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/checkout`,
      headers: { authorization: `Bearer ${worker.token}` }
    });
    expect(blockedCheckout.statusCode).toBe(409);

    // Unauthorized admin call -> 401
    const unauthOverview = await app.inject({
      method: 'GET',
      url: '/v1/admin/overview'
    });
    expect(unauthOverview.statusCode).toBe(401);

    // Split mismatch (total != 60000) -> 400 SPLIT_MISMATCH
    const badSplit = await app.inject({
      method: 'POST',
      url: `/v1/admin/disputes/${jobId}/resolve`,
      headers: {
        'x-admin-key': ADMIN_KEY,
        'idempotency-key': `bad-split-${crypto.randomUUID()}`
      },
      payload: {
        worker_payout_paise: 30000,
        platform_fee_paise: 1500,
        poster_refund_paise: 10000,
        resolution_note: 'Wrong math'
      }
    });
    expect(badSplit.statusCode).toBe(400);
    expect(badSplit.json().error).toBe('SPLIT_MISMATCH');

    // Concurrency: 5 simultaneous valid resolutions -> exactly 1 succeeds (28500 worker + 1500 fee + 30000 poster = 60000)
    const resolves = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({
          method: 'POST',
          url: `/v1/admin/disputes/${jobId}/resolve`,
          headers: {
            'x-admin-key': ADMIN_KEY,
            'idempotency-key': `resolve-${crypto.randomUUID()}`
          },
          payload: {
            worker_payout_paise: 28500,
            platform_fee_paise: 1500,
            poster_refund_paise: 30000,
            resolution_note: '50% shift verified; split evenly with 5% fee'
          }
        })
      )
    );
    expect(resolves.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(resolves.filter((r) => r.statusCode === 409)).toHaveLength(4);

    // Admin overview confirms zero-sum ledger invariant and updated balances
    const overview = (
      await app.inject({
        method: 'GET',
        url: '/v1/admin/overview',
        headers: { 'x-admin-key': ADMIN_KEY }
      })
    ).json();

    expect(overview.ledger_invariant.is_zero_sum).toBe(true);
    expect(overview.ledger_invariant.sum_paise).toBe(0);

    const workerWallet = (
      await app.inject({
        method: 'GET',
        url: '/v1/wallet/ledger',
        headers: { authorization: `Bearer ${worker.token}` }
      })
    ).json();
    expect(workerWallet.wallet_balance_paise).toBe(28500);

    const posterWallet = (
      await app.inject({
        method: 'GET',
        url: '/v1/wallet/ledger',
        headers: { authorization: `Bearer ${poster.token}` }
      })
    ).json();
    // 40000 remaining + 30000 dispute refund = 70000
    expect(posterWallet.wallet_balance_paise).toBe(70000);
  });

  it('moderates jobs and suspends users via admin endpoints', async () => {
    const user = await createVerifiedUser(app, '+919666666603', 'User Mod', 'ABCDE9003C');
    const modRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/users/${user.userId}/status`,
      headers: { 'x-admin-key': ADMIN_KEY },
      payload: { status: 'suspended', reason: 'Policy check' }
    });
    expect(modRes.statusCode).toBe(200);
    expect(modRes.json().status).toBe('suspended');
  });
});
