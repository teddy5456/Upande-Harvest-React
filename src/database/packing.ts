import { getDatabase } from './database';
import { PackingBox, PackingBoxItem } from '../types';

export async function createPackingBox(boxId: string, farm: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR IGNORE INTO packing_boxes (box_id, farm) VALUES (?, ?)`,
    [boxId, farm]
  );
}

export async function addBunchToBox(boxId: string, bunchId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO packing_box_items (box_id, bunch_id) VALUES (?, ?)`,
    [boxId, bunchId]
  );
}

export async function getBoxItems(boxId: string): Promise<PackingBoxItem[]> {
  const db = await getDatabase();
  return db.getAllAsync<PackingBoxItem>(
    `SELECT * FROM packing_box_items WHERE box_id = ? ORDER BY date_added DESC`,
    [boxId]
  );
}

export async function removeBunchFromBox(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM packing_box_items WHERE id = ?`, [id]);
}
