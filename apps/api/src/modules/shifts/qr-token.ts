import crypto from 'node:crypto';

const QR_TTL_SECONDS = 300;
const QR_FUTURE_SKEW_SECONDS = 30;
const PLATFORM_FEE_BPS = 500; // 5.00%

export function generateCheckinNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

function signCheckin(
  secret: string,
  jobId: string,
  workerId: string,
  nonce: string,
  ts: number
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`checkin:${jobId}:${workerId}:${nonce}:${ts}`)
    .digest('hex')
    .slice(0, 32);
}

export function buildCheckinQrPayload(params: {
  secret: string;
  jobId: string;
  workerId: string;
  nonce: string;
  nowSeconds?: number;
}): { qrPayload: string; expiresInSeconds: number } {
  const ts = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const sig = signCheckin(params.secret, params.jobId, params.workerId, params.nonce, ts);
  return {
    qrPayload: JSON.stringify({ v: 1, job_id: params.jobId, ts, sig }),
    expiresInSeconds: QR_TTL_SECONDS
  };
}

export function verifyCheckinQrPayload(params: {
  rawPayload: string;
  secret: string;
  expectedJobId: string;
  workerId: string;
  nonce: string;
  nowSeconds?: number;
}): { valid: true } | { valid: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(params.rawPayload);
  } catch {
    return { valid: false, reason: 'Malformed QR payload' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, reason: 'Invalid QR payload' };
  }

  const obj = parsed as Record<string, unknown>;
  if (
    obj.v !== 1 ||
    obj.job_id !== params.expectedJobId ||
    typeof obj.ts !== 'number' ||
    !Number.isInteger(obj.ts) ||
    typeof obj.sig !== 'string' ||
    obj.sig.length !== 32
  ) {
    return { valid: false, reason: 'QR payload does not match this job' };
  }

  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (obj.ts > now + QR_FUTURE_SKEW_SECONDS || now - obj.ts > QR_TTL_SECONDS) {
    return { valid: false, reason: 'Check-in QR code has expired; ask poster to refresh' };
  }

  const expectedSig = signCheckin(
    params.secret,
    params.expectedJobId,
    params.workerId,
    params.nonce,
    obj.ts
  );

  const a = Buffer.from(expectedSig, 'utf8');
  const b = Buffer.from(obj.sig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: 'Invalid check-in QR signature' };
  }

  return { valid: true };
}

export function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusM = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusM * c);
}

export interface ShiftSettlementSplit {
  payableMinutes: number;
  maxEscrowPaise: number;
  grossEarnedPaise: number;
  platformFeePaise: number;
  workerPayoutPaise: number;
  posterRefundPaise: number;
}

export function calculateShiftSettlement(params: {
  hourlyRatePaise: number;
  scheduledHours: number;
  actualMinutes: number;
}): ShiftSettlementSplit {
  const scheduledMinutes = params.scheduledHours * 60;
  const payableMinutes = Math.max(1, Math.min(params.actualMinutes, scheduledMinutes));
  const maxEscrowPaise = params.hourlyRatePaise * params.scheduledHours;
  const grossEarnedPaise = Math.floor((maxEscrowPaise * payableMinutes) / scheduledMinutes);
  const platformFeePaise = Math.floor((grossEarnedPaise * PLATFORM_FEE_BPS) / 10000);
  const workerPayoutPaise = grossEarnedPaise - platformFeePaise;
  const posterRefundPaise = maxEscrowPaise - grossEarnedPaise;

  return {
    payableMinutes,
    maxEscrowPaise,
    grossEarnedPaise,
    platformFeePaise,
    workerPayoutPaise,
    posterRefundPaise
  };
}
