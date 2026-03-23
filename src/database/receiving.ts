import { getDatabase } from './database';

export async function addReceivingEntry(
  bucketId: string,
  synced: boolean
): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    `INSERT INTO receiving_entries (bucket_id, synced)
     VALUES (?, ?)`,
    [bucketId, synced ? 1 : 0]
  );
  return result.lastInsertRowId;
}

export async function getTodayReceivingCount(): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM receiving_entries WHERE date(date_added) = date('now')"
  );
  return result?.count ?? 0;
}
