import { getDatabase } from './database';

export async function addGradingEntry(
  bunchId: string,
  grader: string,
  bucketId: string,
  farm: string,
  variety: string,
  stemLength: string,
  qty: number,
  synced: boolean
): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    `INSERT INTO grading_entries (bunch_id, grader, bucket_id, farm, variety, stem_length, qty, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [bunchId, grader, bucketId, farm, variety, stemLength, qty, synced ? 1 : 0]
  );
  return result.lastInsertRowId;
}

export async function getGradingEntryCount(): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM grading_entries'
  );
  return result?.count ?? 0;
}

export async function getTodayGradingCount(): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM grading_entries WHERE date(date_added) = date('now')"
  );
  return result?.count ?? 0;
}

export async function getTodayGradingStems(): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ total: number }>(
    "SELECT COALESCE(SUM(qty), 0) as total FROM grading_entries WHERE date(date_added) = date('now')"
  );
  return result?.total ?? 0;
}
