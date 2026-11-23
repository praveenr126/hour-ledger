#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://127.0.0.1:3000/v1}"
echo "Seeding HourLedger demo dataset against $API_URL ..."

login_and_verify() {
  local phone="$1" name="$2" pan="$3"
  local req_json otp ver_json token
  req_json=$(curl -fsS -X POST "$API_URL/auth/otp/request" -H "Content-Type: application/json" -d "{\"phone\":\"$phone\"}")
  otp=$(node -e "console.log(JSON.parse(process.argv[1]).dev_otp)" "$req_json")
  ver_json=$(curl -fsS -X POST "$API_URL/auth/otp/verify" -H "Content-Type: application/json" -d "{\"phone\":\"$phone\",\"code\":\"$otp\"}")
  token=$(node -e "console.log(JSON.parse(process.argv[1]).access_token)" "$ver_json")
  curl -fsS -X POST "$API_URL/profile/verify" -H "Content-Type: application/json" -H "Authorization: Bearer $token" \
    -d "{\"verified_name\":\"$name\",\"dob\":\"1999-08-15\",\"id_type\":\"pan\",\"id_number\":\"$pan\",\"liveness_passed\":true,\"liveness_prompt\":\"blink\"}" >/dev/null || true
  echo "$token"
}

POSTER_TOKEN=$(login_and_verify "+919800000001" "Asha Rao" "DEMO10001A")
WORKER1_TOKEN=$(login_and_verify "+919800000002" "Kiran Nair" "DEMO10002B")
WORKER2_TOKEN=$(login_and_verify "+919800000003" "Meera Shetty" "DEMO10003C")

curl -fsS -X POST "$API_URL/wallet/topup" -H "Content-Type: application/json" -H "Authorization: Bearer $POSTER_TOKEN" \
  -H "Idempotency-Key: demo-topup-asha-001" -d '{"amount_paise":250000}' >/dev/null

START_OPEN=$(node -e "console.log(new Date(Date.now() + 2*3600*1000).toISOString())")

OPEN_JOB_JSON=$(curl -fsS -X POST "$API_URL/jobs" -H "Content-Type: application/json" -H "Authorization: Bearer $POSTER_TOKEN" \
  -d "{\"title\":\"Bookstore Inventory Count\",\"description\":\"Scan barcodes and shelve new arrivals\",\"checklist\":[\"Scan fiction rack\",\"Label boxes\"],\"hourly_rate_paise\":30000,\"hours\":2,\"lat\":12.9141,\"lng\":74.8560,\"radius_m\":150,\"address_text\":\"MG Road, Mangaluru\",\"start_at\":\"$START_OPEN\"}")
OPEN_JOB_ID=$(node -e "console.log(JSON.parse(process.argv[1]).id)" "$OPEN_JOB_JSON")

curl -fsS -X POST "$API_URL/jobs/$OPEN_JOB_ID/fund" -H "Content-Type: application/json" -H "Authorization: Bearer $POSTER_TOKEN" \
  -H "Idempotency-Key: demo-fund-open-001" -d '{}' >/dev/null

DISP_JOB_JSON=$(curl -fsS -X POST "$API_URL/jobs" -H "Content-Type: application/json" -H "Authorization: Bearer $POSTER_TOKEN" \
  -d "{\"title\":\"Cafe Closing Shift\",\"description\":\"Clean espresso bar and mop floor\",\"checklist\":[\"Sanitize counter\"],\"hourly_rate_paise\":25000,\"hours\":2,\"lat\":12.8698,\"lng\":74.8430,\"radius_m\":150,\"address_text\":\"Hampankatta, Mangaluru\",\"start_at\":\"$START_OPEN\"}")
DISP_JOB_ID=$(node -e "console.log(JSON.parse(process.argv[1]).id)" "$DISP_JOB_JSON")

curl -fsS -X POST "$API_URL/jobs/$DISP_JOB_ID/fund" -H "Content-Type: application/json" -H "Authorization: Bearer $POSTER_TOKEN" \
  -H "Idempotency-Key: demo-fund-disp-001" -d '{}' >/dev/null

APP_JSON=$(curl -fsS -X POST "$API_URL/jobs/$DISP_JOB_ID/apply" -H "Content-Type: application/json" -H "Authorization: Bearer $WORKER2_TOKEN" -d '{}')
APP_ID=$(node -e "console.log(JSON.parse(process.argv[1]).id)" "$APP_JSON")

curl -fsS -X POST "$API_URL/jobs/$DISP_JOB_ID/applications/$APP_ID/accept" -H "Content-Type: application/json" -H "Authorization: Bearer $POSTER_TOKEN" \
  -H "Idempotency-Key: demo-accept-disp-001" -d '{}' >/dev/null

QR_JSON=$(curl -fsS -X GET "$API_URL/jobs/$DISP_JOB_ID/checkin-qr" -H "Authorization: Bearer $POSTER_TOKEN")
QR_PAYLOAD=$(node -e "console.log(JSON.stringify(JSON.parse(process.argv[1]).qr_payload))" "$QR_JSON")

curl -fsS -X POST "$API_URL/jobs/$DISP_JOB_ID/checkin" -H "Content-Type: application/json" -H "Authorization: Bearer $WORKER2_TOKEN" \
  -d "{\"qr_payload\":$QR_PAYLOAD,\"lat\":12.8698,\"lng\":74.8430}" >/dev/null

curl -fsS -X POST "$API_URL/jobs/$DISP_JOB_ID/dispute" -H "Content-Type: application/json" -H "Authorization: Bearer $WORKER2_TOKEN" \
  -d '{"reason":"Store shutter closed early after 1 hour","evidence_note":"Completed counter sanitization before closure"}' >/dev/null

echo "Demo seed complete: Poster +919800000001 | Worker1 +919800000002 (OPEN $OPEN_JOB_ID) | Worker2 +919800000003 (DISPUTED $DISP_JOB_ID)"
