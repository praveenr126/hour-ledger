-- 1. Reject UPDATE, DELETE, and TRUNCATE on append-only tables (ledger_entries, audit_log)
CREATE OR REPLACE FUNCTION reject_append_only_mutation()
RETURNS TRIGGER AS $fn$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_immutable_ud
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION reject_append_only_mutation();

CREATE TRIGGER trg_ledger_immutable_truncate
  BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT
  EXECUTE FUNCTION reject_append_only_mutation();

CREATE TRIGGER trg_audit_log_immutable_ud
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION reject_append_only_mutation();

CREATE TRIGGER trg_audit_log_immutable_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION reject_append_only_mutation();

-- 2. Guard wallets.balance_paise so ONLY the ledger trigger can modify it
CREATE OR REPLACE FUNCTION guard_wallet_balance_update()
RETURNS TRIGGER AS $fn$
BEGIN
  IF NEW.balance_paise IS DISTINCT FROM OLD.balance_paise
     AND current_setting('app.allow_wallet_balance_update', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Direct updates to wallets.balance_paise are forbidden; insert a ledger_entries row instead'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wallets_guard_balance
  BEFORE UPDATE ON wallets
  FOR EACH ROW
  EXECUTE FUNCTION guard_wallet_balance_update();

-- 3. Sync wallets.balance_paise on ledger insert (enforces CHECK balance_paise >= 0 and row-locks the wallet)
CREATE OR REPLACE FUNCTION sync_wallet_balance_from_ledger()
RETURNS TRIGGER AS $fn$
DECLARE
  v_user_id UUID;
BEGIN
  IF NEW.account LIKE 'wallet:%' THEN
    v_user_id := substring(NEW.account FROM 8)::UUID;

    PERFORM set_config('app.allow_wallet_balance_update', '1', true);
    UPDATE wallets
       SET balance_paise = balance_paise + NEW.amount_paise,
           updated_at = now()
     WHERE user_id = v_user_id;

    IF NOT FOUND THEN
      PERFORM set_config('app.allow_wallet_balance_update', '0', true);
      RAISE EXCEPTION 'Wallet does not exist for ledger account %', NEW.account
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    PERFORM set_config('app.allow_wallet_balance_update', '0', true);
  END IF;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_sync_wallet
  AFTER INSERT ON ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION sync_wallet_balance_from_ledger();

-- 4. DEFERRABLE INITIALLY DEFERRED zero-sum check per txn_id
CREATE OR REPLACE FUNCTION check_ledger_txn_zero_sum()
RETURNS TRIGGER AS $fn$
DECLARE
  v_sum BIGINT;
  v_count BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount_paise), 0), COUNT(*)
    INTO v_sum, v_count
    FROM ledger_entries
   WHERE txn_id = NEW.txn_id;

  IF v_count < 2 OR v_sum <> 0 THEN
    RAISE EXCEPTION 'Unbalanced ledger txn_id %: sum=% paise across % row(s)', NEW.txn_id, v_sum, v_count
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_ledger_zero_sum
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_ledger_txn_zero_sum();

-- 5. DEFERRABLE INITIALLY DEFERRED non-negative balance check for non-wallet accounts
--    Only 'external_funding' is permitted to go negative.
CREATE OR REPLACE FUNCTION check_ledger_account_non_negative()
RETURNS TRIGGER AS $fn$
DECLARE
  v_balance BIGINT;
BEGIN
  IF NEW.account = 'external_funding' OR NEW.account LIKE 'wallet:%' THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.account));

  SELECT COALESCE(SUM(amount_paise), 0)
    INTO v_balance
    FROM ledger_entries
   WHERE account = NEW.account;

  IF v_balance < 0 THEN
    RAISE EXCEPTION 'Ledger account % cannot have negative balance (% paise)', NEW.account, v_balance
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_ledger_account_non_negative
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_ledger_account_non_negative();

-- 6. Enforce allowed job state transitions (the 13-transition state machine)
CREATE OR REPLACE FUNCTION enforce_job_state_transition()
RETURNS TRIGGER AS $fn$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status = 'DRAFT'             AND NEW.status = 'OPEN')
  OR (OLD.status = 'OPEN'              AND NEW.status IN ('FILLED', 'EXPIRED'))
  OR (OLD.status = 'FILLED'            AND NEW.status IN ('IN_PROGRESS', 'CANCELLED'))
  OR (OLD.status = 'IN_PROGRESS'       AND NEW.status IN ('AWAITING_APPROVAL', 'DISPUTED'))
  OR (OLD.status = 'AWAITING_APPROVAL' AND NEW.status IN ('COMPLETED', 'DISPUTED'))
  OR (OLD.status = 'DISPUTED'          AND NEW.status = 'COMPLETED') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Illegal job state transition: % -> %', OLD.status, NEW.status
    USING ERRCODE = 'check_violation';
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_jobs_state_transition
  BEFORE UPDATE OF status ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION enforce_job_state_transition();

-- 7. Enforce ratings only on COMPLETED jobs
CREATE OR REPLACE FUNCTION enforce_rating_only_completed_job()
RETURNS TRIGGER AS $fn$
DECLARE
  v_status job_status;
BEGIN
  SELECT status INTO v_status FROM jobs WHERE id = NEW.job_id;
  IF v_status IS DISTINCT FROM 'COMPLETED' THEN
    RAISE EXCEPTION 'Ratings are only allowed for COMPLETED jobs (current status: %)', v_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ratings_completed_job
  BEFORE INSERT ON ratings
  FOR EACH ROW
  EXECUTE FUNCTION enforce_rating_only_completed_job();
