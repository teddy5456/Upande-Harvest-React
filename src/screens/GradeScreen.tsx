import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { addToSyncQueue } from '../database/sync-queue';
import { getFarm } from '../database/settings';
import { addGradingEntry } from '../database/grading';
import { submitGrading, getBucketBalance, submitBucketReject, addToPool, gradeFromPool, getPoolStatus, getBouquetRecipeForBunch, submitBouquetGrading, getGraderOpenBucket } from '../services/api';
import type { PoolEntry } from '../services/api';
import {
  detectGradingQRType,
  extractGradingQRValue,
} from '../utils/grading-utils';
import BouquetRecipeCard, { BouquetVarietyState } from '../components/BouquetRecipe';
import QRScanner from '../components/QRScanner';
import VarietyBanner from '../components/VarietyBanner';
import { BouquetRecipe } from '../types';
import ScanInput from '../components/ScanInput';
import GradingEntryComponent from '../components/GradingEntry';
import ScanConfirmation from '../components/ScanConfirmation';
import EntriesLog from '../components/EntriesLog';
import { GradedEntry, BucketBalance, stripStemLength } from '../types';
import { QUALITY_REASONS } from '../types';
import { onScanSuccess, onScanError, lockHaptic } from '../utils/feedback';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

type SlotKey = 'bunch' | 'grader' | 'bucket';
const FULL_SLOT_ORDER: SlotKey[] = ['bunch', 'grader', 'bucket'];
const DTG_SLOT_ORDER: SlotKey[] = ['bunch', 'grader'];

const SLOT_META: Record<SlotKey, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  bunch: { label: 'Bunch', icon: 'leaf-outline' },
  grader: { label: 'Grader', icon: 'person-outline' },
  bucket: { label: 'Bucket', icon: 'archive-outline' },
};

const GRADING_REJECT_REASONS = QUALITY_REASONS.grading_reject;

type Mode = 'grade' | 'rejects' | 'pool';

export default function GradeScreen() {
  const { isConnected, refreshStats, storageMode } = useApp();
  // RO is the canonical bucket↔grader binding in EVERY storage mode now —
  // shelving, zoning, and DTG all use the same 2-slot grading scan (bunch +
  // grader), with the server resolving bucket from the grader's open RO row.
  // The `directToGrader` name is kept for code-locality but it's effectively
  // "always true" for the grading screen's flow.
  const directToGrader = true;
  // storageMode is still consumed elsewhere in the app (App.tsx tab gating,
  // CS/OPL branching) — referenced here so the import isn't orphaned.
  void storageMode;
  const SLOT_ORDER: SlotKey[] = DTG_SLOT_ORDER;

  // ── Grade mode state ──────────────────────────────────────────
  const [slots, setSlots] = useState<Record<SlotKey, string | null>>({ bunch: null, grader: null, bucket: null });
  const [locks, setLocks] = useState<Record<'grader' | 'bucket', boolean>>({ grader: false, bucket: false });
  const [entries, setEntries] = useState<GradedEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const forcedSlotRef = useRef<SlotKey | null>(null);

  // ── Rejects mode state ────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('grade');
  const [rejBucketId, setRejBucketId] = useState<string | null>(null);
  const [rejGrader, setRejGrader] = useState<string | null>(null);
  const [rejQty, setRejQty] = useState<string>('');
  const [rejReason, setRejReason] = useState<string>('');
  const [rejOtherText, setRejOtherText] = useState('');
  const [bucketBalance, setBucketBalance] = useState<BucketBalance | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [rejSubmitting, setRejSubmitting] = useState(false);
  const [rejSlot, setRejSlot] = useState<'bucket' | 'grader'>('bucket');

  // ── Pool mode state ───────────────────────────────────────────
  const [poolVariety, setPoolVariety] = useState<string | null>(null);
  const [poolBunchId, setPoolBunchId] = useState<string | null>(null);
  const [poolGrader, setPoolGrader] = useState<string | null>(null);
  const [poolSlot, setPoolSlot] = useState<'bunch' | 'grader'>('bunch');
  const [poolSubmitting, setPoolSubmitting] = useState(false);
  const [poolBalance, setPoolBalance] = useState<number>(0);
  const [pools, setPools] = useState<PoolEntry[]>([]);

  // Bouquet mode (hidden — long-press the flower icon in the header to toggle)
  const [bouquetMode, setBouquetMode] = useState(false);
  const [bouquetRecipe, setBouquetRecipe] = useState<BouquetRecipe | null>(null);
  const [bouquetVarieties, setBouquetVarieties] = useState<BouquetVarietyState[]>([]);
  const [bouquetBunchesCount, setBouquetBunchesCount] = useState(1);
  const [bouquetSubmitting, setBouquetSubmitting] = useState(false);

  // ── Remainder modal ───────────────────────────────────────────
  const [remainderModal, setRemainderModal] = useState<{
    visible: boolean; bucketId: string; variety: string; stems: number; bunchSize: number;
  }>({ visible: false, bucketId: '', variety: '', stems: 0, bunchSize: 10 });
  const [addingToPool, setAddingToPool] = useState(false);
  // How many of the leftover stems to take, and who they go to. Blank assignee
  // means the shared pool, which is the default.
  const [takeStems, setTakeStems] = useState('');
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const [assignScanOpen, setAssignScanOpen] = useState(false);
  // Which target the badge scanner is filling: the after-grading card, or the
  // pool card in the Rejects tab.
  const [assignScanFor, setAssignScanFor] = useState<'modal' | 'card'>('modal');

  // ── Pool card (bottom of the Rejects tab) ─────────────────────
  // Pooling never asks for a bucket: it comes from the grader's open Receiving
  // Out, same as the reject above it.
  const [cardTake, setCardTake] = useState('');
  const [cardDest, setCardDest] = useState<'shared' | 'self' | 'other'>('shared');
  const [cardAssignee, setCardAssignee] = useState<string | null>(null);
  const [cardSubmitting, setCardSubmitting] = useState(false);

  // ── Shared confirmation ───────────────────────────────────────
  const [confirmation, setConfirmation] = useState<{ visible: boolean; type: 'success' | 'error'; message: string }>(
    { visible: false, type: 'success', message: '' }
  );

  const showConfirmation = (type: 'success' | 'error', message: string) =>
    setConfirmation({ visible: true, type, message });

  // ── Grade mode handlers ───────────────────────────────────────
  const resetSlots = useCallback((currentLocks?: Record<'grader' | 'bucket', boolean>, currentSlots?: Record<SlotKey, string | null>) => {
    setSlots((prev) => {
      const l = currentLocks ?? locks;
      const s = currentSlots ?? prev;
      return {
        bunch: null,
        grader: l.grader ? s.grader : null,
        bucket: l.bucket ? s.bucket : null,
      };
    });
    forcedSlotRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locks]);

  const handleScanned = useCallback(async (data: string) => {
    if (submitting) return;
    const value = extractGradingQRValue(data);
    if (!value) return;

    let detected = detectGradingQRType(data);
    if (forcedSlotRef.current) { detected = forcedSlotRef.current; forcedSlotRef.current = null; }

    // Direct-to-Grader mode: bucket scans are not part of the grading flow.
    // The server resolves the bucket from the grader's open Receiving Out.
    if (directToGrader && detected === 'bucket') {
      showConfirmation('error', 'In Direct-to-Grader mode, scan the grader QR — not the bucket. Do Receiving Out first.');
      return;
    }

    // Skip locked & already-filled slots when auto-detecting
    if (detected === 'unknown') {
      const next = SLOT_ORDER.find((s) => !slots[s] && !(s !== 'bunch' && locks[s as 'grader' | 'bucket'] && slots[s]));
      if (!next) return;
      detected = next;
    }
    // If detected slot is locked and already filled, ignore the scan entirely
    if (detected !== 'unknown' && detected !== 'bunch') {
      const key = detected as 'grader' | 'bucket';
      if (locks[key] && slots[key]) return;
    }

    // ── Bouquet mode bunch handling ─────────────────────────────────────
    if (bouquetMode && detected === 'bunch') {
      try {
        const recipe = await getBouquetRecipeForBunch(value);
        if (!recipe.is_bouquet) {
          showConfirmation('error', 'This bunch is not a bouquet bunch.');
          return;
        }
        setBouquetRecipe(recipe);
        setBouquetVarieties(
          (recipe.varieties || []).map((v) => ({
            variety: v,
            bucket_id: null,
            stems: v.stems_per_bunch * bouquetBunchesCount,
          }))
        );
        setSlots((s) => ({ ...s, bunch: value }));
        return;
      } catch (e: any) {
        showConfirmation('error', e?.message || 'Failed to load bouquet recipe');
        return;
      }
    }

    // ── Bouquet mode bucket handling ────────────────────────────────────
    if (bouquetMode && detected === 'bucket' && bouquetRecipe) {
      try {
        const bal = await getBucketBalance(value);
        // BucketBalance.variety holds the item_code string (e.g. "Athena 50cm")
        const matchIdx = bouquetVarieties.findIndex(
          (row) => row.variety.item_code === bal.variety && !row.bucket_id
        );
        if (matchIdx === -1) {
          showConfirmation('error', "Bucket variety doesn't match any open recipe row.");
          return;
        }
        setBouquetVarieties((prev) =>
          prev.map((row, idx) =>
            idx === matchIdx
              ? {
                  ...row,
                  bucket_id: value,
                  stems: row.variety.stems_per_bunch * bouquetBunchesCount,
                }
              : row
          )
        );
        return;
      } catch (e: any) {
        showConfirmation('error', e?.message || 'Bucket lookup failed');
        return;
      }
    }

    const target = detected as SlotKey;
    const newSlots = { ...slots, [target]: value };
    setSlots(newSlots);
    onScanSuccess();
    showConfirmation('success', `${SLOT_META[target].label}: ${value}`);

    // (Previously we ran a pre-submit Promise.all to detect partial-bunch
    // buckets — 2 extra round-trips per scan. Now we just submit; the server
    // returns the bucket's post-submit remaining_stems and the client
    // decides whether to auto-pool below. Cuts ~300-500ms off every scan.)

    // Auto-submit:
    //  - Direct-to-Grader: as soon as bunch + grader are scanned (server
    //    resolves bucket from the grader's open Receiving Out row)
    //  - Shelving/Zoning: all three (bunch + grader + bucket) must be present
    const readyToSubmit = directToGrader
      ? !!(newSlots.bunch && newSlots.grader)
      : !!(newSlots.bunch && newSlots.grader && newSlots.bucket);
    if (readyToSubmit) {
      setSubmitting(true);
      await doSubmit(newSlots.bunch!, newSlots.grader!, directToGrader ? null : newSlots.bucket);
      setSubmitting(false);
      resetSlots(locks, newSlots);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, locks, submitting, resetSlots]);

  const submitBouquet = useCallback(async () => {
    if (!bouquetRecipe || !slots.bunch || !slots.grader) return;
    setBouquetSubmitting(true);
    try {
      const payload = {
        bunch_id: slots.bunch,
        grader: slots.grader,
        bunches_count: bouquetBunchesCount,
        contributions: bouquetVarieties.map((v) => ({
          bucket_id: v.bucket_id!,
          item_code: v.variety.item_code,
          stems: v.stems,
        })),
      };
      if (isConnected) {
        await submitBouquetGrading(payload);
      } else {
        await addToSyncQueue('bouquet-grading', payload);
      }
      showConfirmation('success', `Bouquet ${bouquetRecipe.bouquet_group} submitted`);
      setBouquetRecipe(null);
      setBouquetVarieties([]);
      setSlots((s) => ({ ...s, bunch: null }));
    } catch (e: any) {
      showConfirmation('error', e?.message || 'Submit failed');
    } finally {
      setBouquetSubmitting(false);
    }
  }, [bouquetRecipe, slots, bouquetBunchesCount, bouquetVarieties, isConnected]);

  const doSubmit = async (bunchId: string, graderId: string, bucketId?: string | null) => {
      const now = new Date().toLocaleTimeString();
      const farm = await getFarm();

      // Note: we no longer pre-fetch bunch_size + stem_length here. The
      // server's Mobile Grading Entry API reads them from the Bunch QR Code
      // directly, so the pre-fetch was a redundant 150-300ms round-trip per
      // scan. Sending empty strings is equivalent for the server.
      const payload = {
        bucket_id: bucketId || '',
        bunch_id: bunchId,
        bunch_size: '',
        farm,
        grader: graderId,
        qty: 0,
        stem_length: '',
        variety: '',
      };

      if (isConnected) {
        try {
          const response = await submitGrading(payload);

          await addGradingEntry(bunchId, graderId, bucketId || '', farm, response.variety ?? '', response.stem_length ?? '', response.qty ?? 0, true);
          setEntries((prev) => [{ bunch_id: bunchId, grader: graderId, bucket_id: bucketId || '', variety: response.variety ?? '', stem_length: response.stem_length ?? '', qty: response.qty ?? 0, time: now, status: 'success', message: `${response.qty} stems` }, ...prev]);
          await refreshStats();
          onScanSuccess();
          showConfirmation('success', `Graded: ${response.qty ?? 0} stems`);

          // Offer to pool the bucket's remainder when it is smaller than a full
          // bunch. The remainder comes from get_bucket_balance, NOT from the
          // grading response's bucket_remaining_stems: that field sums every
          // harvest and every bunch the bucket has ever seen, with no cycle
          // window, so on any re-used bucket it floors at 0 and this card
          // never opened. get_bucket_balance windows to the current cycle,
          // nets rejects, and prefers the open Receiving Out's count.
          if (isConnected && bucketId) {
            let remaining: number | null = null;
            try {
              const bal = await getBucketBalance(bucketId);
              remaining = bal?.remaining_stems ?? null;
            } catch {
              remaining = response.bucket_remaining_stems ?? null;
            }
            const bunchQty = response.qty ?? 10;
            if (remaining !== null && remaining > 0 && remaining < bunchQty) {
              // The tail cannot make a bunch, so the operator decides what
              // happens to it: pool it, hand it to a named grader, or take only
              // part of it. Auto-pooling silently was quick but gave no choice
              // and hid its own failures, which is why "add to pool" looked
              // broken — nothing ever opened this card.
              const variety = (response.source_item ?? response.variety ?? '').toString();
              setRemainderModal({
                visible: true, bucketId, variety,
                stems: remaining, bunchSize: bunchQty,
              });
              setTakeStems(String(remaining));
              setAssignTo(null);
            }
          }
        } catch (error: any) {
          try {
            await addToSyncQueue('mobile_grading_entry', payload);
            await addGradingEntry(bunchId, graderId, bucketId || '', farm, '', '', 0, false);
            setEntries((prev) => [{ bunch_id: bunchId, grader: graderId, bucket_id: bucketId || '', variety: '', stem_length: '', qty: 0, time: now, status: 'error', message: error.message }, ...prev]);
            await refreshStats();
            onScanError();
            showConfirmation('error', error.message);
          } catch (qErr: any) {
            // Offline queue full (cap = 5). Refuse the scan instead of pretending.
            onScanError();
            showConfirmation('error', qErr.message || 'Offline queue full — reconnect WiFi.');
          }
        }
      } else {
        try {
          await addToSyncQueue('mobile_grading_entry', payload);
          await addGradingEntry(bunchId, graderId, bucketId || '', farm, '', '', 0, false);
          setEntries((prev) => [{ bunch_id: bunchId, grader: graderId, bucket_id: bucketId || '', variety: '', stem_length: '', qty: 0, time: now, status: 'queued', message: 'Saved offline' }, ...prev]);
          await refreshStats();
          onScanSuccess();
          showConfirmation('success', 'Saved offline');
        } catch (qErr: any) {
          onScanError();
          showConfirmation('error', qErr.message || 'Offline queue full — reconnect WiFi.');
        }
      }
    };

  // Manual submit handler for when only bunch and grader are filled
  const handleManualSubmit = useCallback(async () => {
    const { bunch, grader } = slots;
    if (!bunch || !grader) {
      showConfirmation('error', 'Scan both bunch and grader first');
      return;
    }
    if (submitting) return;
    
    setSubmitting(true);
    await doSubmit(bunch, grader, null); // Pass null for bucket ID
    setSubmitting(false);
    resetSlots(locks, slots);
  }, [slots, locks, submitting, resetSlots]);

  const filledCount = SLOT_ORDER.filter((s) => slots[s]).length;
  const allFilled = filledCount === SLOT_ORDER.length;
  // Manual-submit affordance is only meaningful in Shelving/Zoning, where the
  // bucket scan is part of the flow. In Direct-to-Grader the bucket slot does
  // not exist, so auto-submit handles bunch + grader natively.
  const hasBunchAndGrader = !directToGrader && slots.bunch && slots.grader && !slots.bucket;

  // ── Remainder modal handlers ──────────────────────────────────
  const handleAddToPool = async () => {
    const { bucketId, variety, stems, bunchSize } = remainderModal;
    if (!variety) {
      showConfirmation('error',
        'This bucket has no variety on record, so there is no pool to add it to.');
      return;
    }
    // They may take only part of the tail — 3 of the 5 that are still usable.
    const take = parseInt(takeStems, 10);
    if (!take || take <= 0) {
      showConfirmation('error', 'Enter how many stems you are taking');
      return;
    }
    if (take > stems) {
      showConfirmation('error', `Only ${stems} stems are left in ${bucketId}`);
      return;
    }
    const farm = await getFarm();
    const grader = slots.grader ?? '';
    setAddingToPool(true);
    try {
      const resp = await addToPool(
        bucketId, variety, farm, grader, take, bunchSize, assignTo || undefined);
      // An assigned tail belongs to that person, so it must not be shown as the
      // shared pool balance sitting on the Pool tab.
      if (!assignTo) {
        setPoolBalance(resp.pooled_stems);
        if (poolVariety !== variety) setPoolVariety(variety);
      }
      setRemainderModal((p) => ({ ...p, visible: false }));
      showConfirmation('success', assignTo
        ? `${take} stems given to ${assignTo} (${resp.pooled_stems} waiting for them)`
        : `${take} stems added to the pool (${resp.pooled_stems} total)`);
    } catch (err: any) {
      showConfirmation('error', err.message);
    } finally {
      setAddingToPool(false);
    }
  };

  // ── Pool mode handlers ────────────────────────────────────────
  // Every variety in the pool, biggest first. `prefer` keeps the row the
  // operator is working on selected after a bunch is graded off it.
  const refreshPools = useCallback(async (prefer?: string | null) => {
    const farm = await getFarm();
    const status = await getPoolStatus('', farm);
    const list = status?.pools ?? (status?.pool && status.pooled_stems > 0
      ? [{
          pool: status.pool, variety: status.variety ?? '', item_code: status.variety ?? '',
          pooled_stems: status.pooled_stems, lengths: status.lengths ?? 1,
        } as PoolEntry]
      : []);
    setPools(list);
    if (!list.length) { setPoolVariety(null); setPoolBalance(0); return; }
    const chosen = list.find((p) => p.variety === (prefer ?? poolVariety)) ?? list[0];
    setPoolVariety(chosen.variety);
    setPoolBalance(chosen.pooled_stems);
  }, [poolVariety]);

  const handlePoolScan = useCallback(async (data: string) => {
    if (poolSubmitting) return;
    const value = extractGradingQRValue(data) || data.trim();
    if (!value) return;
    if (poolSlot === 'bunch') {
      setPoolBunchId(value);
      setPoolSlot('grader');
      onScanSuccess();
      showConfirmation('success', `Bunch: ${value}`);
    } else {
      setPoolGrader(value);
      onScanSuccess();
      showConfirmation('success', `Grader: ${value}`);
    }
  }, [poolSlot, poolSubmitting]);

  // Pool from the Rejects tab. The bucket, variety and farm all come from the
  // grader's open Receiving Out — the operator only chooses how many and where.
  const handleCardPool = async () => {
    const take = parseInt(cardTake, 10);
    const avail = bucketBalance?.remaining_stems ?? 0;
    if (!rejGrader || !rejBucketId) {
      showConfirmation('error', 'Scan the grader first');
      return;
    }
    if (!take || take <= 0) {
      showConfirmation('error', 'Enter how many stems to pool');
      return;
    }
    if (take > avail) {
      showConfirmation('error', `Only ${avail} stems left in ${rejBucketId}`);
      return;
    }
    if (cardDest === 'other' && !cardAssignee) {
      setAssignScanFor('card'); setAssignScanOpen(true);
      return;
    }
    // 'self' hands the stems to this same grader, so they surface on their next
    // bucket instead of going into the shared remainders pool.
    const assignedTo = cardDest === 'other' ? cardAssignee!
      : cardDest === 'self' ? rejGrader
      : undefined;
    setCardSubmitting(true);
    try {
      const farm = await getFarm();
      const variety = bucketBalance?.variety || bucketBalance?.item_code || '';
      const resp = await addToPool(rejBucketId, variety, farm, rejGrader, take, 0, assignedTo);
      setCardTake('');
      await loadGraderSession(rejGrader);
      await refreshStats();
      onScanSuccess();
      showConfirmation('success',
        cardDest === 'other' ? `${take} stems given to ${cardAssignee} (${resp.pooled_stems} waiting for them)`
        : cardDest === 'self' ? `${take} stems kept for ${rejGrader}'s next bucket (${resp.pooled_stems} waiting)`
        : `${take} stems in the remainders bucket (${resp.pooled_stems} pooled)`);
    } catch (err: any) {
      onScanError();
      showConfirmation('error', err.message);
    } finally {
      setCardSubmitting(false);
    }
  };

  const handlePoolSubmit = async () => {
    if (!poolBunchId || !poolGrader) {
      showConfirmation('error', 'Scan bunch and grader first');
      return;
    }
    setPoolSubmitting(true);
    try {
      const farm = await getFarm();
      const resp = await gradeFromPool(poolBunchId, poolGrader, farm, poolVariety ?? undefined);
      setPoolBalance(resp.pooled_stems);
      if (resp.variety) setPoolVariety(resp.variety);
      try { await refreshPools(resp.variety); } catch { /* offline */ }
      await refreshStats();
      onScanSuccess();
      showConfirmation('success', `${resp.variety ?? 'Pool'} bunch of ${resp.bunch_size ?? ''} graded. `
        + `${resp.pooled_stems} stems left in that pool.`);
      setPoolBunchId(null);
      setPoolGrader(null);
      setPoolSlot('bunch');
    } catch (err: any) {
      onScanError();
      showConfirmation('error', err.message);
    } finally {
      setPoolSubmitting(false);
    }
  };

  // ── Rejects mode handlers ─────────────────────────────────────
  const resetRejects = useCallback(() => {
    setRejBucketId(null);
    setRejGrader(null);
    setRejQty('');
    setBucketBalance(null);
    // In DTG mode we never collect a bucket scan — start on grader.
    setRejSlot(directToGrader ? 'grader' : 'bucket');
  }, [directToGrader]);

  // Everything the Rejects tab needs about a grader: their open bucket, its
  // variety and what is left in it. Called by the grader scan AND on entering
  // the tab with a grader already scanned in the Grade tab — re-scanning the
  // same badge to reject was pure friction.
  const loadGraderSession = useCallback(async (value: string) => {
      setLoadingBalance(true);
      try {
        const open = await getGraderOpenBucket(value);
        if (!open.open || !open.bucket_id) {
          onScanError();
          showConfirmation(
            'error',
            `${value} has no open bucket. Do Receiving Out first.`,
          );
          return;
        }
        setRejGrader(value);
        setRejBucketId(open.bucket_id);
        setBucketBalance({
          bucket_id:       open.bucket_id,
          variety:         open.variety || '',
          item_code:       open.variety || '',
          remaining_stems: open.remaining_qty || 0,
          // Best-effort defaults for fields the rejects UI may render. Most
          // are not relevant to the reject flow in DTG mode.
          capacity:        open.initial_qty || 0,
          graded_stems:    Math.max(0, (open.initial_qty || 0) - (open.remaining_qty || 0)),
          rejected_stems:  0,
          pooled_stems:    0,
        } as any);
        // Do NOT prefill with the whole remainder: with a pool card sitting
        // right below, a mis-tap would write the entire tail off as rejects.
        setRejQty('');
        onScanSuccess();
        showConfirmation(
          'success',
          `${value} · ${open.bucket_id} — ${open.remaining_qty} stems remaining`,
        );
      } catch (err: any) {
        onScanError();
        showConfirmation('error', err.message);
      } finally {
        setLoadingBalance(false);
      }
  }, []);

  const handleRejectScan = useCallback(async (data: string) => {
    if (rejSubmitting) return;
    const value = extractGradingQRValue(data) || data.trim();
    if (!value) return;

    // Direct-to-Grader: only the grader QR is scanned. We pull the open
    // Receiving Out for that grader and use ITS bucket + remaining qty as the
    // reject context. Skips the bucket-scan slot entirely.
    if (directToGrader) {
      await loadGraderSession(value);
      return;
    }

    if (rejSlot === 'bucket') {
      setLoadingBalance(true);
      try {
        const balance = await getBucketBalance(value);
        setBucketBalance(balance);
        setRejBucketId(value);
        // Pre-fill with remaining stems
        setRejQty(String(balance.remaining_stems > 0 ? balance.remaining_stems : 0));
        setRejSlot('grader');
        onScanSuccess();
        showConfirmation('success', `Bucket: ${value} — ${balance.remaining_stems} stems remaining`);
      } catch (err: any) {
        onScanError();
        showConfirmation('error', err.message);
      } finally {
        setLoadingBalance(false);
      }
    } else {
      setRejGrader(value);
      onScanSuccess();
      showConfirmation('success', `Grader: ${value}`);
    }
  }, [rejSlot, rejSubmitting, directToGrader]);

  const handleRejectSubmit = async () => {
    if (!rejBucketId || !rejGrader) {
      showConfirmation('error', 'Scan bucket and grader first');
      return;
    }
    const qty = parseInt(rejQty, 10);
    if (!qty || qty <= 0) {
      showConfirmation('error', 'Enter a valid reject quantity');
      return;
    }
    if (!rejReason) {
      showConfirmation('error', 'Select a reject reason');
      return;
    }
    if (rejReason === 'Other' && !rejOtherText.trim()) {
      showConfirmation('error', 'Type the reason for “Other”');
      return;
    }
    setRejSubmitting(true);
    try {
      const farm = await getFarm();
      const resp = await submitBucketReject(rejBucketId, rejGrader, qty, farm, rejReason === 'Other' ? rejOtherText.trim() : rejReason);
      await refreshStats();
      onScanSuccess();
      showConfirmation('success', `${qty} rejects recorded. ${resp.remaining_stems} stems remaining.`);
      resetRejects();
      setRejReason('');
      setRejOtherText('');
    } catch (err: any) {
      onScanError();
      showConfirmation('error', err.message);
    } finally {
      setRejSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>

      {/* Mode toggle */}
      <View style={styles.modeToggle}>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'grade' && styles.modeBtnActive]}
          onPress={() => setMode('grade')}
          activeOpacity={0.7}
        >
          <Ionicons name="clipboard-outline" size={14} color={mode === 'grade' ? '#fff' : colors.textMuted} />
          <Text style={[styles.modeBtnText, mode === 'grade' && styles.modeBtnTextActive]}>Grade</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'rejects' && styles.modeBtnReject]}
          onPress={() => {
            setMode('rejects');
            // Carry the grader over from the Grade tab. Their open Receiving Out
            // is the whole reject/pool context, so scanning the same badge again
            // was friction for nothing.
            const carried = slots.grader;
            if (carried) {
              setRejQty(''); setRejReason(''); setRejOtherText('');
              setCardTake(''); setCardDest('shared'); setCardAssignee(null);
              loadGraderSession(carried);
            } else {
              resetRejects();
            }
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="close-circle-outline" size={14} color={mode === 'rejects' ? '#fff' : colors.textMuted} />
          <Text style={[styles.modeBtnText, mode === 'rejects' && styles.modeBtnTextActive]}>Rejects</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'pool' && styles.modeBtnPool]}
          onPress={async () => {
            setMode('pool');
            // Recover any existing pool state from the server so the user
            // doesn't see "no active pool" just because the app was restarted.
            try {
              await refreshPools();
            } catch { /* offline — pool stays whatever it was */ }
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="layers-outline" size={14} color={mode === 'pool' ? '#fff' : colors.textMuted} />
          <Text style={[styles.modeBtnText, mode === 'pool' && styles.modeBtnTextActive]}>Pool</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onLongPress={() => {
            setBouquetMode((m) => !m);
            setBouquetRecipe(null);
            setBouquetVarieties([]);
            setBouquetBunchesCount(1);
          }}
          delayLongPress={800}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Bouquet mode toggle"
          style={{ marginLeft: spacing.sm }}
        >
          <Ionicons
            name="leaf-outline"
            size={20}
            color={bouquetMode ? colors.primary : colors.textMuted}
          />
        </TouchableOpacity>
      </View>

      {mode === 'grade' ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {bouquetMode ? (
            <TouchableOpacity onPress={() => setBouquetMode(false)} style={styles.bouquetBanner}>
              <Text style={styles.bouquetBannerText}>Bouquet mode — tap to exit</Text>
            </TouchableOpacity>
          ) : null}
          {/* Slot pills */}
          <View style={styles.pillRow}>
            {SLOT_ORDER.map((slot, i) => {
              const filled = !!slots[slot];
              const lockable = slot === 'grader' || slot === 'bucket';
              const locked = lockable && locks[slot as 'grader' | 'bucket'];
              return (
                <React.Fragment key={slot}>
                  {i > 0 && <View style={[styles.pillConnector, filled && i <= filledCount ? styles.pillConnectorDone : null]} />}
                  <TouchableOpacity
                    style={[styles.pill, filled ? styles.pillFilled : null, locked ? styles.pillLocked : null]}
                    onPress={() => { if (!filled) forcedSlotRef.current = slot; }}
                    onLongPress={() => { if (lockable && filled) { lockHaptic(!locked); setLocks((l) => ({ ...l, [slot]: !l[slot as 'grader' | 'bucket'] })); } }}
                    delayLongPress={400}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={locked ? 'lock-closed' : filled ? 'checkmark-circle' : SLOT_META[slot].icon}
                      size={14}
                      color={filled ? (locked ? '#f59e0b' : colors.success) : colors.textMuted}
                    />
                    <Text style={[styles.pillLabel, filled && styles.pillLabelFilled, locked && styles.pillLabelLocked]}>
                      {filled ? (slot === 'grader' ? slots[slot]!.split(/[\s_-]/)[0] : slots[slot]!) : SLOT_META[slot].label}
                    </Text>
                    {filled && !locked && (
                      <TouchableOpacity
                        onPress={() => setSlots((p) => ({ ...p, [slot]: null }))}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close-circle" size={14} color={colors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                </React.Fragment>
              );
            })}
          </View>

          <View style={styles.scanSection}>
            <ScanInput
              placeholder={submitting ? 'Submitting…' : (directToGrader ? 'Scan bunch / grader' : 'Scan bunch / grader / bucket')}
              scannerTitle="Scan QR Code"
              onScan={handleScanned}
              keepFocused
            />
          </View>

          {/* Manual Submit Button - shows when bunch and grader are filled but bucket is not */}
          {hasBunchAndGrader && (
            <TouchableOpacity
              style={[styles.manualSubmitBtn, submitting && styles.submitBtnDisabled]}
              onPress={handleManualSubmit}
              disabled={submitting}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                  <Text style={styles.submitBtnText}>Submit Grading (No Bucket)</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {bouquetMode && bouquetRecipe ? (
            <BouquetRecipeCard
              recipe={bouquetRecipe}
              bunchesCount={bouquetBunchesCount}
              onBunchesCountChange={(n) => {
                setBouquetBunchesCount(n);
                setBouquetVarieties((prev) =>
                  prev.map((row) => ({
                    ...row,
                    stems: row.variety.stems_per_bunch * n,
                  }))
                );
              }}
              varieties={bouquetVarieties}
              onSubmit={submitBouquet}
              submitting={bouquetSubmitting}
            />
          ) : null}

          <EntriesLog
            entries={entries}
            label="entry"
            renderEntry={(entry, idx) => (
              <GradingEntryComponent entry={entry} index={idx} />
            )}
          />
        </ScrollView>
      ) : mode === 'rejects' ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          {/* Step indicators — DTG mode hides the bucket pill since the
              server resolves bucket from the grader's open Receiving Out. */}
          <View style={styles.pillRow}>
            {(directToGrader ? ['grader'] as const : ['bucket', 'grader'] as const).map((slot, i) => {
              const value = slot === 'bucket' ? rejBucketId : rejGrader;
              const filled = !!value;
              const label = slot === 'bucket' ? 'Bucket' : 'Grader';
              const icon: keyof typeof Ionicons.glyphMap = slot === 'bucket' ? 'archive-outline' : 'person-outline';
              return (
                <React.Fragment key={slot}>
                  {i > 0 && <View style={[styles.pillConnector, filled ? styles.pillConnectorDone : null]} />}
                  <TouchableOpacity
                    style={[styles.pill, filled ? styles.pillFilled : null]}
                    onPress={() => { if (!filled) setRejSlot(slot as 'bucket' | 'grader'); }}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={filled ? 'checkmark-circle' : icon}
                      size={14}
                      color={filled ? colors.success : colors.textMuted}
                    />
                    <Text style={[styles.pillLabel, filled && styles.pillLabelFilled]}>
                      {filled ? value! : label}
                    </Text>
                    {filled && (
                      <TouchableOpacity
                        onPress={() => {
                          if (slot === 'bucket') { setRejBucketId(null); setBucketBalance(null); setRejQty(''); setRejSlot('bucket'); }
                          else { setRejGrader(null); if (directToGrader) { setRejBucketId(null); setBucketBalance(null); setRejQty(''); } setRejSlot(directToGrader ? 'grader' : 'grader'); }
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close-circle" size={14} color={colors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                </React.Fragment>
              );
            })}
          </View>

          {/* Scan input */}
          <View style={styles.scanSection}>
            {loadingBalance ? (
              <View style={styles.balanceLoading}>
                <ActivityIndicator size="small" color={colors.text} />
                <Text style={styles.balanceLoadingText}>
                  {directToGrader ? 'Resolving grader\'s open bucket…' : 'Fetching bucket balance…'}
                </Text>
              </View>
            ) : (
              <ScanInput
                placeholder={
                  directToGrader
                    ? (!rejGrader ? 'Scan grader QR' : 'Ready to submit')
                    : (!rejBucketId ? 'Scan bucket' :
                       !rejGrader   ? 'Scan grader' :
                       'Ready to submit')
                }
                scannerTitle={
                  directToGrader
                    ? 'Scan Grader'
                    : (!rejBucketId ? 'Scan Bucket' : 'Scan Grader')
                }
                onScan={handleRejectScan}
                disabled={
                  rejSubmitting ||
                  (directToGrader
                    ? !!rejGrader
                    : (!!rejBucketId && !!rejGrader))
                }
              />
            )}
          </View>

          {/* Bucket balance card */}
          {bucketBalance && (
            <View style={styles.balanceCard}>
              <View style={styles.balanceRow}>
                <Text style={styles.balanceLabel}>Variety</Text>
                <Text style={styles.balanceValue}>{stripStemLength(bucketBalance.variety) || '—'}</Text>
              </View>
              <View style={styles.balanceDivider} />
              <View style={styles.balanceStats}>
                <View style={styles.balanceStat}>
                  <Text style={styles.balanceStatNum}>{bucketBalance.bucket_total}</Text>
                  <Text style={styles.balanceStatLabel}>Received</Text>
                </View>
                <View style={styles.balanceStat}>
                  <Text style={styles.balanceStatNum}>{bucketBalance.already_graded}</Text>
                  <Text style={styles.balanceStatLabel}>Graded</Text>
                </View>
                <View style={styles.balanceStat}>
                  <Text style={styles.balanceStatNum}>{bucketBalance.already_rejected}</Text>
                  <Text style={styles.balanceStatLabel}>Rejected</Text>
                </View>
                <View style={[styles.balanceStat, styles.balanceStatHighlight]}>
                  <Text style={[styles.balanceStatNum, styles.balanceStatNumHighlight]}>{bucketBalance.remaining_stems}</Text>
                  <Text style={[styles.balanceStatLabel, styles.balanceStatLabelHighlight]}>Remaining</Text>
                </View>
              </View>
            </View>
          )}

          {/* Reject qty input */}
          {rejBucketId && (
            <View style={styles.qtySection}>
              <Text style={styles.qtyLabel}>Reject Quantity</Text>
              <View style={styles.qtyRow}>
                <TouchableOpacity
                  style={styles.qtyBtn}
                  onPress={() => setRejQty((v) => String(Math.max(0, parseInt(v || '0', 10) - 1)))}
                >
                  <Ionicons name="remove" size={20} color={colors.text} />
                </TouchableOpacity>
                <TextInput
                  style={styles.qtyInput}
                  value={rejQty}
                  onChangeText={setRejQty}
                  keyboardType="number-pad"
                  selectTextOnFocus
                />
                <TouchableOpacity
                  style={styles.qtyBtn}
                  onPress={() => setRejQty((v) => String(parseInt(v || '0', 10) + 1))}
                >
                  <Ionicons name="add" size={20} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Reject reason chips */}
          {rejBucketId && (
            <View style={styles.reasonSection}>
              <Text style={styles.reasonLabel}>Reason <Text style={styles.reasonReq}>*</Text></Text>
              <View style={styles.chipGrid}>
                {GRADING_REJECT_REASONS.map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.chip, rejReason === r && styles.chipActive]}
                    onPress={() => setRejReason((prev) => prev === r ? '' : r)}
                    activeOpacity={0.7}
                  >
                    {rejReason === r && <Ionicons name="checkmark" size={11} color="#fff" style={{ marginRight: 2 }} />}
                    <Text style={[styles.chipText, rejReason === r && styles.chipTextActive]}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Other reason free-text input */}
          {rejBucketId && rejReason === 'Other' && (
            <View style={styles.reasonSection}>
              <Text style={styles.reasonLabel}>Other reason <Text style={styles.reasonReq}>*</Text></Text>
              <TextInput
                style={styles.reasonInput}
                value={rejOtherText}
                onChangeText={setRejOtherText}
                placeholder="Type the reason"
                placeholderTextColor={colors.textMuted}
              />
            </View>
          )}

          {/* Pool card. Whatever is left that cannot make a bunch goes somewhere
              deliberate: the remainders bucket, another grader, or this grader's
              own next bucket. No bucket is ever scanned — it comes from the
              open Receiving Out above. */}
          {rejBucketId && rejGrader && (
            <View style={styles.poolCard}>
              <View style={styles.poolCardHead}>
                <Ionicons name="layers-outline" size={15} color="#4338CA" />
                <Text style={styles.poolCardTitle}>Pool what is left</Text>
                <Text style={styles.poolCardMax}>
                  {bucketBalance?.remaining_stems ?? 0} available
                </Text>
              </View>

              <Text style={styles.modalFieldLabel}>Stems to pool</Text>
              <View style={styles.takeRow}>
                <TextInput
                  style={styles.takeInput}
                  value={cardTake}
                  onChangeText={(t) => setCardTake(t.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  selectTextOnFocus
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                />
                <Text style={styles.takeOf}>of {bucketBalance?.remaining_stems ?? 0}</Text>
                <TouchableOpacity
                  onPress={() => setCardTake(String(bucketBalance?.remaining_stems ?? 0))}
                  activeOpacity={0.7}
                >
                  <Text style={styles.takeAll}>all</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.modalFieldLabel}>Where they go</Text>
              <View style={styles.poolDestCol}>
                {([
                  ['shared', 'archive-outline', 'Remainders bucket',
                   'Any variety, anyone can bunch it later'],
                  ['self', 'repeat-outline', 'My next bucket',
                   'Waits for this grader to open their next bucket'],
                  ['other', 'person-outline', cardAssignee ? `To ${cardAssignee}` : 'Give to a grader',
                   'Becomes theirs to bunch'],
                ] as const).map(([key, icon, label, hint]) => {
                  const on = cardDest === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.poolDestRow, on && styles.poolDestRowOn]}
                      onPress={() => {
                        setCardDest(key);
                        if (key === 'other' && !cardAssignee) {
                          setAssignScanFor('card'); setAssignScanOpen(true);
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name={icon} size={16} color={on ? '#4338CA' : colors.textMuted} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.poolDestLabel, on && styles.poolDestLabelOn]}>{label}</Text>
                        <Text style={styles.poolDestHint}>{hint}</Text>
                      </View>
                      {on && <Ionicons name="checkmark-circle" size={16} color="#4338CA" />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={[styles.poolCardBtn, cardSubmitting && styles.submitBtnDisabled]}
                onPress={handleCardPool}
                disabled={cardSubmitting}
                activeOpacity={0.8}
              >
                {cardSubmitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="layers-outline" size={16} color="#fff" />
                    <Text style={styles.submitBtnText}>Pool {cardTake || '0'} stems</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Submit button */}
          {rejBucketId && rejGrader && (
            <TouchableOpacity
              style={[styles.submitBtn, rejSubmitting && styles.submitBtnDisabled]}
              onPress={handleRejectSubmit}
              disabled={rejSubmitting}
              activeOpacity={0.8}
            >
              {rejSubmitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="close-circle-outline" size={18} color="#fff" />
                  <Text style={styles.submitBtnText}>Submit {rejQty || '0'} Rejects</Text>
                </>
              )}
            </TouchableOpacity>
          )}

        </ScrollView>
      ) : mode === 'pool' ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          {/* One row per variety in the pool. The server used to return only the
              biggest pool, so a second variety was invisible until it overtook
              the first — graders could not see stems they were holding. */}
          {pools.length ? (
            <>
              <VarietyBanner
                variety={poolVariety ?? pools[0].variety}
                stems={poolBalance}
                context="pooled and ready to bunch"
              />
              {pools.length > 1 ? (
                <View style={styles.poolChipRow}>
                  {pools.map((p) => {
                    const on = (poolVariety ?? pools[0].variety) === p.variety;
                    return (
                      <TouchableOpacity
                        key={p.pool}
                        style={[styles.poolChip, on && styles.poolChipOn]}
                        onPress={() => { setPoolVariety(p.variety); setPoolBalance(p.pooled_stems); }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.poolChipText, on && styles.poolChipTextOn]}>
                          {p.variety} · {p.pooled_stems}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.poolBanner}>
              <Text style={styles.poolEmptyText}>No active pool — grade a bucket first to add remainders</Text>
            </View>
          )}

          {/* Step pills */}
          <View style={styles.pillRow}>
            {(['bunch', 'grader'] as const).map((slot, i) => {
              const value = slot === 'bunch' ? poolBunchId : poolGrader;
              const filled = !!value;
              const label = slot === 'bunch' ? 'Bunch' : 'Grader';
              const icon: keyof typeof Ionicons.glyphMap = slot === 'bunch' ? 'leaf-outline' : 'person-outline';
              return (
                <React.Fragment key={slot}>
                  {i > 0 && <View style={[styles.pillConnector, filled ? styles.pillConnectorDone : null]} />}
                  <TouchableOpacity
                    style={[styles.pill, filled ? styles.pillFilled : null]}
                    onPress={() => { if (!filled) setPoolSlot(slot); }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name={filled ? 'checkmark-circle' : icon} size={14} color={filled ? colors.success : colors.textMuted} />
                    <Text style={[styles.pillLabel, filled && styles.pillLabelFilled]}>
                      {filled ? value! : label}
                    </Text>
                    {filled && (
                      <TouchableOpacity
                        onPress={() => {
                          if (slot === 'bunch') { setPoolBunchId(null); setPoolSlot('bunch'); }
                          else { setPoolGrader(null); setPoolSlot('grader'); }
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close-circle" size={14} color={colors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                </React.Fragment>
              );
            })}
          </View>

          <View style={styles.scanSection}>
            <ScanInput
              placeholder={!poolBunchId ? 'Scan bunch' : !poolGrader ? 'Scan grader' : 'Ready to submit'}
              scannerTitle={!poolBunchId ? 'Scan Bunch' : 'Scan Grader'}
              onScan={handlePoolScan}
              disabled={poolSubmitting || (!!poolBunchId && !!poolGrader)}
            />
          </View>

          {poolBunchId && poolGrader && (
            <TouchableOpacity
              style={[styles.poolSubmitBtn, poolSubmitting && styles.submitBtnDisabled]}
              onPress={handlePoolSubmit}
              disabled={poolSubmitting}
              activeOpacity={0.8}
            >
              {poolSubmitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="layers-outline" size={18} color="#fff" />
                  <Text style={styles.submitBtnText}>Grade from Pool</Text>
                </>
              )}
            </TouchableOpacity>
          )}

        </ScrollView>
      ) : null}

      {/* Remainder modal */}
      <Modal visible={remainderModal.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Ionicons name="layers-outline" size={20} color={colors.text} />
              <Text style={styles.modalTitle}>Remainder Stems</Text>
            </View>
            <VarietyBanner
              variety={remainderModal.variety}
              stems={remainderModal.stems}
              context={`Bucket ${remainderModal.bucketId}`}
            />
            <Text style={styles.modalBody}>
              Not enough for a bunch of{' '}
              <Text style={styles.modalHighlight}>{remainderModal.bunchSize}</Text>.
              Pool them for later, or give them to a grader.
            </Text>

            {/* They may take only some of what is left. */}
            <Text style={styles.modalFieldLabel}>Stems you are taking</Text>
            <View style={styles.takeRow}>
              <TextInput
                style={styles.takeInput}
                value={takeStems}
                onChangeText={(t) => setTakeStems(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                selectTextOnFocus
                placeholder={String(remainderModal.stems)}
                placeholderTextColor={colors.textMuted}
              />
              <Text style={styles.takeOf}>of {remainderModal.stems}</Text>
              {takeStems !== String(remainderModal.stems) ? (
                <TouchableOpacity
                  onPress={() => setTakeStems(String(remainderModal.stems))}
                  activeOpacity={0.7}
                >
                  <Text style={styles.takeAll}>take all</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Shared pool by default; scanning a badge hands them over instead. */}
            <Text style={styles.modalFieldLabel}>Where they go</Text>
            <View style={styles.destRow}>
              <TouchableOpacity
                style={[styles.destChip, !assignTo && styles.destChipOn]}
                onPress={() => setAssignTo(null)}
                activeOpacity={0.7}
              >
                <Ionicons name="layers-outline" size={14}
                  color={!assignTo ? colors.textOnPrimary : colors.textSecondary} />
                <Text style={[styles.destChipText, !assignTo && styles.destChipTextOn]}>
                  Shared pool
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.destChip, !!assignTo && styles.destChipOn]}
                onPress={() => { setAssignScanFor('modal'); setAssignScanOpen(true); }}
                activeOpacity={0.7}
              >
                <Ionicons name="person-outline" size={14}
                  color={assignTo ? colors.textOnPrimary : colors.textSecondary} />
                <Text style={[styles.destChipText, !!assignTo && styles.destChipTextOn]}>
                  {assignTo ? `To ${assignTo}` : 'Give to a grader'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalSkip}
                onPress={() => setRemainderModal((p) => ({ ...p, visible: false }))}
                activeOpacity={0.7}
              >
                <Text style={styles.modalSkipText}>Leave in bucket</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalPool, addingToPool && styles.submitBtnDisabled]}
                onPress={handleAddToPool}
                disabled={addingToPool}
                activeOpacity={0.8}
              >
                {addingToPool
                  ? <ActivityIndicator size="small" color="#fff" />
                  : (
                    <Text style={styles.modalPoolText}>
                      {assignTo ? 'Hand over' : 'Add to pool'}
                    </Text>
                  )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <QRScanner
        visible={assignScanOpen}
        title="Scan the grader's badge"
        onScanned={(data) => {
          const who = (extractGradingQRValue(data) || data.trim()).trim();
          setAssignScanOpen(false);
          if (!who) {
            showConfirmation('error', 'Could not read that badge');
            return;
          }
          if (assignScanFor === 'card') { setCardAssignee(who); setCardDest('other'); }
          else { setAssignTo(who); }
        }}
        onClose={() => setAssignScanOpen(false)}
      />

      <ScanConfirmation
        visible={confirmation.visible}
        type={confirmation.type}
        message={confirmation.message}
        onDismiss={() => setConfirmation((prev) => ({ ...prev, visible: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  modalFieldLabel: {
    fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textSecondary,
    marginTop: spacing.md, marginBottom: spacing.xs,
  },
  takeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  takeInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontFamily: fontFamily.semiBold, fontSize: 22, color: colors.text,
    minWidth: 84, textAlign: 'center',
  },
  takeOf: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textSecondary },
  takeAll: {
    fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.text,
    textDecorationLine: 'underline',
  },
  destRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  destChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md, paddingVertical: 7,
  },
  destChipOn: { backgroundColor: colors.text, borderColor: colors.text },
  destChipText: {
    fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textSecondary,
  },
  destChipTextOn: { color: colors.textOnPrimary },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },

  modeToggle: {
    flexDirection: 'row',
    margin: spacing.lg,
    marginBottom: 0,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: borderRadius.full,
  },
  modeBtnActive: {
    backgroundColor: colors.text,
  },
  modeBtnReject: {
    backgroundColor: '#ef4444',
  },
  modeBtnText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  modeBtnTextActive: {
    color: '#fff',
  },

  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
    flexWrap: 'nowrap',
    marginTop: spacing.lg,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    flex: 1,
    minWidth: 0,
  },
  pillFilled: {
    borderColor: colors.success,
    backgroundColor: '#F0FDF4',
  },
  pillLocked: {
    borderColor: '#f59e0b',
    backgroundColor: '#FFFBEB',
  },
  lockBtn: {
    padding: 6,
  },
  pillLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    color: colors.textMuted,
    flex: 1,
    numberOfLines: 1,
  } as any,
  pillLabelFilled: {
    color: colors.success,
  },
  pillLabelLocked: {
    color: '#f59e0b',
  },
  pillConnector: {
    width: 12,
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 2,
  },
  pillConnectorDone: {
    backgroundColor: colors.success,
  },

  scanSection: {
    marginBottom: spacing.sm,
  },
  balanceLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  balanceLoadingText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },

  balanceCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
  },
  balanceLabel: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  balanceValue: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  balanceDivider: {
    height: 1,
    backgroundColor: colors.border,
  },
  balanceStats: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.sm,
  },
  balanceStat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  balanceStatHighlight: {
    backgroundColor: '#FEF2F2',
    borderRadius: borderRadius.sm,
    paddingVertical: 6,
  },
  balanceStatNum: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.lg,
    color: colors.text,
  },
  balanceStatNumHighlight: {
    color: '#ef4444',
  },
  balanceStatLabel: {
    fontFamily: fontFamily.regular,
    fontSize: 10,
    color: colors.textMuted,
  },
  balanceStatLabelHighlight: {
    color: '#ef4444',
  },

  qtySection: {
    marginBottom: spacing.md,
  },
  qtyLabel: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  qtyBtn: {
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyInput: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamily.semiBold,
    fontSize: 24,
    color: colors.text,
    paddingVertical: spacing.sm,
  },

  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: '#ef4444',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  manualSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: '#fff',
  },

  modeBtnPool: {
    backgroundColor: '#6366f1',
  },

  // Reject reason chips
  reasonSection: {
    marginBottom: spacing.md,
  },
  reasonLabel: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  reasonReq: {
    color: '#ef4444',
  },
  reasonInput: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.text,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: '#ef4444',
    borderColor: '#ef4444',
  },
  chipText: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    color: colors.text,
  },
  chipTextActive: {
    color: '#fff',
  },

  // Pool mode
  poolBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  poolVarietyText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
    flex: 1,
  },
  poolBadge: {
    backgroundColor: '#F0FDF4',
    borderRadius: borderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.success,
  },
  poolBadgeText: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    color: colors.success,
  },
  poolCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    padding: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  poolCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  poolCardTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
    flex: 1,
  },
  poolCardMax: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  poolDestCol: {
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  poolDestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
  poolDestRowOn: {
    borderColor: '#6366f1',
    backgroundColor: '#EEF2FF',
  },
  poolDestLabel: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  poolDestLabelOn: {
    fontFamily: fontFamily.semiBold,
    color: '#3730A3',
  },
  poolDestHint: {
    fontFamily: fontFamily.regular,
    fontSize: 11,
    color: colors.textMuted,
  },
  poolCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: '#6366f1',
    borderRadius: borderRadius.md,
    paddingVertical: 12,
    marginTop: spacing.xs,
  },
  poolChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  poolChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  poolChipOn: {
    borderColor: '#6366f1',
    backgroundColor: '#EEF2FF',
  },
  poolChipText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  poolChipTextOn: {
    color: '#4338CA',
    fontFamily: fontFamily.semiBold,
  },
  poolEmptyText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    flex: 1,
  },
  poolSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: '#6366f1',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },

  // Bouquet mode
  bouquetBanner: {
    backgroundColor: colors.primaryMuted,
    padding: spacing.xs,
    alignItems: 'center',
  },
  bouquetBannerText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.primary,
  },

  // Remainder modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    width: '100%',
    maxWidth: 320,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  modalTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
  },
  modalBody: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  modalHighlight: {
    fontFamily: fontFamily.semiBold,
    color: colors.text,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  modalSkip: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  modalSkipText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  modalPool: {
    flex: 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPoolText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.textOnPrimary ?? '#fff',
  },
});