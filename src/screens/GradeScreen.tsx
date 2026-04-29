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
import { submitGrading, getBucketBalance, submitBucketReject, addToPool, gradeFromPool, getBunchInfo, getBouquetRecipeForBunch, submitBouquetGrading } from '../services/api';
import {
  detectGradingQRType,
  extractGradingQRValue,
} from '../utils/grading-utils';
import BouquetRecipeCard, { BouquetVarietyState } from '../components/BouquetRecipe';
import { BouquetRecipe } from '../types';
import ScanInput from '../components/ScanInput';
import GradingEntryComponent from '../components/GradingEntry';
import SyncBanner from '../components/SyncBanner';
import ScanConfirmation from '../components/ScanConfirmation';
import EntriesLog from '../components/EntriesLog';
import { GradedEntry, BucketBalance, stripStemLength } from '../types';
import { QUALITY_REASONS } from '../types';
import { onScanSuccess, onScanError, lockHaptic } from '../utils/feedback';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

type SlotKey = 'bunch' | 'grader' | 'bucket';
const SLOT_ORDER: SlotKey[] = ['bunch', 'grader', 'bucket'];

const SLOT_META: Record<SlotKey, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  bunch: { label: 'Bunch', icon: 'leaf-outline' },
  grader: { label: 'Grader', icon: 'person-outline' },
  bucket: { label: 'Bucket', icon: 'archive-outline' },
};

const GRADING_REJECT_REASONS = QUALITY_REASONS.grading_reject;

type Mode = 'grade' | 'rejects' | 'pool';

export default function GradeScreen() {
  const { isConnected, refreshStats } = useApp();

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

    if (newSlots.bunch && newSlots.grader && newSlots.bucket) {
      setSubmitting(true);
      await doSubmit(newSlots.bunch, newSlots.grader, newSlots.bucket);
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

  const doSubmit = async (bunchId: string, graderId: string, bucketId: string) => {
      const now = new Date().toLocaleTimeString();
      const farm = await getFarm();

      // Pull bunch_size + stem_length from ERP. Skip when offline; the request
      // will sit in the queue until we're back online and the server-side
      // mobile_grading_entry script reads these from the DB anyway.
      let bunchSize = '';
      let stemLength = '';
      if (isConnected) {
        try {
          const info = await getBunchInfo(bunchId);
          bunchSize = info.bunch_size;
          stemLength = info.stem_length;
        } catch {
          // Fall through with empty values — server will surface a clearer
          // validation error than we could fabricate here.
        }
      }

      const qtyMatch = bunchSize.match(/\d+/);
      const qty = qtyMatch ? parseInt(qtyMatch[0], 10) : 0;

      const payload = {
        bucket_id: bucketId,
        bunch_id: bunchId,
        bunch_size: bunchSize,
        farm,
        grader: graderId,
        qty,
        stem_length: stemLength,
        variety: '',
      };

      if (isConnected) {
        try {
          const response = await submitGrading(payload);

          await addGradingEntry(bunchId, graderId, bucketId, farm, response.variety ?? '', response.stem_length ?? '', response.qty ?? 0, true);
          setEntries((prev) => [{ bunch_id: bunchId, grader: graderId, bucket_id: bucketId, variety: response.variety ?? '', stem_length: response.stem_length ?? '', qty: response.qty ?? 0, time: now, status: 'success', message: `${response.qty} stems` }, ...prev]);
          await refreshStats();
          onScanSuccess();
          showConfirmation('success', `Graded: ${response.qty ?? 0} stems`);

          if (isConnected) {
            try {
              const balance = await getBucketBalance(bucketId);
              if (balance.remaining_stems > 0) {
                setRemainderModal({
                  visible: true,
                  bucketId,
                  variety: response.source_item ?? response.variety ?? '',
                  stems: balance.remaining_stems,
                  bunchSize: response.qty ?? 10,
                });
              }
            } catch { }
          }
        } catch (error: any) {
          await addToSyncQueue('mobile_grading_entry', payload);
          await addGradingEntry(bunchId, graderId, bucketId, farm, '', '', 0, false);
          setEntries((prev) => [{ bunch_id: bunchId, grader: graderId, bucket_id: bucketId, variety: '', stem_length: '', qty: 0, time: now, status: 'error', message: error.message }, ...prev]);
          await refreshStats();
          onScanError();
          showConfirmation('error', error.message);
        }
      } else {
        await addToSyncQueue('mobile_grading_entry', payload);
        await addGradingEntry(bunchId, graderId, bucketId, farm, '', '', 0, false);
        setEntries((prev) => [{ bunch_id: bunchId, grader: graderId, bucket_id: bucketId, variety: '', stem_length: '', qty: 0, time: now, status: 'queued', message: 'Saved offline' }, ...prev]);
        await refreshStats();
        onScanSuccess();
        showConfirmation('success', 'Saved offline');
      }
    };

  // ── Remainder modal handlers ──────────────────────────────────
  const handleAddToPool = async () => {
    const { bucketId, variety, stems, bunchSize } = remainderModal;
    const farm = await getFarm();
    const grader = slots.grader ?? '';
    setAddingToPool(true);
    try {
      const resp = await addToPool(bucketId, variety, farm, grader, stems, bunchSize);
      setPoolBalance(resp.pooled_stems);
      if (poolVariety !== variety) setPoolVariety(variety);
      setRemainderModal((p) => ({ ...p, visible: false }));
      showConfirmation('success', `${stems} stems added to pool (${resp.pooled_stems} total)`);
    } catch (err: any) {
      showConfirmation('error', err.message);
    } finally {
      setAddingToPool(false);
    }
  };

  // ── Pool mode handlers ────────────────────────────────────────
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

  const handlePoolSubmit = async () => {
    if (!poolBunchId || !poolGrader || !poolVariety) {
      showConfirmation('error', !poolVariety ? 'No active pool — add remainder stems first' : 'Scan bunch and grader first');
      return;
    }
    setPoolSubmitting(true);
    try {
      const farm = await getFarm();
      const resp = await gradeFromPool(poolBunchId, poolGrader, farm, poolVariety);
      setPoolBalance(resp.pooled_stems);
      await refreshStats();
      onScanSuccess();
      showConfirmation('success', `Pool bunch graded. ${resp.pooled_stems} stems remaining.`);
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
    setRejSlot('bucket');
  }, []);

  const handleRejectScan = useCallback(async (data: string) => {
    if (rejSubmitting) return;
    const value = extractGradingQRValue(data) || data.trim();
    if (!value) return;

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
  }, [rejSlot, rejSubmitting]);

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
    setRejSubmitting(true);
    try {
      const farm = await getFarm();
      const resp = await submitBucketReject(rejBucketId, rejGrader, qty, farm, rejReason);
      await refreshStats();
      onScanSuccess();
      showConfirmation('success', `${qty} rejects recorded. ${resp.remaining_stems} stems remaining.`);
      resetRejects();
      setRejReason('');
    } catch (err: any) {
      onScanError();
      showConfirmation('error', err.message);
    } finally {
      setRejSubmitting(false);
    }
  };

  const filledCount = SLOT_ORDER.filter((s) => slots[s]).length;
  const allFilled = filledCount === 3;

  return (
    <View style={styles.container}>
      <SyncBanner />

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
          onPress={() => { setMode('rejects'); resetRejects(); }}
          activeOpacity={0.7}
        >
          <Ionicons name="close-circle-outline" size={14} color={mode === 'rejects' ? '#fff' : colors.textMuted} />
          <Text style={[styles.modeBtnText, mode === 'rejects' && styles.modeBtnTextActive]}>Rejects</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'pool' && styles.modeBtnPool]}
          onPress={() => setMode('pool')}
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
              placeholder={submitting ? 'Submitting…' : 'Scan bunch / grader / bucket'}
              scannerTitle="Scan QR Code"
              onScan={handleScanned}
              keepFocused
            />
          </View>

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

          {/* Step indicators */}
          <View style={styles.pillRow}>
            {(['bucket', 'grader'] as const).map((slot, i) => {
              const value = slot === 'bucket' ? rejBucketId : rejGrader;
              const filled = !!value;
              const label = slot === 'bucket' ? 'Bucket' : 'Grader';
              const icon: keyof typeof Ionicons.glyphMap = slot === 'bucket' ? 'archive-outline' : 'person-outline';
              return (
                <React.Fragment key={slot}>
                  {i > 0 && <View style={[styles.pillConnector, filled ? styles.pillConnectorDone : null]} />}
                  <TouchableOpacity
                    style={[styles.pill, filled ? styles.pillFilled : null]}
                    onPress={() => { if (!filled) setRejSlot(slot); }}
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
                          else { setRejGrader(null); setRejSlot('grader'); }
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
                <Text style={styles.balanceLoadingText}>Fetching bucket balance…</Text>
              </View>
            ) : (
              <ScanInput
                placeholder={
                  !rejBucketId ? 'Scan bucket' :
                  !rejGrader   ? 'Scan grader' :
                  'Ready to submit'
                }
                scannerTitle={!rejBucketId ? 'Scan Bucket' : 'Scan Grader'}
                onScan={handleRejectScan}
                disabled={rejSubmitting || (!!rejBucketId && !!rejGrader)}
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

          {/* Pool variety banner */}
          <View style={styles.poolBanner}>
            {poolVariety ? (
              <>
                <Ionicons name="leaf-outline" size={15} color={colors.success} />
                <Text style={styles.poolVarietyText}>{stripStemLength(poolVariety)}</Text>
                <View style={styles.poolBadge}>
                  <Text style={styles.poolBadgeText}>{poolBalance} stems pooled</Text>
                </View>
              </>
            ) : (
              <Text style={styles.poolEmptyText}>No active pool — grade a bucket first to add remainders</Text>
            )}
          </View>

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
            <Text style={styles.modalBody}>
              <Text style={styles.modalHighlight}>{remainderModal.stems}</Text> stems remaining in{' '}
              <Text style={styles.modalHighlight}>{remainderModal.bucketId}</Text>.
              {'\n'}Add to pool for later grading?
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalSkip}
                onPress={() => setRemainderModal((p) => ({ ...p, visible: false }))}
                activeOpacity={0.7}
              >
                <Text style={styles.modalSkipText}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalPool, addingToPool && styles.submitBtnDisabled]}
                onPress={handleAddToPool}
                disabled={addingToPool}
                activeOpacity={0.8}
              >
                {addingToPool
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.modalPoolText}>Add to Pool</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 360,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  modalTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.lg,
    color: colors.text,
  },
  modalBody: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.textMuted,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  modalHighlight: {
    fontFamily: fontFamily.semiBold,
    color: colors.text,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modalSkip: {
    flex: 1,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  modalSkipText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.md,
    color: colors.textMuted,
  },
  modalPool: {
    flex: 2,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPoolText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: '#fff',
  },
});
