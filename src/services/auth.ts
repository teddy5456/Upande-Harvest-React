/**
 * Auth service — biometric-gated credential storage + silent re-login.
 *
 * Credentials are stored in expo-secure-store with the device's biometric
 * (or device PIN) as the unlock gate via `requireAuthentication: true`.
 * The OS itself enforces the gate: even root can't read the value without
 * the user authenticating to the device.
 *
 * Stored shape (single key `auth:credentials`):
 *   { serverUrl, email, password, enrolledAt }
 *
 * Flow:
 *   - First login: user types email + password → on success, app offers
 *     to enable biometric. If accepted, credentials are written to the
 *     biometric-gated key.
 *   - Subsequent sign-ins: app calls `unlockCredentials()` which triggers
 *     the biometric prompt + decrypts the blob.
 *   - 401 mid-session: app reads credentials silently (no prompt — the
 *     OS-level gate is `requireAuthentication`, but we use a session-cached
 *     unlocked copy for the rest of the in-app lifetime), re-logs in, and
 *     retries the original request.
 */
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

const KEY = 'auth:credentials';

export interface StoredCredentials {
  serverUrl: string;
  email: string;
  password: string;
  enrolledAt: string; // ISO timestamp
}

// In-memory cache so we don't re-prompt the user mid-session.
// Cleared on logout.
let memCache: StoredCredentials | null = null;

export async function biometricSupported(): Promise<{
  available: boolean;
  enrolled: boolean;
  types: LocalAuthentication.AuthenticationType[];
  reason: string;
}> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) {
      return { available: false, enrolled: false, types: [], reason: 'no-hardware' };
    }
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    return {
      available: true,
      enrolled,
      types,
      reason: enrolled ? 'ok' : 'not-enrolled',
    };
  } catch (e: any) {
    return { available: false, enrolled: false, types: [], reason: e?.message || 'unknown' };
  }
}

export async function authenticate(promptMessage = 'Sign in to Mona Shelve'): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Use password',
      disableDeviceFallback: false, // allow device PIN/pattern as fallback
      fallbackLabel: 'Use device PIN',
    });
    return res.success;
  } catch {
    return false;
  }
}

/**
 * Enable biometric sign-in. Called immediately after a successful manual
 * login. Stores creds + verifies the device biometric actually works first.
 */
export async function enrollCredentials(credentials: StoredCredentials): Promise<boolean> {
  const ok = await authenticate('Confirm to enable fingerprint sign-in');
  if (!ok) return false;
  await SecureStore.setItemAsync(KEY, JSON.stringify(credentials), {
    requireAuthentication: true,
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
    authenticationPrompt: 'Sign in to Mona Shelve',
  });
  memCache = { ...credentials };
  // Set the side-channel marker so `hasEnrolledCredentials()` sees the enrol
  // on next app open. Without this the login screen kept showing the password
  // form even after a successful enrolment.
  await setEnrolledMarker(true);
  return true;
}

/**
 * Has the user enrolled credentials on this device?
 * Checked at login-screen mount to decide which UI to render.
 */
export async function hasEnrolledCredentials(): Promise<boolean> {
  try {
    // Probe without the auth prompt — getItem with no requireAuthentication
    // would still trigger biometric on Android in some versions, so we use
    // a no-throw approach. The SecureStore JS API does NOT trigger biometric
    // for an existence check — it returns null if the key doesn't exist.
    // For keys stored WITH requireAuthentication, reading will throw / prompt;
    // we use a side-channel marker key to avoid that.
    const marker = await SecureStore.getItemAsync('auth:enrolled');
    return marker === '1';
  } catch {
    return false;
  }
}

/** Side-channel marker so `hasEnrolledCredentials()` doesn't trigger biometric. */
async function setEnrolledMarker(on: boolean) {
  if (on) await SecureStore.setItemAsync('auth:enrolled', '1');
  else await SecureStore.deleteItemAsync('auth:enrolled');
}

/**
 * "Has the user been offered biometric enrolment already?" flag.
 * Set true once, regardless of whether they accepted or skipped. The login
 * screen consults this so the offer Alert is shown EXACTLY ONCE per device.
 * Resets when the user opts in/out via the Settings toggle so they can be
 * offered again after a full reset.
 */
export async function hasBeenOffered(): Promise<boolean> {
  try {
    const v = await SecureStore.getItemAsync('auth:offered');
    return v === '1';
  } catch {
    return false;
  }
}

export async function markOffered(): Promise<void> {
  await SecureStore.setItemAsync('auth:offered', '1');
}

export async function resetOfferedFlag(): Promise<void> {
  await SecureStore.deleteItemAsync('auth:offered');
}

/**
 * Triggers biometric prompt + returns the stored credentials.
 * Used by the login screen when the user taps "Sign in with fingerprint"
 * and by the 401 interceptor for silent re-login (uses memCache first).
 */
export async function unlockCredentials(
  prompt = 'Sign in to Mona Shelve',
): Promise<StoredCredentials | null> {
  if (memCache) return memCache;
  try {
    const raw = await SecureStore.getItemAsync(KEY, {
      requireAuthentication: true,
      authenticationPrompt: prompt,
    });
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCredentials;
    memCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

/** Returns the in-memory cached credentials if the user already unlocked this session. */
export function cachedCredentials(): StoredCredentials | null {
  return memCache;
}

export async function clearEnrolledCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
  await setEnrolledMarker(false);
  memCache = null;
}

/** Called after a successful login (with or without biometric) to seed the cache. */
export async function markEnrolled(credentials: StoredCredentials): Promise<void> {
  memCache = { ...credentials };
  await setEnrolledMarker(true);
}

/** Drop the in-memory copy without removing the SecureStore blob — used at sign-out. */
export function dropMemoryCache(): void {
  memCache = null;
}
