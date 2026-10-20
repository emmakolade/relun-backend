import { readFileSync } from 'fs';
import { cert, initializeApp, getApps, App } from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';

/**
 * Firebase is only used to send FCM pushes to the native Android app.
 *
 * Configure with the service-account JSON from Firebase console > Project
 * settings > Service accounts, either:
 *   FIREBASE_SERVICE_ACCOUNT_JSON  the JSON itself, raw or base64-encoded (prod)
 *   FIREBASE_SERVICE_ACCOUNT_PATH  a path to the JSON file (local dev)
 * Without either, FCM pushes are skipped with a warning and everything else
 * keeps working.
 */
let app: App | null = null;
let attempted = false;

const loadServiceAccount = (): string | null => {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (json) {
    return json.startsWith('{') ? json : Buffer.from(json, 'base64').toString('utf8');
  }

  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  return keyPath ? readFileSync(keyPath, 'utf8') : null;
};

export const getFirebaseMessaging = (): Messaging | null => {
  if (!attempted) {
    attempted = true;

    try {
      const raw = loadServiceAccount();
      if (raw) {
        const serviceAccount = JSON.parse(raw);
        app = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount) });
      }
    } catch (error) {
      console.error('[firebase] Could not initialise service account:', error);
    }
  }

  return app ? getMessaging(app) : null;
};
