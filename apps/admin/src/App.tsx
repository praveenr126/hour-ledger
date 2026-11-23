import React, { useEffect, useState } from 'react';
import {
  fetchOverview,
  formatPaise,
  moderateJob,
  resolveDispute,
  setUserStatus,
  type AdminOverview
} from './api';

const DEFAULT_ADMIN_KEY = 'dev_only_admin_key_change_me_123456';

export function App() {
  const [adminKey, setAdminKey] = useState(DEFAULT_ADMIN_KEY);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [splits, setSplits] = useState<
    Record<string, { worker: string; fee: string; refund: string; note: string }>
  >({});

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await fetchOverview(adminKey);
      setOverview(data);
      setSplits((prev) => {
        const next = { ...prev };
        for (const d of data.disputes) {
          if (!next[d.job_id]) {
            const half = Math.floor(d.escrow_held_paise / 2);
            const fee = Math.floor(half * 0.05);
            next[d.job_id] = {
              worker: String(half - fee),
              fee: String(fee),
              refund: String(d.escrow_held_paise - half),
              note: 'Verified partial shift; 50/50 split with 5% fee'
            };
          }
        }
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResolve = async (jobId: string) => {
    const s = splits[jobId];
    if (!s) return;
    setBusy(true);
    setError(null);
    try {
      await resolveDispute(adminKey, jobId, {
        worker_payout_paise: Number(s.worker || 0),
        platform_fee_paise: Number(s.fee || 0),
        poster_refund_paise: Number(s.refund || 0),
        resolution_note: s.note
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1>HourLedger Admin &amp; Escrow Console</h1>
          <div>Double-entry ledger audit, dispute resolution, and moderation</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div>
            <label htmlFor="admin-key-input">Admin API key</label>
            <input id="admin-key-input" className="mono" type="password" value={adminKey} onChange={(e) => setAdminKey(e.target.value)} />
          </div>
          <button onClick={load} disabled={busy}>Refresh</button>
        </div>
      </header>

      {error && <div className="banner-danger">{error}</div>}

      {overview && (
        <>
          <div className={overview.ledger_invariant.is_zero_sum ? 'banner-held' : 'banner-danger'}>
            <strong>
              {overview.ledger_invariant.is_zero_sum
                ? 'Ledger invariant verified: global double-entry sum is Rs 0.00'
                : 'Ledger invariant alert: non-zero sum detected'}
            </strong>
            <div className="mono" style={{ marginTop: 4 }}>
              SUM(amount_paise) = {overview.ledger_invariant.sum_paise} · Total entries: {overview.ledger_invariant.total_entries}
            </div>
          </div>

          <h2 className="section-title">Disputes &amp; Frozen Escrow</h2>
          {overview.disputes.length === 0 ? (
            <div className="card">No disputes raised.</div>
          ) : (
            overview.disputes.map((d) => {
              const s = splits[d.job_id] ?? { worker: '0', fee: '0', refund: '0', note: '' };
              const sumPaise = Number(s.worker || 0) + Number(s.fee || 0) + Number(s.refund || 0);
              const matchesHeld = sumPaise === d.escrow_held_paise;
              return (
                <div className="card" key={d.job_id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <span className={`pill ${d.status === 'open' ? 'pill-danger' : 'pill-held'}`}>{d.status.toUpperCase()}</span>
                      <strong style={{ marginLeft: 8 }}>{d.job_title}</strong>
                    </div>
                    <div className="mono">Held escrow: <strong>{formatPaise(d.escrow_held_paise)}</strong> ({d.escrow_held_paise} paise)</div>
                  </div>
                  <p style={{ margin: '10px 0 6px' }}><strong>Reason:</strong> {d.reason}</p>
                  {d.evidence_note && <p style={{ margin: '0 0 8px' }}><strong>Evidence:</strong> {d.evidence_note}</p>}
                  <div className="mono" style={{ fontSize: 13 }}>Poster: {d.poster_name} · Worker: {d.worker_name}</div>
                  {d.status === 'open' ? (
                    <div style={{ marginTop: 16 }}>
                      <div className="grid-3">
                        <div>
                          <label>Worker payout (paise)</label>
                          <input className="mono" type="number" value={s.worker} onChange={(e) => setSplits({ ...splits, [d.job_id]: { ...s, worker: e.target.value } })} />
                        </div>
                        <div>
                          <label>Platform fee (paise)</label>
                          <input className="mono" type="number" value={s.fee} onChange={(e) => setSplits({ ...splits, [d.job_id]: { ...s, fee: e.target.value } })} />
                        </div>
                        <div>
                          <label>Poster refund (paise)</label>
                          <input className="mono" type="number" value={s.refund} onChange={(e) => setSplits({ ...splits, [d.job_id]: { ...s, refund: e.target.value } })} />
                        </div>
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <label>Resolution note</label>
                        <input value={s.note} onChange={(e) => setSplits({ ...splits, [d.job_id]: { ...s, note: e.target.value } })} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                        <span className="mono">Split sum: {sumPaise} / {d.escrow_held_paise} paise</span>
                        <button className="primary" disabled={busy || !matchesHeld || s.note.trim().length < 3} onClick={() => handleResolve(d.job_id)}>
                          Settle escrow and close dispute
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mono" style={{ marginTop: 12, fontSize: 13 }}>
                      Settled: Worker {formatPaise(d.worker_payout_paise ?? 0)} · Fee {formatPaise(d.platform_fee_paise ?? 0)} · Refund {formatPaise(d.poster_refund_paise ?? 0)} ({d.resolution_note})
                    </div>
                  )}
                </div>
              );
            })
          )}

          <h2 className="section-title">Jobs Moderation</h2>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Title</th><th>Poster</th><th>Status</th><th>Escrow</th><th>Visibility</th><th>Action</th></tr></thead>
              <tbody>
                {overview.jobs.map((j) => (
                  <tr key={j.id}>
                    <td>{j.title}</td>
                    <td>{j.poster_name}</td>
                    <td className="mono">{j.status}</td>
                    <td className="mono">{formatPaise(j.escrow_held_paise)}</td>
                    <td><span className={`pill ${j.is_hidden ? 'pill-caution' : 'pill-held'}`}>{j.is_hidden ? 'HIDDEN' : 'VISIBLE'}</span></td>
                    <td>
                      <button disabled={busy} onClick={async () => { setBusy(true); try { await moderateJob(adminKey, j.id, !j.is_hidden); await load(); } catch (e) { setError((e as Error).message); setBusy(false); } }}>
                        {j.is_hidden ? 'Unhide' : 'Hide'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="section-title">Verified Users &amp; Wallets</h2>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Name</th><th>Phone</th><th>18+ ID</th><th>Trust</th><th>Wallet</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {overview.users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.verified_name ?? 'Unverified'}</td>
                    <td className="mono">{u.phone}</td>
                    <td>{u.age_verified ? 'Verified' : 'Pending'}</td>
                    <td className="mono">L{u.trust_level} ({u.responsiveness_score}%)</td>
                    <td className="mono">{formatPaise(u.wallet_balance_paise)}</td>
                    <td><span className={`pill ${u.status === 'active' ? 'pill-held' : 'pill-danger'}`}>{u.status.toUpperCase()}</span></td>
                    <td>
                      <button disabled={busy} onClick={async () => { setBusy(true); try { await setUserStatus(adminKey, u.id, u.status === 'active' ? 'suspended' : 'active'); await load(); } catch (e) { setError((e as Error).message); setBusy(false); } }}>
                        {u.status === 'active' ? 'Suspend' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
