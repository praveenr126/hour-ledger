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

async function loginUser(instance: FastifyInstance, phone: string) {
  const reqRes = await instance.inject({
    method: 'POST',
    url: '/v1/auth/otp/request',
    payload: { phone }
  });
  const { dev_otp } = reqRes.json();
  const verifyRes = await instance.inject({
    method: 'POST',
    url: '/v1/auth/otp/verify',
    payload: { phone, code: dev_otp }
  });
  return verifyRes.json() as { access_token: string; user: { id: string } };
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

describe('Phase 0 Step 3: 18+ age & ID verification', () => {
  it('blocks minors (< 18), malformed PAN, and failed liveness', async () => {
    const { access_token } = await loginUser(app, '+919222222201');
    const headers = { authorization: `Bearer ${access_token}` };

    const underage = await app.inject({
      method: 'POST',
      url: '/v1/profile/verify',
      headers,
      payload: {
        verified_name: 'Minor User',
        dob: '2012-05-01',
        id_type: 'pan',
        id_number: 'ABCDE1234F',
        liveness_passed: true,
        liveness_prompt: 'blink'
      }
    });
    expect(underage.statusCode).toBe(400);
    expect(underage.json().error).toBe('UNDERAGE');

    const badPan = await app.inject({
      method: 'POST',
      url: '/v1/profile/verify',
      headers,
      payload: {
        verified_name: 'Adult User',
        dob: '2000-05-01',
        id_type: 'pan',
        id_number: 'NOTAPAN123',
        liveness_passed: true,
        liveness_prompt: 'blink'
      }
    });
    expect(badPan.statusCode).toBe(400);
    expect(badPan.json().error).toBe('INVALID_ID_FORMAT');

    const noLiveness = await app.inject({
      method: 'POST',
      url: '/v1/profile/verify',
      headers,
      payload: {
        verified_name: 'Adult User',
        dob: '2000-05-01',
        id_type: 'pan',
        id_number: 'ABCDE1234F',
        liveness_passed: false,
        liveness_prompt: 'head_turn'
      }
    });
    expect(noLiveness.statusCode).toBe(400);
    expect(noLiveness.json().error).toBe('LIVENESS_REQUIRED');
  });

  it('verifies adult user, stores only salted hash + last4, and never stores raw ID', async () => {
    const rawPan = 'PQRSX9876K';
    const { access_token, user } = await loginUser(app, '+919222222202');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/profile/verify',
      headers: { authorization: `Bearer ${access_token}` },
      payload: {
        verified_name: 'Asha Rao',
        dob: '2001-08-15',
        id_type: 'pan',
        id_number: 'pqrsx 9876 k',
        liveness_passed: true,
        liveness_prompt: 'blink'
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      verified_name: 'Asha Rao',
      age_verified: true,
      id_type: 'pan',
      id_last4: '876K',
      face_match: 'mock_passed'
    });

    // Confirm raw PAN does not appear in users or audit_log
    const userRow = await pool.query(`SELECT id_hash, id_last4 FROM users WHERE id = $1`, [user.id]);
    expect(userRow.rows[0].id_last4).toBe('876K');
    expect(userRow.rows[0].id_hash).toHaveLength(64);
    expect(userRow.rows[0].id_hash).not.toContain(rawPan);

    const leakedAudit = await pool.query(
      `SELECT count(*) FROM audit_log WHERE entity_id = $1 AND new_state::text ILIKE $2`,
      [user.id, `%${rawPan}%`]
    );
    expect(Number(leakedAudit.rows[0].count)).toBe(0);
  });

  it('idempotency & repeat safety: second verify call returns 409 without mutating profile', async () => {
    const { access_token, user } = await loginUser(app, '+919222222203');
    const headers = { authorization: `Bearer ${access_token}` };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/profile/verify',
      headers,
      payload: {
        verified_name: 'Kiran Nair',
        dob: '1999-01-10',
        id_type: 'college_id',
        id_number: 'COL2026001',
        liveness_passed: true,
        liveness_prompt: 'head_turn'
      }
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/profile/verify',
      headers,
      payload: {
        verified_name: 'Different Name',
        dob: '1999-01-10',
        id_type: 'college_id',
        id_number: 'COL2026999',
        liveness_passed: true,
        liveness_prompt: 'blink'
      }
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('ALREADY_VERIFIED');

    const row = await pool.query(`SELECT verified_name, id_last4 FROM users WHERE id = $1`, [user.id]);
    expect(row.rows[0]).toEqual({ verified_name: 'Kiran Nair', id_last4: '6001' });
  });

  it('concurrency: 10 simultaneous verify requests for one user -> exactly 1 succeeds', async () => {
    const { access_token } = await loginUser(app, '+919222222204');
    const headers = { authorization: `Bearer ${access_token}` };

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({
          method: 'POST',
          url: '/v1/profile/verify',
          headers,
          payload: {
            verified_name: 'Same User Race',
            dob: '1998-03-20',
            id_type: 'driving_licence',
            id_number: 'KA192020001234',
            liveness_passed: true,
            liveness_prompt: 'blink'
          }
        })
      )
    );

    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(9);
  });

  it('concurrency: 10 different users submitting the same PAN simultaneously -> exactly 1 succeeds', async () => {
    const users = await Promise.all(
      Array.from({ length: 10 }, (_, idx) => loginUser(app, `+91922222230${idx}`))
    );

    const results = await Promise.all(
      users.map((u, idx) =>
        app.inject({
          method: 'POST',
          url: '/v1/profile/verify',
          headers: { authorization: `Bearer ${u.access_token}` },
          payload: {
            verified_name: `Duplicate Attempt ${idx}`,
            dob: '1997-07-07',
            id_type: 'pan',
            id_number: 'DUPID5555Z',
            liveness_passed: true,
            liveness_prompt: 'head_turn'
          }
        })
      )
    );

    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const conflicts = results.filter((r) => r.statusCode === 409);
    expect(conflicts).toHaveLength(9);
    expect(conflicts.every((r) => r.json().error === 'DUPLICATE_ID')).toBe(true);
  });

  it('restart persistence: verified profile survives a full API server restart', async () => {
    const server1 = await buildApp({ config, logger: false });
    await server1.ready();
    const { access_token } = await loginUser(server1, '+919222222299');

    const verifyRes = await server1.inject({
      method: 'POST',
      url: '/v1/profile/verify',
      headers: { authorization: `Bearer ${access_token}` },
      payload: {
        verified_name: 'Restart Proof',
        dob: '1996-11-11',
        id_type: 'pan',
        id_number: 'RESTR4321M',
        liveness_passed: true,
        liveness_prompt: 'blink'
      }
    });
    expect(verifyRes.statusCode).toBe(200);
    await server1.close();

    const server2 = await buildApp({ config, logger: false });
    await server2.ready();
    const profileRes = await server2.inject({
      method: 'GET',
      url: '/v1/profile',
      headers: { authorization: `Bearer ${access_token}` }
    });
    expect(profileRes.statusCode).toBe(200);
    expect(profileRes.json()).toMatchObject({
      verified_name: 'Restart Proof',
      age_verified: true,
      id_type: 'pan',
      id_last4: '321M'
    });
    await server2.close();
  });
});
