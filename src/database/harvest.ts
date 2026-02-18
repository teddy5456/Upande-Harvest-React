import { getDatabase } from './database';

export async function addHarvestEntry(
  itemCode: string,
  quantity: number,
  section: string,
  harvester: string,
  bucketId: string,
  farm: string,
  greenhouse: string,
  stockEntry: string,
  synced: boolean
): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    `INSERT INTO harvest_entries (item_code, quantity, section, harvester, bucket_id, farm, greenhouse, stock_entry, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [itemCode, quantity, section, harvester, bucketId, farm, greenhouse, stockEntry, synced ? 1 : 0]
  );
  return result.lastInsertRowId;
}

export async function getTodayHarvestCount(): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM harvest_entries WHERE date(date_added) = date('now')"
  );
  return result?.count ?? 0;
}
