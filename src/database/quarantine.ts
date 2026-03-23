import { getDatabase } from './database';
import { QuarantineScope, QuarantineBatchListEntry } from '../types';

export async function addQuarantineBatch(
  batchId: string,
  scope: QuarantineScope,
  greenhouse: string,
  bucketIds: string[],
  reason: string,
  notes: string,
  synced: boolean,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO quarantine_batches (batch_id, scope, greenhouse, bucket_ids, reason, notes, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [batchId, scope, greenhouse, JSON.stringify(bucketIds), reason, notes, synced ? 1 : 0]
  );
}

export async function getQuarantineBatches(): Promise<QuarantineBatchListEntry[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<QuarantineBatchListEntry>(
    `SELECT * FROM quarantine_batches ORDER BY date_added DESC LIMIT 100`
  );
  return rows ?? [];
}

export async function updateQuarantineBatchStatus(
  id: number,
  status: 'discarded' | 'intake',
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE quarantine_batches SET status = ? WHERE id = ?`,
    [status, id]
  );
}
