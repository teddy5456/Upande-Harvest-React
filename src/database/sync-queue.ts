import { getDatabase } from './database';
import { SyncQueueEntry } from '../types';

// Hard ceiling on pending offline entries. Graders sometimes flip WiFi off
// because online round-trips lag, then keep scanning into a growing queue;
// when they reconnect the bulk sync stalls the device and ages data risks
// going stale. Refusing past N forces an online reconnect.
export const MAX_PENDING_OFFLINE = 5;

export class OfflineQueueFullError extends Error {
  constructor(public readonly pendingCount: number) {
    super(
      `Offline queue is full (${pendingCount}/${MAX_PENDING_OFFLINE}). ` +
      `Reconnect to WiFi and let the pending entries sync before scanning more.`
    );
    this.name = 'OfflineQueueFullError';
  }
}

// Action contract: 'bouquet-grading'
//   payload: BouquetSubmissionPayload — see src/types/index.ts
//   handler: the sync runner should call submitBouquetGrading(payload)
//            and mark the row synced on success.

export async function addToSyncQueue(action: string, payload: object): Promise<number> {
  const pending = await getPendingCount();
  if (pending >= MAX_PENDING_OFFLINE) {
    throw new OfflineQueueFullError(pending);
  }
  const db = await getDatabase();
  const now = new Date();
  const posting_date = now.toISOString().slice(0, 10);
  const posting_time = now.toTimeString().slice(0, 8);
  const enriched = { posting_date, posting_time, ...payload };
  // Use a JS-side ISO timestamp so created_at is unambiguously UTC with a 'Z'
  // suffix. Reading code calls `new Date(iso).toLocaleString()` which then
  // localizes to the device timezone correctly. Avoids SQLite's
  // datetime('now') default which is naked UTC text (no zone marker) and
  // gets misinterpreted as local-time by JS, producing the 3-hour drift.
  const result = await db.runAsync(
    'INSERT INTO sync_queue (action, payload, created_at) VALUES (?, ?, ?)',
    [action, JSON.stringify(enriched), now.toISOString()]
  );
  return result.lastInsertRowId;
}

export async function getPendingEntries(): Promise<SyncQueueEntry[]> {
  const db = await getDatabase();
  return db.getAllAsync<SyncQueueEntry>(
    "SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY created_at ASC"
  );
}

export async function markSynced(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE sync_queue SET status = 'synced' WHERE id = ?",
    [id]
  );
}

export async function markFailed(id: number, errorMessage: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE sync_queue SET status = 'failed', error_message = ? WHERE id = ?",
    [errorMessage, id]
  );
}

export async function retryFailed(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE sync_queue SET status = 'pending', error_message = NULL WHERE status = 'failed'"
  );
}

export async function getPendingCount(): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'pending'"
  );
  return result?.count ?? 0;
}

export async function getFailedCount(): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'failed'"
  );
  return result?.count ?? 0;
}

export async function clearSynced(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM sync_queue WHERE status = 'synced'");
}

export async function getAllEntries(): Promise<SyncQueueEntry[]> {
  const db = await getDatabase();
  return db.getAllAsync<SyncQueueEntry>(
    'SELECT * FROM sync_queue ORDER BY created_at DESC LIMIT 100'
  );
}
