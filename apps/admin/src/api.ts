export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/v1';

export interface AdminOverview {
  ledger_invariant: { sum_paise: number; is_zero_sum: boolean; total_entries: number };
  disputes: Array<{
    job_id: string; job_title: string; poster_id: string; poster_name: string;
    worker_id: string; worker_name: string; reason: string; evidence_note: string;
    status: 'open' | 'resolved'; resolution_note: string | null; escrow_held_paise: number;
    worker_payout_paise: number | null; platform_fee_paise: number | null;
    poster_refund_paise: number | null; created_at: string;
  }>;
  jobs: Array<{
    id: string; title: string; status: string; is_hidden: boolean;
    total_paise: number; escrow_held_paise: number; poster_name: string;
  }>;
  users: Array<{
    id: string; phone: string; verified_name: string | null; status: 'active' | 'suspended';
    age_verified: boolean; trust_level: number; responsiveness_score: number; wallet_balance_paise: number;
  }>;
}

export function formatPaise(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}Rs ${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export async function fetchOverview(adminKey: string): Promise<AdminOverview> {
  const res = await fetch(`${API_BASE_URL}/admin/overview`, { headers: { 'x-admin-key': adminKey } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? 'Failed to load admin overview');
  return data as AdminOverview;
}

export async function resolveDispute(
  adminKey: string,
  jobId: string,
  payload: { worker_payout_paise: number; platform_fee_paise: number; poster_refund_paise: number; resolution_note: string }
): Promise<void> {
  const idemKey = `admin-resolve-${jobId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const res = await fetch(`${API_BASE_URL}/admin/disputes/${jobId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey, 'Idempotency-Key': idemKey },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? 'Failed to resolve dispute');
}

export async function moderateJob(adminKey: string, jobId: string, isHidden: boolean): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/admin/jobs/${jobId}/moderate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
    body: JSON.stringify({ is_hidden: isHidden, reason: 'Admin console moderation' })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? 'Failed to update job visibility');
}

export async function setUserStatus(adminKey: string, userId: string, status: 'active' | 'suspended'): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/admin/users/${userId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
    body: JSON.stringify({ status, reason: 'Admin console action' })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? 'Failed to update user status');
}
