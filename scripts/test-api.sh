#!/usr/bin/env bash
set -euo pipefail

DB_USER="${POSTGRES_USER:-hourledger}"
TEST_DB="hourledger_api_test"

cleanup() {
  docker compose exec -T postgres psql -U "$DB_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS $TEST_DB;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS $TEST_DB;" \
  -c "CREATE DATABASE $TEST_DB;" >/dev/null

POSTGRES_DB="$TEST_DB" ./db/migrate.sh >/dev/null
(cd apps/api && npm test)
