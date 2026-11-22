BEGIN;

DO $test$
DECLARE
  v_poster_id UUID := '11111111-1111-1111-1111-111111111111';
  v_job_id    UUID := '22222222-2222-2222-2222-222222222222';
  v_txn_ok    UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_txn_bad   UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_txn_neg   UUID := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_txn_fee   UUID := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_entry_id  UUID;
  v_bal       BIGINT;
  v_total     BIGINT;
BEGIN
  INSERT INTO users (id, phone, role) VALUES (v_poster_id, '+919000000001', 'poster');
  INSERT INTO wallets (user_id) VALUES (v_poster_id);
  INSERT INTO jobs (id, poster_id, title, description, hourly_rate_paise, hours, lat, lng, start_at)
  VALUES (v_job_id, v_poster_id, 'Event setup', 'Move chairs', 25000, 4, 12.9141, 74.8560, now() + INTERVAL '4 hours');

  -- TEST 1: Balanced funding from external_funding (allowed negative) into poster wallet
  INSERT INTO ledger_entries (txn_id, account, amount_paise, reason) VALUES
    (v_txn_ok, 'external_funding', -100000, 'simulated_topup'),
    (v_txn_ok, 'wallet:' || v_poster_id::text, 100000, 'simulated_topup');

  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;

  SELECT balance_paise INTO v_bal FROM wallets WHERE user_id = v_poster_id;
  IF v_bal <> 100000 THEN
    RAISE EXCEPTION 'FAIL Test 1: expected wallet balance 100000, got %', v_bal;
  END IF;

  SELECT COALESCE(SUM(amount_paise), 0) INTO v_total FROM ledger_entries;
  IF v_total <> 0 THEN
    RAISE EXCEPTION 'FAIL Test 1: expected global ledger sum 0, got %', v_total;
  END IF;
  RAISE NOTICE 'PASS Test 1: balanced txn updates wallet and keeps ledger sum = 0';

  -- TEST 2: Unbalanced transaction is rejected by deferred constraint trigger
  BEGIN
    INSERT INTO ledger_entries (txn_id, account, amount_paise, reason) VALUES
      (v_txn_bad, 'external_funding', -50000, 'broken_txn'),
      (v_txn_bad, 'wallet:' || v_poster_id::text, 40000, 'broken_txn');
    SET CONSTRAINTS trg_ledger_zero_sum IMMEDIATE;
    RAISE EXCEPTION 'FAIL Test 2: unbalanced txn was NOT rejected';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS Test 2: unbalanced txn rejected (%)', SQLERRM;
  END;

  -- TEST 3: UPDATE on ledger_entries is rejected
  SELECT id INTO v_entry_id FROM ledger_entries LIMIT 1;
  BEGIN
    UPDATE ledger_entries SET amount_paise = 999999 WHERE id = v_entry_id;
    RAISE EXCEPTION 'FAIL Test 3: UPDATE on ledger_entries was NOT rejected';
  EXCEPTION
    WHEN restrict_violation THEN
      RAISE NOTICE 'PASS Test 3: UPDATE on ledger_entries rejected';
  END;

  -- TEST 4: DELETE on ledger_entries is rejected
  BEGIN
    DELETE FROM ledger_entries WHERE id = v_entry_id;
    RAISE EXCEPTION 'FAIL Test 4: DELETE on ledger_entries was NOT rejected';
  EXCEPTION
    WHEN restrict_violation THEN
      RAISE NOTICE 'PASS Test 4: DELETE on ledger_entries rejected';
  END;

  -- TEST 5: Negative user wallet balance is rejected
  BEGIN
    INSERT INTO ledger_entries (txn_id, account, amount_paise, reason, job_id) VALUES
      (v_txn_neg, 'wallet:' || v_poster_id::text, -150000, 'overdraft_attempt', v_job_id),
      (v_txn_neg, 'escrow:' || v_job_id::text, 150000, 'overdraft_attempt', v_job_id);
    RAISE EXCEPTION 'FAIL Test 5: negative wallet balance was NOT rejected';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS Test 5: negative wallet balance rejected';
  END;

  -- TEST 6: Direct UPDATE on wallets.balance_paise is rejected
  BEGIN
    UPDATE wallets SET balance_paise = 500000 WHERE user_id = v_poster_id;
    RAISE EXCEPTION 'FAIL Test 6: direct wallet balance update was NOT rejected';
  EXCEPTION
    WHEN restrict_violation THEN
      RAISE NOTICE 'PASS Test 6: direct wallets.balance_paise update rejected';
  END;

  -- TEST 7: Non-external system account (platform_fee) cannot go negative
  BEGIN
    INSERT INTO ledger_entries (txn_id, account, amount_paise, reason) VALUES
      (v_txn_fee, 'platform_fee', -1000, 'illegal_fee_debit'),
      (v_txn_fee, 'wallet:' || v_poster_id::text, 1000, 'illegal_fee_debit');
    SET CONSTRAINTS trg_ledger_account_non_negative IMMEDIATE;
    RAISE EXCEPTION 'FAIL Test 7: negative platform_fee balance was NOT rejected';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS Test 7: negative platform_fee balance rejected';
  END;

  -- TEST 8: Illegal job state transition (DRAFT -> COMPLETED) is rejected
  BEGIN
    UPDATE jobs SET status = 'COMPLETED' WHERE id = v_job_id;
    RAISE EXCEPTION 'FAIL Test 8: illegal job transition was NOT rejected';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS Test 8: illegal job transition rejected';
  END;
END $test$;

ROLLBACK;
