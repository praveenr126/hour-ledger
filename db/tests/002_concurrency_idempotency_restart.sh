#!/usr/bin/env bash
set -euo pipefail

DB_USER="${POSTGRES_USER:-hourledger}"
DB_NAME="${POSTGRES_DB:-hourledger}"
TEST_USER_ID="33333333-3333-3333-3333-333333333333"
TEST_JOB_1="44444444-4444-4444-4444-444444444444"
TEST_JOB_2="55555555-5555-5555-5555-555555555555"

psql_exec() {
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" "$@"
}

cleanup() {
  docker compose exec -T postgres psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS hourledger_test;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Creating isolated test database: hourledger_test"
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d postgres <<'SQL'
DROP DATABASE IF EXISTS hourledger_test;
CREATE DATABASE hourledger_test;
SQL

DB_NAME="hourledger_test"
POSTGRES_DB="hourledger_test" ./db/migrate.sh >/dev/null

echo "==> Test A: Migration idempotency (re-running migrate.sh is a no-op)"
OUT="$(POSTGRES_DB="hourledger_test" ./db/migrate.sh)"
echo "$OUT" | grep -q "skip: 0001_init_schema.sql"
echo "$OUT" | grep -q "skip: 0002_triggers_and_invariants.sql"
echo "PASS Test A: migrations are idempotent"

echo "==> Test B: Real COMMIT rejects unbalanced ledger transaction (no SET CONSTRAINTS)"
if psql_exec <<SQL 2>/dev/null
BEGIN;
INSERT INTO ledger_entries (txn_id, account, amount_paise, reason)
VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'external_funding', -1000, 'unbalanced_commit_test');
COMMIT;
SQL
then
  echo "FAIL Test B: unbalanced COMMIT succeeded"
  exit 1
else
  echo "PASS Test B: unbalanced transaction rejected automatically at COMMIT"
fi

echo "==> Seed user with Rs 1000 (100000 paise) and two draft jobs"
psql_exec <<SQL >/dev/null
BEGIN;
INSERT INTO users (id, phone, role) VALUES ('$TEST_USER_ID', '+919000000099', 'poster');
INSERT INTO wallets (user_id) VALUES ('$TEST_USER_ID');
INSERT INTO jobs (id, poster_id, title, description, hourly_rate_paise, hours, lat, lng, start_at) VALUES
  ('$TEST_JOB_1', '$TEST_USER_ID', 'Job 1', 'Desc', 30000, 2, 12.91, 74.85, now() + INTERVAL '2 hours'),
  ('$TEST_JOB_2', '$TEST_USER_ID', 'Job 2', 'Desc', 30000, 2, 12.91, 74.85, now() + INTERVAL '2 hours');
INSERT INTO ledger_entries (txn_id, account, amount_paise, reason) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'external_funding', -100000, 'seed_topup'),
  ('f0000000-0000-0000-0000-000000000001', 'wallet:$TEST_USER_ID', 100000, 'seed_topup');
COMMIT;
SQL

echo "==> Test C: Concurrency (two simultaneous Rs 600 debits from a Rs 1000 wallet)"
set +e
psql_exec <<SQL >/dev/null 2>&1 &
BEGIN;
INSERT INTO ledger_entries (txn_id, account, amount_paise, reason, job_id) VALUES
  ('f0000000-0000-0000-0000-000000000002', 'wallet:$TEST_USER_ID', -60000, 'fund_job_1', '$TEST_JOB_1'),
  ('f0000000-0000-0000-0000-000000000002', 'escrow:$TEST_JOB_1', 60000, 'fund_job_1', '$TEST_JOB_1');
SELECT pg_sleep(0.2);
COMMIT;
SQL
PID1=$!

psql_exec <<SQL >/dev/null 2>&1 &
BEGIN;
INSERT INTO ledger_entries (txn_id, account, amount_paise, reason, job_id) VALUES
  ('f0000000-0000-0000-0000-000000000003', 'wallet:$TEST_USER_ID', -60000, 'fund_job_2', '$TEST_JOB_2'),
  ('f0000000-0000-0000-0000-000000000003', 'escrow:$TEST_JOB_2', 60000, 'fund_job_2', '$TEST_JOB_2');
COMMIT;
SQL
PID2=$!

wait "$PID1"; RC1=$?
wait "$PID2"; RC2=$?
set -e

if ! { [ "$RC1" -eq 0 ] && [ "$RC2" -ne 0 ]; } && ! { [ "$RC1" -ne 0 ] && [ "$RC2" -eq 0 ]; }; then
  echo "FAIL Test C: expected exactly 1 success and 1 failure, got RC1=$RC1 RC2=$RC2"
  exit 1
fi

BAL="$(psql_exec -tAc "SELECT balance_paise FROM wallets WHERE user_id = '$TEST_USER_ID'")"
SUM="$(psql_exec -tAc "SELECT COALESCE(SUM(amount_paise), 0) FROM ledger_entries")"
[ "$BAL" = "40000" ] && [ "$SUM" = "0" ]
echo "PASS Test C: exactly one debit succeeded; balance_paise=$BAL; ledger sum=$SUM"

echo "==> Test D: Idempotency key uniqueness"
psql_exec <<SQL >/dev/null
INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, status_code, response)
VALUES ('idem-key-1', '$TEST_USER_ID', 'POST /v1/jobs/fund', 'sha256:abc', 200, '{"ok":true}'::jsonb);
SQL
if psql_exec <<SQL >/dev/null 2>&1
INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, status_code, response)
VALUES ('idem-key-1', '$TEST_USER_ID', 'POST /v1/jobs/fund', 'sha256:abc', 200, '{"ok":true}'::jsonb);
SQL
then
  echo "FAIL Test D: duplicate idempotency key was allowed"
  exit 1
else
  echo "PASS Test D: duplicate idempotency key rejected"
fi

echo "==> Test E: Postgres restart persistence"
docker compose restart postgres >/dev/null
until docker compose exec -T postgres pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; do
  sleep 1
done

BAL_AFTER="$(psql_exec -tAc "SELECT balance_paise FROM wallets WHERE user_id = '$TEST_USER_ID'")"
SUM_AFTER="$(psql_exec -tAc "SELECT COALESCE(SUM(amount_paise), 0) FROM ledger_entries")"
[ "$BAL_AFTER" = "40000" ] && [ "$SUM_AFTER" = "0" ]
echo "PASS Test E: wallet balance ($BAL_AFTER) and zero-sum ledger ($SUM_AFTER) survived Postgres restart"
