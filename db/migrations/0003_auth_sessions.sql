-- OTP challenges (DB-backed so pending OTPs survive API restarts)
CREATE TABLE otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_otp_challenges_active
  ON otp_challenges (phone, created_at DESC)
  WHERE consumed_at IS NULL;

-- Rotating refresh tokens (stored as SHA-256 hash; never plaintext)
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by UUID REFERENCES refresh_tokens(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_active_user
  ON refresh_tokens (user_id)
  WHERE revoked_at IS NULL;
