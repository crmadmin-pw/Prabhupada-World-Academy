import { getAuth } from 'firebase-admin/auth';

function assertProductionAuthConfiguration() {
  // The Admin SDK disables signature verification in emulator mode. Never let
  // an emulator setting turn production authentication into a payload decoder.
  if (process.env.NODE_ENV === 'production' && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Firebase Auth emulator must not be configured in production.');
  }
}

assertProductionAuthConfiguration();

export async function verifyFirebaseIdToken(token: string) {
  assertProductionAuthConfiguration();
  return getAuth().verifyIdToken(token);
}
