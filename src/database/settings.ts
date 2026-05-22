import { getDatabase } from './database';

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [key, value]
  );
}

export async function getApiUrl(): Promise<string> {
  return (await getSetting('api_url')) ?? '';
}

export async function getFarm(): Promise<string> {
  return (await getSetting('farm')) ?? '';
}

export async function getAuthToken(): Promise<{ apiKey: string; apiSecret: string } | null> {
  const apiKey = await getSetting('api_key');
  const apiSecret = await getSetting('api_secret');
  if (apiKey && apiSecret) return { apiKey, apiSecret };
  return null;
}

export async function setAuthToken(apiKey: string, apiSecret: string): Promise<void> {
  await setSetting('api_key', apiKey);
  await setSetting('api_secret', apiSecret);
}

export async function getSid(): Promise<string | null> {
  return getSetting('sid');
}

export async function setSid(sid: string): Promise<void> {
  await setSetting('sid', sid);
}

export async function getCsrfToken(): Promise<string | null> {
  return getSetting('csrf_token');
}

export async function setCsrfToken(token: string): Promise<void> {
  await setSetting('csrf_token', token);
}

export async function clearAuth(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM settings WHERE key IN ('api_key', 'api_secret', 'sid', 'csrf_token', 'full_name', 'user_email')");
}

export async function getFullName(): Promise<string> {
  return (await getSetting('full_name')) ?? '';
}

export async function setFullName(name: string): Promise<void> {
  await setSetting('full_name', name);
}

export async function getUserEmail(): Promise<string> {
  return (await getSetting('user_email')) ?? '';
}

export async function setUserEmail(email: string): Promise<void> {
  await setSetting('user_email', email);
}

// ─── Greenhouse cache ─────────────────────────────────────────────────────────
// Stores the full greenhouse list so the Harvest screen can render instantly
// even when the device is offline. The cache is refreshed in the background
// every time a successful fetchGreenhouses() call completes.

export async function getCachedGreenhouses(): Promise<{ data: any[]; cachedAt: string } | null> {
  const [raw, at] = await Promise.all([
    getSetting('cached_greenhouses'),
    getSetting('cached_greenhouses_at'),
  ]);
  if (!raw || !at) return null;
  try {
    return { data: JSON.parse(raw), cachedAt: at };
  } catch {
    return null;
  }
}

export async function setCachedGreenhouses(greenhouses: any[]): Promise<void> {
  await Promise.all([
    setSetting('cached_greenhouses', JSON.stringify(greenhouses)),
    setSetting('cached_greenhouses_at', new Date().toISOString()),
  ]);
}

export async function getUserRoles(): Promise<string[]> {
  const raw = await getSetting('user_roles');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export async function setUserRoles(roles: string[]): Promise<void> {
  await setSetting('user_roles', JSON.stringify(roles));
}
