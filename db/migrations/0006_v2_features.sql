-- Additive, idempotent v2 migration for HourLedger

-- 1. Extend application_status enum safely
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'backup';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'cancelled';

-- 2. Extend users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trust_score INTEGER NOT NULL DEFAULT 100;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cancellation_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3,2) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_number TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_18_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fcm_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locality TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_lat DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_lng DOUBLE PRECISION;

-- Backfill is_18_verified from existing age_verified_at
UPDATE users SET is_18_verified = true WHERE age_verified_at IS NOT NULL AND is_18_verified = false;

-- Unique index on (id_type, UPPER(TRIM(id_number))) where id_number IS NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_id_type_number
  ON users (id_type, UPPER(TRIM(id_number)))
  WHERE id_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_firebase_uid
  ON users (firebase_uid)
  WHERE firebase_uid IS NOT NULL;

-- 3. Extend jobs table
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pay_type TEXT NOT NULL DEFAULT 'HOURLY';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS duration INTEGER NOT NULL DEFAULT 1;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS headcount_needed INTEGER NOT NULL DEFAULT 1;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hired_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_urgent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS locality TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS rate_paise BIGINT;

-- Backfill v2 job columns from existing rows
UPDATE jobs
   SET duration = COALESCE(NULLIF(duration, 1), hours),
       scheduled_at = COALESCE(scheduled_at, start_at),
       locality = CASE WHEN locality = '' THEN address_text ELSE locality END,
       rate_paise = COALESCE(rate_paise, hourly_rate_paise)
 WHERE scheduled_at IS NULL OR rate_paise IS NULL;

-- 4. Extend applications table
ALTER TABLE applications ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'PRIMARY';

-- 5. New table: saved_jobs
CREATE TABLE IF NOT EXISTS saved_jobs (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);

-- 6. New table: job_messages
CREATE TABLE IF NOT EXISTS job_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_messages_job_created
  ON job_messages (job_id, created_at ASC);

-- 7. Extend ratings table (supports both review and comment)
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS review TEXT;

-- 8. Extend notifications table
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body TEXT NOT NULL DEFAULT '';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_notifications_user_is_read
  ON notifications (user_id, created_at DESC)
  WHERE is_read = false;
