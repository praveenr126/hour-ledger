import crypto from 'node:crypto';
import type { Pool } from 'pg';
import { withTransaction } from '../../db.js';

export interface ExpirySweepStats {
  expiredApplications: number;
  expiredJobs: number;
}

/**
 * Concurrency-safe background sweep using FOR UPDATE SKIP LOCKED.
 * Multiple API processes can run this concurrently without double-refunding.
 */
export async function runExpirySweep(pool: Pool): Promise<ExpirySweepStats> {
  let expiredApplications = 0;
  let expiredJobs = 0;

  // 1. Expire overdue pending applications and penalize poster responsiveness
  await withTransaction(pool, async (client) => {
    const overdueApps = await client.query<{
      id: string;
      job_id: string;
      worker_id: string;
      poster_id: string;
    }>(
      `SELECT a.id, a.job_id, a.worker_id, j.poster_id
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
        WHERE a.status = 'pending'
          AND a.respond_by <= now()
          FOR UPDATE OF a SKIP LOCKED`
    );

    for (const app of overdueApps.rows) {
      await client.query(
        `UPDATE applications
            SET status = 'expired',
                responded_at = now()
          WHERE id = $1`,
        [app.id]
      );

      await client.query(
        `UPDATE users
            SET responsiveness_score = GREATEST(0, responsiveness_score - 5),
                updated_at = now()
          WHERE id = $1`,
        [app.poster_id]
      );

      await client.query(
        `INSERT INTO notifications (user_id, type, payload)
         VALUES ($1, 'application_expired', $2::jsonb)`,
        [app.worker_id, JSON.stringify({ job_id: app.job_id, application_id: app.id })]
      );

      await client.query(
        `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
         VALUES (NULL, 'application', $1, $2::jsonb, $3::jsonb)`,
        [
          app.id,
          JSON.stringify({ status: 'pending' }),
          JSON.stringify({ status: 'expired', reason: 'respond_by_passed' })
        ]
      );

      expiredApplications++;
    }
  });

  // 2. Expire unstaffed OPEN jobs past start_at and refund held escrow to poster
  await withTransaction(pool, async (client) => {
    const overdueJobs = await client.query<{
      id: string;
      poster_id: string;
    }>(
      `SELECT id, poster_id
         FROM jobs
        WHERE status = 'OPEN'
          AND start_at <= now()
          FOR UPDATE SKIP LOCKED`
    );

    for (const job of overdueJobs.rows) {
      const escrowAccount = `escrow:${job.id}`;
      const heldRes = await client.query<{ held: string }>(
        `SELECT COALESCE(SUM(amount_paise), 0)::bigint AS held
           FROM ledger_entries
          WHERE account = $1`,
        [escrowAccount]
      );
      const heldPaise = Number(heldRes.rows[0].held);

      let refundTxnId: string | null = null;
      if (heldPaise > 0) {
        refundTxnId = crypto.randomUUID();
        await client.query(
          `INSERT INTO ledger_entries (txn_id, account, amount_paise, reason, job_id)
           VALUES
             ($1, $2, $3, 'job_expired_refund', $4),
             ($1, $5, $6, 'job_expired_refund', $4)`,
          [
            refundTxnId,
            escrowAccount,
            -heldPaise,
            job.id,
            `wallet:${job.poster_id}`,
            heldPaise
          ]
        );
      }

      await client.query(
        `UPDATE jobs
            SET status = 'EXPIRED',
                version = version + 1,
                updated_at = now()
          WHERE id = $1`,
        [job.id]
      );

      await client.query(
        `UPDATE applications
            SET status = 'expired',
                responded_at = now()
          WHERE job_id = $1 AND status = 'pending'`,
        [job.id]
      );

      await client.query(
        `INSERT INTO notifications (user_id, type, payload)
         VALUES ($1, 'job_expired_refunded', $2::jsonb)`,
        [
          job.poster_id,
          JSON.stringify({
            job_id: job.id,
            refunded_paise: heldPaise,
            txn_id: refundTxnId
          })
        ]
      );

      await client.query(
        `INSERT INTO audit_log (actor_id, entity, entity_id, old_state, new_state)
         VALUES (NULL, 'job', $1, $2::jsonb, $3::jsonb)`,
        [
          job.id,
          JSON.stringify({ status: 'OPEN' }),
          JSON.stringify({
            status: 'EXPIRED',
            refunded_paise: heldPaise,
            txn_id: refundTxnId
          })
        ]
      );

      expiredJobs++;
    }
  });

  return { expiredApplications, expiredJobs };
}
