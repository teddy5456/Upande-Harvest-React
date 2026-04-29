import { getDatabase } from './database';
import { SyncQueueEntry } from '../types';

// Action contract: 'bouquet-grading'
//   payload: BouquetSubmissionPayload — see src/types/index.ts
//   handler: the sync runner should call submitBouquetGrading(payload)
//            and mark the row synced on success.

export async function addToSyncQueue(action: string, payload: object): Promise<number> {
  const db = await getDatabase();
  const now = new Date();
  const posting_date = now.toISOString().slice(0, 10);
  const posting_time = now.toTimeString().slice(0, 8);
  const enriched = { posting_date, posting_time, ...payload };
  const result = await db.runAsync(
    'INSERT INTO sync_queue (action, payload) VALUES (?, ?)',
    [action, JSON.stringify(enriched)]
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
