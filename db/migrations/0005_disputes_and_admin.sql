INSERT INTO users (id, phone, role, status, verified_name)
VALUES ('00000000-0000-0000-0000-000000000001', '+910000000000', 'both', 'active', 'HourLedger Admin')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE job_disputes (
  job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE RESTRICT,
  raised_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  evidence_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution_note TEXT,
  worker_payout_paise BIGINT CHECK (worker_payout_paise IS NULL OR worker_payout_paise >= 0),
  platform_fee_paise BIGINT CHECK (platform_fee_paise IS NULL OR platform_fee_paise >= 0),
  poster_refund_paise BIGINT CHECK (poster_refund_paise IS NULL OR poster_refund_paise >= 0),
  settlement_txn_id UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
