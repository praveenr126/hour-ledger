#!/usr/bin/env bash
set -euo pipefail

DB_USER="${POSTGRES_USER:-hourledger}"
DB_NAME="${POSTGRES_DB:-hourledger}"
MIGRATIONS_DIR="$(cd "$(dirname "$0")/migrations" && pwd)"

run_psql() {
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" "$@"
}

run_psql <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

for file in "$MIGRATIONS_DIR"/*.sql; do
  [ -e "$file" ] || continue
  name="$(basename "$file")"

  applied="$(run_psql -tAc "SELECT 1 FROM schema_migrations WHERE filename = '$name'")"
  if [ "$applied" = "1" ]; then
    echo "skip: $name (already applied)"
    continue
  fi

  echo "apply: $name"
  {
    echo "BEGIN;"
    cat "$file"
    echo "INSERT INTO schema_migrations (filename) VALUES ('$name');"
    echo "COMMIT;"
  } | run_psql
done

echo "migrations up to date."
