import { getDatabase } from './database';

export async function getTodayHarvestStems(): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(quantity), 0) as total
     FROM harvest_entries
     WHERE date(date_added) = date('now')`
  );
  return result?.total ?? 0;
}

export async function getTodayGradingStems(): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(qty), 0) as total
     FROM grading_entries
     WHERE date(date_added) = date('now')`
  );
  return result?.total ?? 0;
}

export async function getTodayRejectCount(): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(quantity), 0) as total
     FROM quality_entries
     WHERE date(date_added) = date('now')`
  );
  return result?.total ?? 0;
}

export async function getTodayRejectsBySection(): Promise<{ section: string; total: number }[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ section: string; total: number }>(
    `SELECT section, COALESCE(SUM(quantity), 0) as total
     FROM quality_entries
     WHERE date(date_added) = date('now')
     GROUP BY section
     ORDER BY total DESC`
  );
  return rows ?? [];
}

export async function getHarvestByGreenhouse(): Promise<
  { greenhouse: string; stems: number; varieties: string }[]
> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ greenhouse: string; stems: number; varieties: string }>(
    `SELECT
       greenhouse,
       COALESCE(SUM(quantity), 0) as stems,
       GROUP_CONCAT(DISTINCT item_code) as varieties
     FROM harvest_entries
     WHERE date(date_added) = date('now')
       AND greenhouse != ''
     GROUP BY greenhouse
     ORDER BY stems DESC`
  );
  return rows ?? [];
}

export async function getRejectsByGreenhouse(): Promise<{ greenhouse: string; total: number }[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ greenhouse: string; total: number }>(
    `SELECT
       greenhouse,
       COALESCE(SUM(quantity), 0) as total
     FROM quality_entries
     WHERE date(date_added) = date('now')
       AND greenhouse != ''
     GROUP BY greenhouse
     ORDER BY total DESC`
  );
  return rows ?? [];
}

export async function getTodayHarvestStemsByHarvester(harvester: string): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(quantity), 0) as total
     FROM harvest_entries
     WHERE date(date_added) = date('now') AND harvester = ?`,
    [harvester]
  );
  return result?.total ?? 0;
}

export async function getTodayGradingBunches(): Promise<number> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM grading_entries
     WHERE date(date_added) = date('now')`
  );
  return result?.count ?? 0;
}
