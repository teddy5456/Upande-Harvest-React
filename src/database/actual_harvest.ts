import { getDatabase } from './database';

export async function addActualHarvest(
  greenhouse: string,
  variety: string,
  quantity: number,
  harvest_date: string,
  notes: string,
  farm: string,
  synced: boolean
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO actual_harvest_entries (greenhouse, variety, quantity, harvest_date, notes, farm, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [greenhouse, variety, quantity, harvest_date, notes, farm, synced ? 1 : 0]
  );
}

export async function getTodayActualHarvest(): Promise<
  { greenhouse: string; variety: string; quantity: number }[]
> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ greenhouse: string; variety: string; quantity: number }>(
    `SELECT greenhouse, variety, quantity
     FROM actual_harvest_entries
     WHERE date(harvest_date) = date('now')
     ORDER BY date_added DESC`
  );
  return rows ?? [];
}

export async function getActualHarvestByDate(date: string): Promise<
  { greenhouse: string; variety: string; quantity: number }[]
> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ greenhouse: string; variety: string; quantity: number }>(
    `SELECT greenhouse, variety, quantity
     FROM actual_harvest_entries
     WHERE harvest_date = ?
     ORDER BY date_added DESC`,
    [date]
  );
  return rows ?? [];
}
