import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { addToSyncQueue } from '../database/sync-queue';
import { getFarm } from '../database/settings';
import { addGradingEntry } from '../database/grading';
import { submitGrading, getBucketBalance, submitBucketReject } from '../services/api';
import {
  detectGradingQRType,
  extractGradingQRValue,
} from '../utils/grading-utils';
import ScanInput from '../components/ScanInput';
import GradingEntryComponent from '../components/GradingEntry';
import SyncBanner from '../components/SyncBanner';
import ScanConfirmation from '../components/ScanConfirmation';
import EntriesLog from '../components/EntriesLog';
import { GradedEntry, BucketBalance } from '../types';
import { onScanSuccess, onScanError } from '../utils/feedback';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

type SlotKey = 'bunch' | 'grader' | 'bucket';
const SLOT_ORDER: SlotKey[] = ['bunch', 'grader', 'bucket'];

const SLOT_META: Record<SlotKey, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  bunch: { label: 'Bunch', icon: 'leaf-outline' },
  grader: { label: 'Grader', icon: 'person-outline' },
  bucket: { label: 'Bucket', icon: 'archive-outline' },
};

type Mode = 'grade' | 'rejects';

export default function GradeScreen() {
  const { isConnected, refreshStats } = useApp();

  // ── Grade mode state ──────────────────────────────────────────
  const [slots, setSlots] = useState<Record<SlotKey, string | null>>({ bunch: null, grader: null, bucket: null });
  const [entries, setEntries] = useState<GradedEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const forcedSlotRef = useRef<SlotKey | null>(null);

  // ── Rejects mode state ────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('grade');
  const [rejBucketId, setRejBucketId] = useState<string | null>(null);
  const [rejGrader, setRejGrader] = useState<string | null>(null);
  const [rejQty, setRejQty] = useState<string>('');
  const [bucketBalance, setBucketBalance] = useState<BucketBalance | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [rejSubmitting, setRejSubmitting] = useState(false);
  const [rejSlot, setRejSlot] = useState<'bucket' | 'grader'>('bucket');

  // ── Shared confirmation ───────────────────────────────────────
  const [confirmation, setConfirmation] = useState<{ visible: boolean; type: 'success' | 'error'; message: string }>(
    { visible: false, type: 'success', message: '' }
  );

  const showConfirmation = (type: 'success' | 'error', message: string) =>
    setConfirmation({ visible: true, type, message });

  // ── Grade mode handlers ───────────────────────────────────────
  const resetSlots = useCallback(() => {
    setSlots({ bunch: null, grader: null, bucket: null });
    forcedSlotRef.current = null;
  }, []);

  const handleScanned = useCallback(async (data: string) => {
    if (submitting) return;
    const value = extractGradingQRValue(data);
    if (!value) return;

    let detected = detectGradingQRType(data);
    if (forcedSlotRef.current) { detected = forcedSlotRef.current; forcedSlotRef.current = null; }
    if (detected === 'unknown') {
      const next = SLOT_ORDER.find((s) => !slots[s]);
      if (!next) return;
      detected = next;
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
      resetSlots();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, submitting, resetSlots]);

  const doSubmit = async (bunchId: string, graderId: string, bucketId: string) => {
    const now = new Date().toLocaleTimeString();
    const farm = await getFarm();

    if (isConnected) {
      try {
        const response = await submitGrading(bunchId, graderId, bucketId, farm);
        await addGradingEntry(bunchId, graderId, bucketId, farm, response.variety ?? '', response.stem_length ?? '', response.qty ?? 0, true);
        setEntries((prev) => [{ bunch_id: bunchId, grader: graderId, bucket_id: bucketId, variety: response.variety ?? '', stem_length: response.stem_length ?? '', qty: response.qty ?? 0, time: now, status: 'success', message: `${response.qty} stems` }, ...prev]);
        await refreshStats();
        onScanSuccess();
        showConfirmation('success', `Graded: ${response.qty ?? 0} stems`);
      } catch (error: any) {
        await addToSyncQueue('mobile_grading_entry', { bunch_id: bunchId, grader: graderId, bucket_id: bucketId, farm });
        await addGradingEntry(bunchId, graderId, bucketId, farm, '', '', 0, false);
        setEntries((prev) => [{ bunch_id: bunchId, grader: graderId, bucket_id: bucketId, variety: '', stem_length: '', qty: 0, time: now, status: 'error', message: error.message }, ...prev]);
        await refreshStats();
        onScanError();
        showConfirmation('error', error.message);
      }
    } else {
      await addToSyncQueue('mobile_grading_entry', { bunch_id: bunchId, grader: graderId, bucket_id: bucketId, farm });
      await addGradingEntry(bunchId, graderId, bucketId, farm, '', '', 0, false);
      setEntries((prev) => [{ bunch_id: bunchId, grader: graderId, bucket_id: bucketId, variety: '', stem_length: '', qty: 0, time: now, status: 'queued', message: 'Saved offline' }, ...prev]);
      await refreshStats();
      onScanSuccess();
      showConfirmation('success', 'Saved offline');
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
    setRejSubmitting(true);
    try {
      const farm = await getFarm();
      const resp = await submitBucketReject(rejBucketId, rejGrader, qty, farm);
      await refreshStats();
      onScanSuccess();
      showConfirmation('success', `${qty} rejects recorded. ${resp.remaining_stems} stems remaining.`);
      resetRejects();
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
      </View>

      {mode === 'grade' ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Slot pills */}
          <View style={styles.pillRow}>
            {SLOT_ORDER.map((slot, i) => {
              const filled = !!slots[slot];
              return (
                <React.Fragment key={slot}>
                  {i > 0 && <View style={[styles.pillConnector, filled && i <= filledCount ? styles.pillConnectorDone : null]} />}
                  <TouchableOpacity
                    style={[styles.pill, filled ? styles.pillFilled : null]}
                    onPress={() => { if (!filled) forcedSlotRef.current = slot; }}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={filled ? 'checkmark-circle' : SLOT_META[slot].icon}
                      size={14}
                      color={filled ? colors.success : colors.textMuted}
                    />
                    <Text style={[styles.pillLabel, filled && styles.pillLabelFilled]}>
                      {filled ? slots[slot]! : SLOT_META[slot].label}
                    </Text>
                    {filled && (
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
              placeholder={allFilled ? 'Submitting…' : 'Scan bunch / grader / bucket'}
              scannerTitle="Scan QR Code"
              onScan={handleScanned}
              disabled={submitting || allFilled}
            />
          </View>

          <EntriesLog
            entries={entries}
            label="entry"
            renderEntry={(entry, idx) => (
              <GradingEntryComponent entry={entry} index={idx} />
            )}
          />
        </ScrollView>
      ) : (
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
                <Text style={styles.balanceValue}>{bucketBalance.variety || '—'}</Text>
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
      )}

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
});
