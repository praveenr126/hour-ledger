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

describe('Phase 2 Step 2: Mutual ratings on COMPLETED jobs', () => {
  it('blocks rating before COMPLETED, allows mutual ratings after COMPLETED, and rejects duplicates', async () => {
    const poster = await createVerifiedUser(app, '+919555555501', 'Poster Rate', 'ABCDE8001A');
    const worker = await createVerifiedUser(app, '+919555555502', 'Worker Rate', 'ABCDE8002B');

    await app.inject({
      method: 'POST',
      url: '/v1/wallet/topup',
      headers: {
        authorization: `Bearer ${poster.token}`,
        'idempotency-key': `topup-${crypto.randomUUID()}`
      },
      payload: { amount_paise: 100000 }
    });

    const jobId = (
      await app.inject({
        method: 'POST',
        url: '/v1/jobs',
        headers: { authorization: `Bearer ${poster.token}` },
        payload: {
          title: 'Setup booth',
          description: 'Arrange banner and table',
          hourly_rate_paise: 20000,
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

    // Rating while FILLED -> 409
    const earlyRate = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/rate`,
      headers: { authorization: `Bearer ${poster.token}` },
      payload: { stars: 5, comment: 'Great' }
    });
    expect(earlyRate.statusCode).toBe(409);

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

    await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/checkout`,
      headers: { authorization: `Bearer ${worker.token}` }
    });

    await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/approve`,
      headers: {
        authorization: `Bearer ${poster.token}`,
        'idempotency-key': `approve-${crypto.randomUUID()}`
      }
    });

    // Poster rates worker -> 201
    const rPoster = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/rate`,
      headers: { authorization: `Bearer ${poster.token}` },
      payload: { stars: 5, comment: 'Punctual and thorough' }
    });
    expect(rPoster.statusCode).toBe(201);

    // Duplicate rating -> 409
    const rDup = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/rate`,
      headers: { authorization: `Bearer ${poster.token}` },
      payload: { stars: 4 }
    });
    expect(rDup.statusCode).toBe(409);

    // Worker rates poster -> 201
    const rWorker = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/rate`,
      headers: { authorization: `Bearer ${worker.token}` },
      payload: { stars: 5, comment: 'Clear instructions and instant approval' }
    });
    expect(rWorker.statusCode).toBe(201);
  });
});
