import type { Pool, PoolClient } from 'pg';
import { getMessaging } from 'firebase-admin/messaging';
import { getFirebaseApp } from './firebase.js';

export function deriveTrustLevel(trustScore: number): number {
  if (trustScore <= 20) return 1;
  if (trustScore <= 40) return 2;
  if (trustScore <= 60) return 3;
  if (trustScore <= 80) return 4;
  return 5;
}

export interface NotifyParams {
  userId: string;
  type: string;
  title: string;
  body: string;
  jobId?: string | null;
  payload?: Record<string, unknown>;
}

export async function insertNotification(
  db: Pool | PoolClient,
  params: NotifyParams
): Promise<void> {
  const payloadObj = {
    ...(params.payload ?? {}),
    title: params.title,
    body: params.body,
    ...(params.jobId ? { job_id: params.jobId } : {})
  };

  await db.query(
    `INSERT INTO notifications (user_id, type, title, body, job_id, payload, is_read)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, false)`,
    [
      params.userId,
      params.type,
      params.title,
      params.body,
      params.jobId ?? null,
      JSON.stringify(payloadObj)
    ]
  );
}

export async function sendPushIfConfigured(
  pool: Pool,
  params: NotifyParams
): Promise<void> {
  try {
    const app = getFirebaseApp();
    if (!app) return;

    const res = await pool.query<{ fcm_token: string | null }>(
      `SELECT fcm_token FROM users WHERE id = $1`,
      [params.userId]
    );
    const token = res.rows[0]?.fcm_token;
    if (!token) return;

    await getMessaging(app).send({
      token,
      notification: {
        title: params.title,
        body: params.body
      },
      data: {
        type: params.type,
        job_id: params.jobId ?? ''
      }
    });
  } catch (err) {
    console.warn('[fcm] Push send skipped/failed:', (err as Error).message);
  }
}

export async function notifyUser(
  pool: Pool,
  params: NotifyParams
): Promise<void> {
  try {
    await insertNotification(pool, params);
    await sendPushIfConfigured(pool, params);
  } catch (err) {
    console.warn('[notify] Notification failed:', (err as Error).message);
  }
}
