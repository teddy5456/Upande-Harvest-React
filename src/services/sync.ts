import { getPendingEntries, markSynced, markFailed } from '../database/sync-queue';
import { submitShelve, submitGrading, submitHarvest, submitReceiving } from './api';

export interface SyncResult {
  synced: number;
  failed: number;
  remaining: number;
}

export async function syncPendingEntries(): Promise<SyncResult> {
  const entries = await getPendingEntries();
  let synced = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      const payload = JSON.parse(entry.payload);

      if (entry.action === 'shelving_entry') {
        await submitShelve(payload.shelf_id, payload.bucket_id, payload.farm);
      } else if (entry.action === 'mobile_grading_entry') {
        await submitGrading(payload.bunch_id, payload.grader, payload.bucket_id, payload.farm);
      } else if (entry.action === 'createHarvestEntry') {
        await submitHarvest(
          payload.item_code, payload.quantity, payload.section,
          payload.harvester, payload.bucket_id, payload.farm, payload.greenhouse
        );
      } else if (entry.action === 'receiving_entry') {
        await submitReceiving(payload.bunch_id, payload.receiver, payload.farm);
      }

      await markSynced(entry.id);
      synced++;
    } catch (error: any) {
      await markFailed(entry.id, error.message ?? 'Unknown error');
      failed++;
    }
  }

  return {
    synced,
    failed,
    remaining: entries.length - synced - failed,
  };
}
