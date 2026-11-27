import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

let initAttempted = false;

export function getFirebaseApp(): App | null {
  const existing = getApps();
  if (existing.length > 0) {
    return existing[0] ?? null;
  }
  if (initAttempted) {
    return null;
  }
  initAttempted = true;

  try {
    const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (rawJson && rawJson.trim().startsWith('{')) {
      return initializeApp({ credential: cert(JSON.parse(rawJson)) });
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      return initializeApp({ credential: applicationDefault() });
    }
  } catch (err) {
    console.warn('[firebase] Failed to initialize Firebase Admin SDK:', (err as Error).message);
  }

  return null;
}

export function isFirebaseConfigured(): boolean {
  return getFirebaseApp() !== null;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<DecodedIdToken> {
  const app = getFirebaseApp();
  if (!app) {
    throw new Error('FIREBASE_NOT_CONFIGURED');
  }
  return getAuth(app).verifyIdToken(idToken);
}
