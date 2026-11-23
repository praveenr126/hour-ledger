import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

export interface AppConfig {
  databaseUrl: string;
  host: string;
  port: number;
  jwtSecret: string;
  otpPepper: string;
  devShowOtp: boolean;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const databaseUrl = overrides.databaseUrl ?? process.env.DATABASE_URL;
  const jwtSecret = overrides.jwtSecret ?? process.env.JWT_SECRET;
  const otpPepper = overrides.otpPepper ?? process.env.OTP_PEPPER;

  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  if (!otpPepper || otpPepper.length < 16) {
    throw new Error('OTP_PEPPER must be at least 16 characters');
  }

  return {
    databaseUrl,
    host: overrides.host ?? process.env.API_HOST ?? '0.0.0.0',
    port: overrides.port ?? Number(process.env.API_PORT ?? 3000),
    jwtSecret,
    otpPepper,
    devShowOtp: overrides.devShowOtp ?? process.env.DEV_SHOW_OTP === 'true'
  };
}
