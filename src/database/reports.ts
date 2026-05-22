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

// Stems received today, grouped by the greenhouse the bucket came from.
// receiving_entries doesn't carry a greenhouse, so we join harvest_entries on
// bucket_id to recover that. A bucket with no matching harvest row (e.g. only
// the receive happened on this device) is dropped — we can't attribute it.
export async function getReceivedByGreenhouse(): Promise<{ greenhouse: string; stems: number }[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ greenhouse: string; stems: number }>(
    `SELECT
       h.greenhouse,
       COALESCE(SUM(h.quantity), 0) as stems
     FROM receiving_entries r
     JOIN harvest_entries h ON h.bucket_id = r.bucket_id
     WHERE date(r.date_added) = date('now')
       AND h.greenhouse != ''
     GROUP BY h.greenhouse
     ORDER BY stems DESC`
  );
  return rows ?? [];
}

// Per-greenhouse variety breakdown for today's harvest. Used to populate the
// dropdown next to each greenhouse row on the dashboard.
export async function getHarvestVarietiesByGreenhouse(): Promise<
  { greenhouse: string; variety: string; stems: number }[]
> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ greenhouse: string; variety: string; stems: number }>(
    `SELECT
       greenhouse,
       item_code as variety,
       COALESCE(SUM(quantity), 0) as stems
     FROM harvest_entries
     WHERE date(date_added) = date('now')
       AND greenhouse != ''
       AND item_code != ''
     GROUP BY greenhouse, item_code
     ORDER BY greenhouse, stems DESC`
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

// ── Personal harvester stats (today) ─────────────────────────────────────────
// Pulled straight from the local SQLite — instant, offline-capable, no
// dashboard-blocking server call.
export async function getMyHarvestByGreenhouse(
  harvester: string
): Promise<{ greenhouse: string; stems: number }[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ greenhouse: string; stems: number }>(
    `SELECT
       greenhouse,
       COALESCE(SUM(quantity), 0) AS stems
     FROM harvest_entries
     WHERE date(date_added) = date('now')
       AND harvester = ?
       AND greenhouse != ''
     GROUP BY greenhouse
     ORDER BY stems DESC`,
    [harvester]
  );
  return rows ?? [];
}

// Variety with the stem-length suffix preserved (e.g. "Andina 50cm").
export async function getMyHarvestByVariety(
  harvester: string
): Promise<{ variety: string; stems: number }[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ variety: string; stems: number }>(
    `SELECT
       item_code AS variety,
       COALESCE(SUM(quantity), 0) AS stems
     FROM harvest_entries
     WHERE date(date_added) = date('now')
       AND harvester = ?
       AND item_code != ''
     GROUP BY item_code
     ORDER BY stems DESC`,
    [harvester]
  );
  return rows ?? [];
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
