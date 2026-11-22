-- Core enums
CREATE TYPE user_role AS ENUM ('worker', 'poster', 'both', 'admin');
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'banned');

CREATE TYPE job_status AS ENUM (
  'DRAFT',
  'OPEN',
  'FILLED',
  'IN_PROGRESS',
  'AWAITING_APPROVAL',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
  'DISPUTED'
);

CREATE TYPE application_status AS ENUM (
  'pending',
  'accepted',
  'rejected',
  'expired',
  'withdrawn'
);

CREATE TYPE checkin_kind AS ENUM ('start', 'end');
CREATE TYPE dispute_status AS ENUM ('open', 'resolved');

-- 1. users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  role user_role NOT NULL DEFAULT 'both',
  verified_name TEXT,
  dob DATE,
  age_verified_at TIMESTAMPTZ,
  id_type TEXT CHECK (id_type IN ('pan', 'driving_licence', 'college_id')),
  id_last4 TEXT CHECK (id_last4 IS NULL OR length(id_last4) = 4),
  id_hash TEXT UNIQUE,
  trust_level SMALLINT NOT NULL DEFAULT 0 CHECK (trust_level >= 0),
  responsiveness_score SMALLINT NOT NULL DEFAULT 100 CHECK (responsiveness_score BETWEEN 0 AND 100),
  status user_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. wallets (cached balance maintained exclusively via ledger_entries trigger)
CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  balance_paise BIGINT NOT NULL DEFAULT 0 CHECK (balance_paise >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. jobs
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poster_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  hourly_rate_paise BIGINT NOT NULL CHECK (hourly_rate_paise > 0),
  hours INTEGER NOT NULL CHECK (hours > 0),
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  radius_m INTEGER NOT NULL DEFAULT 100 CHECK (radius_m > 0),
  address_text TEXT NOT NULL DEFAULT '',
  start_at TIMESTAMPTZ NOT NULL,
  status job_status NOT NULL DEFAULT 'DRAFT',
  hours_released INTEGER NOT NULL DEFAULT 0 CHECK (hours_released >= 0),
  end_qr_scanned_at TIMESTAMPTZ,
  auto_release_at TIMESTAMPTZ,
  report_count INTEGER NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_jobs_hours_released_le_hours CHECK (hours_released <= hours)
);

CREATE INDEX idx_jobs_status_geo ON jobs (status, lat, lng) WHERE is_hidden = false;
CREATE INDEX idx_jobs_status_start_at ON jobs (status, start_at);
CREATE INDEX idx_jobs_auto_release ON jobs (status, auto_release_at) WHERE status = 'AWAITING_APPROVAL';

-- 4. ledger_entries (insert-only double-entry ledger; integer paise)
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_id UUID NOT NULL,
  account TEXT NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise <> 0),
  reason TEXT NOT NULL,
  job_id UUID REFERENCES jobs(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_ledger_account_format CHECK (
    account IN ('platform_fee', 'external_funding', 'penalty_pool')
    OR account ~ '^wallet:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR account ~ '^escrow:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  CONSTRAINT chk_ledger_escrow_matches_job CHECK (
    (account NOT LIKE 'escrow:%')
    OR (job_id IS NOT NULL AND account = 'escrow:' || job_id::text)
  )
);

CREATE INDEX idx_ledger_txn_id ON ledger_entries (txn_id);
CREATE INDEX idx_ledger_account_created ON ledger_entries (account, created_at);
CREATE INDEX idx_ledger_job_id ON ledger_entries (job_id) WHERE job_id IS NOT NULL;

-- 5. applications
CREATE TABLE applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  worker_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status application_status NOT NULL DEFAULT 'pending',
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  respond_by TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  CONSTRAINT uq_applications_job_worker UNIQUE (job_id, worker_id),
  CONSTRAINT chk_applications_respond_after_applied CHECK (respond_by > applied_at)
);

CREATE INDEX idx_applications_status_respond_by ON applications (status, respond_by);

-- 6. checkins
CREATE TABLE checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  worker_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind checkin_kind NOT NULL,
  server_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m DOUBLE PRECISION NOT NULL CHECK (accuracy_m >= 0 AND accuracy_m < 50),
  qr_nonce TEXT NOT NULL UNIQUE,
  device_id TEXT NOT NULL,
  CONSTRAINT uq_checkins_job_kind UNIQUE (job_id, kind)
);

-- 7. disputes
CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  opened_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  status dispute_status NOT NULL DEFAULT 'open',
  worker_split_pct SMALLINT CHECK (worker_split_pct BETWEEN 0 AND 100),
  decided_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ,
  agree_by TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '48 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_disputes_resolution_fields CHECK (
    (status = 'open' AND worker_split_pct IS NULL AND decided_by IS NULL AND decided_at IS NULL)
    OR (status = 'resolved' AND worker_split_pct IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_disputes_one_open_per_job ON disputes (job_id) WHERE status = 'open';

-- 8. dispute_evidence
CREATE TABLE dispute_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('statement', 'photo_ref', 'checkin_log', 'chat_excerpt')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. ratings
CREATE TABLE ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  rater_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  ratee_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  stars SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ratings_job_rater UNIQUE (job_id, rater_id),
  CONSTRAINT chk_ratings_no_self_rate CHECK (rater_id <> ratee_id)
);

-- 10. messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  has_warning BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_job_created ON messages (job_id, created_at);

-- 11. notifications (backs in-app inbox)
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_unread ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

-- 12. idempotency_keys
CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  endpoint TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 13. audit_log (insert-only)
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  entity TEXT NOT NULL,
  entity_id UUID NOT NULL,
  old_state JSONB,
  new_state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_entity ON audit_log (entity, entity_id, created_at);
