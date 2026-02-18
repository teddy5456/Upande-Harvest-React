import { getDatabase } from './database';
import { Shelf, ShelfItem, ShelfOccupancy, DashboardStats } from '../types';
import { parseShelfId } from '../utils/shelf-utils';

export async function getOrCreateShelf(shelfId: string, farm: string): Promise<Shelf> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<Shelf>(
    'SELECT * FROM shelves WHERE shelf_id = ?',
    [shelfId]
  );
  if (existing) return existing;

  const parsed = parseShelfId(shelfId);
  if (!parsed) throw new Error(`Invalid shelf ID: ${shelfId}`);

  await db.runAsync(
    'INSERT INTO shelves (shelf_id, side, position, level, farm) VALUES (?, ?, ?, ?, ?)',
    [shelfId, parsed.side, parsed.position, parsed.level, farm]
  );

  return {
    shelf_id: shelfId,
    side: parsed.side,
    position: parsed.position,
    level: parsed.level,
    farm,
    created_at: new Date().toISOString(),
  };
}

export async function getShelf(shelfId: string): Promise<Shelf | null> {
  const db = await getDatabase();
  return db.getFirstAsync<Shelf>(
    'SELECT * FROM shelves WHERE shelf_id = ?',
    [shelfId]
  );
}

export async function getShelfItemCount(shelfId: string): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM shelf_items WHERE shelf_id = ?',
    [shelfId]
  );
  return result?.count ?? 0;
}

export async function getShelfItems(shelfId: string): Promise<ShelfItem[]> {
  const db = await getDatabase();
  return db.getAllAsync<ShelfItem>(
    'SELECT * FROM shelf_items WHERE shelf_id = ? ORDER BY date_added DESC',
    [shelfId]
  );
}

export async function addShelfItem(
  shelfId: string,
  bucketId: string,
  variety: string,
  stemLength: string,
  stemQty: number,
  greenhouse: string,
  synced: boolean
): Promise<ShelfItem> {
  const db = await getDatabase();

  const existing = await db.getFirstAsync<ShelfItem>(
    'SELECT * FROM shelf_items WHERE bucket_id = ?',
    [bucketId]
  );
  if (existing) {
    throw new Error(`Bucket ${bucketId} is already on shelf ${existing.shelf_id}`);
  }

  const now = new Date().toISOString();
  const result = await db.runAsync(
    `INSERT INTO shelf_items (shelf_id, bucket_id, variety, stem_length, stem_qty, greenhouse, date_added, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [shelfId, bucketId, variety, stemLength, stemQty, greenhouse, now, synced ? 1 : 0]
  );

  return {
    id: result.lastInsertRowId,
    shelf_id: shelfId,
    bucket_id: bucketId,
    variety,
    stem_length: stemLength,
    stem_qty: stemQty,
    greenhouse,
    date_added: now,
    synced: synced ? 1 : 0,
  };
}

export async function removeShelfItem(bucketId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM shelf_items WHERE bucket_id = ?', [bucketId]);
}

export async function getAllOccupancy(): Promise<ShelfOccupancy[]> {
  const db = await getDatabase();
  return db.getAllAsync<ShelfOccupancy>(`
    SELECT
      s.shelf_id,
      s.side,
      s.position,
      s.level,
      COUNT(si.id) as bucket_count
    FROM shelves s
    LEFT JOIN shelf_items si ON s.shelf_id = si.shelf_id
    GROUP BY s.shelf_id
    ORDER BY s.side, s.position, s.level
  `);
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const db = await getDatabase();

  const shelfStats = await db.getFirstAsync<{
    total: number;
    occupied: number;
  }>(`
    SELECT
      COUNT(DISTINCT s.shelf_id) as total,
      COUNT(DISTINCT CASE WHEN si.id IS NOT NULL THEN s.shelf_id END) as occupied
    FROM shelves s
    LEFT JOIN shelf_items si ON s.shelf_id = si.shelf_id
  `);

  const bucketCount = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM shelf_items'
  );

  const pendingSync = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'pending'"
  );

  return {
    total_shelves: shelfStats?.total ?? 0,
    occupied_shelves: shelfStats?.occupied ?? 0,
    empty_shelves: (shelfStats?.total ?? 0) - (shelfStats?.occupied ?? 0),
    total_buckets: bucketCount?.count ?? 0,
    pending_sync: pendingSync?.count ?? 0,
  };
}

export async function getAllShelfItems(): Promise<(ShelfItem & { shelf_side: string; shelf_position: number; shelf_level: string })[]> {
  const db = await getDatabase();
  return db.getAllAsync(`
    SELECT si.*, s.side as shelf_side, s.position as shelf_position, s.level as shelf_level
    FROM shelf_items si
    JOIN shelves s ON si.shelf_id = s.shelf_id
    ORDER BY si.date_added DESC
  `);
}
