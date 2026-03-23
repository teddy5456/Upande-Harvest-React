import { getDatabase } from './database';
import { QualitySection, QuarantineAction } from '../types';

export async function addQualityEntry(
  section: QualitySection,
  refId: string,
  quantity: number,
  reason: string,
  notes: string,
  farm: string,
  synced: boolean,
  greenhouse: string = '',
  variety: string = '',
  quarantined: boolean = false,
  quarantineAction: QuarantineAction = ''
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO quality_entries (section, ref_id, quantity, reason, notes, farm, synced, greenhouse, variety, quarantined, quarantine_action)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [section, refId, quantity, reason, notes, farm, synced ? 1 : 0, greenhouse, variety, quarantined ? 1 : 0, quarantineAction]
  );
}
