import { getDatabase } from './database';
import { PackingBox, PackingBoxItem } from '../types';

export async function upsertPackingBox(
  boxId: string,
  farm: string,
  extras: Partial<Pick<PackingBox, 'opl' | 'sales_order' | 'customer' | 'pack_rate' | 'status' | 'box_sequence' | 'total_boxes'>> = {},
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO packing_boxes (box_id, farm, opl, sales_order, customer, pack_rate, status, box_sequence, total_boxes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(box_id) DO UPDATE SET
       farm = excluded.farm,
       opl = COALESCE(excluded.opl, packing_boxes.opl),
       sales_order = COALESCE(excluded.sales_order, packing_boxes.sales_order),
       customer = COALESCE(excluded.customer, packing_boxes.customer),
       pack_rate = COALESCE(excluded.pack_rate, packing_boxes.pack_rate),
       status = COALESCE(excluded.status, packing_boxes.status),
       box_sequence = COALESCE(excluded.box_sequence, packing_boxes.box_sequence),
       total_boxes = COALESCE(excluded.total_boxes, packing_boxes.total_boxes)
    `,
    [
      boxId,
      farm ?? '',
      extras.opl ?? null,
      extras.sales_order ?? null,
      extras.customer ?? null,
      extras.pack_rate ?? null,
      extras.status ?? null,
      extras.box_sequence ?? null,
      extras.total_boxes ?? null,
    ]
  );
}

export async function createPackingBox(boxId: string, farm: string): Promise<void> {
  return upsertPackingBox(boxId, farm);
}

export async function addBunchToBox(
  boxId: string,
  bunchId: string,
  extras: Partial<Pick<PackingBoxItem, 'stems' | 'variety' | 'stem_length' | 'bunch_size'>> = {},
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO packing_box_items (box_id, bunch_id, stems, variety, stem_length, bunch_size)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      boxId,
      bunchId,
      extras.stems ?? 0,
      extras.variety ?? '',
      extras.stem_length ?? '',
      extras.bunch_size ?? '',
    ]
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

export async function markBoxClosed(boxId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE packing_boxes SET status = 'Closed', synced = 1 WHERE box_id = ?`,
    [boxId]
  );
}
