import crypto from 'node:crypto';

export function generateOtpCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export function hashOtpCode(phone: string, code: string, pepper: string): string {
  return crypto
    .createHmac('sha256', pepper)
    .update(`${phone}:${code}`)
    .digest('hex');
}

export function verifyOtpHash(expectedHex: string, actualHex: string): boolean {
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(actualHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
