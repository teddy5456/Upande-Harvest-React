import { getPendingEntries, markSynced, markFailed } from '../database/sync-queue';
import {
  submitShelve,
  submitGrading,
  submitHarvest,
  submitReceiving,
  submitQualityEntry,
  submitActualHarvest,
  addBunchToBoxApi,
  closePackBox,
  submitBouquetGrading,
} from './api';
import { BouquetSubmissionPayload } from '../types';

export interface SyncResult {
  synced: number;
  failed: number;
  remaining: number;
}

export async function syncPendingEntries(
  onProgress?: (done: number, total: number) => void
): Promise<SyncResult> {
  const entries = await getPendingEntries();
  const total = entries.length;
  let synced = 0;
  let failed = 0;

  onProgress?.(0, total);

  for (const entry of entries) {
    try {
      const payload = JSON.parse(entry.payload);

      const pd: string | undefined = payload.posting_date;
      const pt: string | undefined = payload.posting_time;

      if (entry.action === 'shelving_entry') {
        await submitShelve(payload.shelf_id, payload.bucket_id, payload.farm, pd, pt);
      } else if (entry.action === 'mobile_grading_entry') {
        await submitGrading({
          bunch_id: payload.bunch_id,
          grader: payload.grader,
          bucket_id: payload.bucket_id,
          farm: payload.farm,
          bunch_size: payload.bunch_size,
          stem_length: payload.stem_length,
          qty: payload.qty,
          variety: payload.variety,
          posting_date: pd,
          posting_time: pt,
        });
      } else if (entry.action === 'createHarvestEntry') {
        await submitHarvest(
          payload.item_code, payload.quantity, payload.section,
          payload.harvester, payload.bucket_id, payload.farm, payload.greenhouse, pd, pt
        );
      } else if (entry.action === 'receiving_entry') {
        await submitReceiving(payload.bucket_id, pd, pt);
      } else if (entry.action === 'create_quality_entry') {
        await submitQualityEntry(
          payload.section,
          payload.ref_id,
          payload.quantity,
          payload.reason,
          payload.notes ?? '',
          payload.farm ?? '',
          payload.greenhouse ?? '',
          payload.variety ?? '',
          !!(payload.quarantined),
          payload.quarantine_action ?? '',
          pd,
          pt
        );
      } else if (entry.action === 'submit_actual_harvest') {
        await submitActualHarvest(
          payload.greenhouse ?? '',
          payload.variety ?? '',
          payload.quantity ?? 0,
          payload.harvest_date ?? '',
          payload.notes ?? '',
          payload.farm ?? ''
        );
      } else if (entry.action === 'add_bunch_to_box') {
        await addBunchToBoxApi({
          bunch_id: payload.bunch_id,
          box_id: payload.box_id,
          opl: payload.opl,
          farm: payload.farm,
        });
      } else if (entry.action === 'close_pack_box') {
        await closePackBox(payload.box_name);
      } else if (entry.action === 'bouquet-grading') {
        await submitBouquetGrading(payload as BouquetSubmissionPayload);
      }

      await markSynced(entry.id);
      synced++;
    } catch (error: any) {
      await markFailed(entry.id, error.message ?? 'Unknown error');
      failed++;
    }
    onProgress?.(synced + failed, total);
    // Yield to the event loop so React can repaint progress between entries.
    await new Promise<void>((r) => setTimeout(r, 0));
  }

  return {
    synced,
    failed,
    remaining: entries.length - synced - failed,
  };
}
