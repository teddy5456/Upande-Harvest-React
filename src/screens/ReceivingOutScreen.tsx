import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { getFarm } from '../database/settings';
import { submitReceivingOut, submitBucketReject } from '../services/api';
import { QUALITY_REASONS, RECEIVING_OUT_REASONS } from '../types';
import {
  detectGradingQRType,
  extractGradingQRValue,
  parseScannedGraderQR,
  parseScannedGradingBucketQR,
} from '../utils/grading-utils';
import ScanInput from '../components/ScanInput';
import ScanConfirmation from '../components/ScanConfirmation';
import EntriesLog from '../components/EntriesLog';
import VarietyBanner from '../components/VarietyBanner';
import { onScanSuccess, onScanError } from '../utils/feedback';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

type SlotKey = 'bucket' | 'grader';
const SLOT_ORDER: SlotKey[] = ['bucket', 'grader'];

const SLOT_META: Record<SlotKey, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  bucket: { label: 'Bucket', icon: 'archive-outline' },
  grader: { label: 'Grader', icon: 'person-outline' },
};

type LogEntry = {
  bucket: string;
  grader: string;
  variety?: string;
  remaining_qty?: number;
  from_storage_box?: string | null;
  time: string;
  status: 'success' | 'error' | 'cancelled';
  message?: string;
};

export default function ReceivingOutScreen() {
  const { isConnected, storageMode } = useApp();
  const [slots, setSlots] = useState<Record<SlotKey, string | null>>({ bucket: null, grader: null });
  const [submitting, setSubmitting] = useState(false);
  const [lastIssued, setLastIssued] = useState<{
    bucket: string; grader: string; variety: string; stems: number | null;
  } | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [confirmation, setConfirmation] = useState<{
    visible: boolean;
    type: 'success' | 'error' | 'queued';
    message: string;
    title?: string;
  }>({ visible: false, type: 'success', message: '' });
  // Replace prompt — custom modal because Alert.alert can't size the
  // remaining-qty prominently. Graders kept "Replace anyway"-ing on full
  // buckets because the number was buried in a wall of text.
  const [replacePrompt, setReplacePrompt] = useState<{
    visible: boolean;
    priorBucket: string;
    priorRemaining: number;
    priorVariety?: string;
    newBucket: string;
    newGrader: string;
  } | null>(null);
  // Reject-reasons rows for the Reject Bucket modal. Empty until the operator
  // taps a reason chip. Each row is one reason + its share of the prior
  // remaining qty. Sum of qtys must equal priorRemaining before the Reject
  // Bucket button unlocks.
  const [rejectRows, setRejectRows] = useState<{ reason: string; qty: string }[]>([]);
  // Free-text captured when the operator picks the "Other" reason; sent in
  // place of the literal "Other" for those rows.
  const [otherText, setOtherText] = useState('');
  const resolveReason = (r: string) => (r === 'Other' ? otherText.trim() : r);
  // Reset the reject rows every time the modal opens so a stale distribution
  // from a previous prompt doesn't bleed into the next scan.
  useEffect(() => {
    if (replacePrompt?.visible) { setRejectRows([]); setOtherText(''); }
  }, [replacePrompt?.visible]);

  const forcedSlotRef = useRef<SlotKey | null>(null);

  const showConfirmation = (
    type: 'success' | 'error' | 'queued',
    message: string,
    title?: string,
  ) => setConfirmation({ visible: true, type, message, title });

  const resetSlots = useCallback(() => setSlots({ bucket: null, grader: null }), []);

  const handleScanned = useCallback((raw: string) => {
    if (!raw) return;
    let detected = detectGradingQRType(raw);
    if (forcedSlotRef.current) {
      detected = forcedSlotRef.current as any;
      forcedSlotRef.current = null;
    }

    // Route to a slot
    let target: SlotKey | null = null;
    if (detected === 'bucket') target = 'bucket';
    else if (detected === 'grader') target = 'grader';
    else {
      // Unknown — fill next empty slot in canonical order
      target = SLOT_ORDER.find((s) => !slots[s]) || null;
    }
    if (!target) return;

    const value =
      target === 'bucket'
        ? parseScannedGradingBucketQR(raw) || extractGradingQRValue(raw)
        : parseScannedGraderQR(raw) || extractGradingQRValue(raw);

    if (!value) {
      onScanError();
      showConfirmation('error', `Could not read ${SLOT_META[target].label} QR`);
      return;
    }

    onScanSuccess();
    setSlots((prev) => ({ ...prev, [target!]: value }));
    showConfirmation('success', `${SLOT_META[target].label}: ${value}`);
  }, [slots]);

  // Single submission path used by both the manual button and the
  // confirmation-dialog re-submission. Kept defensive: every state mutation
  // is wrapped, and the entries log captures both success and error so the
  // operator can see what happened.
  const submitOnce = useCallback(async (
    bucket: string,
    grader: string,
    confirm?: 'reject' | 'cancel',
  ) => {
    const now = new Date().toLocaleTimeString();
    const farm = (await getFarm()) || '';
    let res;
    try {
      res = await submitReceivingOut(bucket, grader, farm, confirm);
    } catch (e: any) {
      setEntries((prev) => [{
        bucket, grader,
        time: now, status: 'error',
        message: e?.message || 'Submission failed',
      }, ...prev]);
      onScanError();
      Alert.alert('Receiving Out failed', e?.message || 'Unknown error');
      return;
    }

    // Backend wants the operator to choose what to do with the prior bucket
    if (res?.needs_confirmation) {
      setReplacePrompt({
        visible: true,
        priorBucket:    res.prior_bucket_id || '',
        priorRemaining: res.prior_remaining_qty ?? 0,
        priorVariety:   res.prior_variety,
        newBucket:      bucket,
        newGrader:      grader,
      });
      return;
    }

    // Same grader rescans the same bucket they already hold → neutral feedback,
    // no new entry logged.
    if (res?.already_open) {
      showConfirmation(
        'queued',
        `${grader} already holds ${bucket} (${res?.remaining_qty ?? '?'} stems left). No change.`,
        'Already issued',
      );
      resetSlots();
      return;
    }

    const fromBox = res?.from_storage_box || null;
    // A grader taking a bucket needs to know what is in it before they cut a
    // single bunch — it only ever appeared inside a toast that vanishes.
    if (!res?.cancelled) {
      setLastIssued({
        bucket: fromBox ? (res?.bucket_id || bucket) : bucket,
        grader,
        variety: res?.variety || '',
        stems: res?.remaining_qty ?? null,
      });
    }
    setEntries((prev) => [{
      bucket: fromBox ? (res?.bucket_id || bucket) : bucket,
      grader,
      variety: res?.variety,
      remaining_qty: res?.remaining_qty,
      from_storage_box: fromBox,
      time: now,
      status: res?.cancelled ? 'cancelled' : 'success',
      message: res?.cancelled
        ? `Kept ${res?.bucket_id}`
        : `${res?.remaining_qty ?? '?'} stems${res?.variety ? ` · ${res.variety}` : ''}${fromBox ? ` · from ${fromBox}` : ''}`,
    }, ...prev]);
    showConfirmation(
      'success',
      res?.cancelled
        ? `Kept ${res?.bucket_id}; ${bucket} not issued.`
        : fromBox
          ? `From ${fromBox} → bucket ${res?.bucket_id} → ${grader}`
          : `Bucket ${bucket} → ${grader}`,
    );
    resetSlots();
  }, [resetSlots]);

  const submit = useCallback(async () => {
    if (!slots.bucket || !slots.grader) {
      showConfirmation('error', 'Scan both a bucket and a grader before submitting.');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      await submitOnce(slots.bucket, slots.grader);
    } finally {
      setSubmitting(false);
    }
  }, [slots, submitting, submitOnce]);

  // Receiving Out is the bucket↔grader binding in ALL storage modes. In
  // Shelving / Zoning it physically takes the bucket off the shelf; in DTG
  // it's the only handoff step. No mode-off screen needed.

  const filledCount = SLOT_ORDER.filter((s) => slots[s]).length;
  const canSubmit = !!slots.bucket && !!slots.grader && !submitting;

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Slot pills — same idiom as GradeScreen */}
        <View style={styles.pillRow}>
          {SLOT_ORDER.map((slot, i) => {
            const filled = !!slots[slot];
            return (
              <React.Fragment key={slot}>
                {i > 0 && (
                  <View style={[styles.pillConnector, filled && i <= filledCount ? styles.pillConnectorDone : null]} />
                )}
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
                  <Text style={[styles.pillLabel, filled && styles.pillLabelFilled]} numberOfLines={1}>
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

        {!isConnected && (
          <View style={styles.offlineBadge}>
            <Ionicons name="cloud-offline-outline" size={14} color={colors.warning} />
            <Text style={styles.offlineText}>Offline — Receiving Out cannot queue. Reconnect first.</Text>
          </View>
        )}

        {lastIssued && (
          <VarietyBanner
            variety={lastIssued.variety}
            stems={lastIssued.stems}
            context={`${lastIssued.bucket} → ${lastIssued.grader}`}
          />
        )}

        <View style={styles.scanSection}>
          <ScanInput
            placeholder={submitting ? 'Submitting…' : 'Scan bucket / grader'}
            scannerTitle="Scan QR Code"
            onScan={handleScanned}
            keepFocused
          />
        </View>

        {canSubmit && (
          <TouchableOpacity
            style={[styles.manualSubmitBtn, submitting && styles.submitBtnDisabled]}
            onPress={submit}
            disabled={!canSubmit}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                <Text style={styles.submitBtnText}>Confirm Receiving Out</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <EntriesLog
          entries={entries}
          label="hand-off"
          renderEntry={(e, idx) => (
            <View
              key={idx}
              style={[
                styles.logRow,
                e.status === 'error' && styles.logRowError,
                e.status === 'cancelled' && styles.logRowCancelled,
              ]}
            >
              <Ionicons
                name={
                  e.status === 'success' ? 'checkmark-circle' :
                  e.status === 'cancelled' ? 'remove-circle' :
                  'alert-circle'
                }
                size={18}
                color={
                  e.status === 'success' ? colors.success :
                  e.status === 'cancelled' ? colors.warning :
                  colors.error
                }
              />
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                {e.variety ? (
                  <VarietyBanner size="sm" variety={e.variety} stems={e.remaining_qty ?? null} />
                ) : null}
                <View style={styles.logBucketRow}>
                  <Text style={styles.logBucket}>{e.bucket} → {e.grader}</Text>
                  {e.from_storage_box ? (
                    <View style={styles.stgBadge}>
                      <Ionicons name="archive-outline" size={10} color={colors.primary} />
                      <Text style={styles.stgBadgeText}>{e.from_storage_box}</Text>
                    </View>
                  ) : null}
                </View>
                {e.message ? <Text style={styles.logMessage}>{e.message}</Text> : null}
              </View>
              <Text style={styles.logTime}>{e.time}</Text>
            </View>
          )}
        />
      </ScrollView>

      <ScanConfirmation
        visible={confirmation.visible}
        type={confirmation.type}
        message={confirmation.message}
        title={confirmation.title}
        onDismiss={() => setConfirmation((c) => ({ ...c, visible: false }))}
      />

      {/* Replace bucket prompt — big "X stems still in bucket" front-and-centre */}
      <Modal
        visible={!!replacePrompt?.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setReplacePrompt(null)}
      >
        <View style={styles.replaceBackdrop}>
          <View style={styles.replaceCard}>
            <View style={styles.replaceIconWrap}>
              <Ionicons name="alert-circle" size={36} color={colors.warning} />
            </View>
            <Text style={styles.replaceQty}>
              {replacePrompt?.priorRemaining ?? 0}
            </Text>
            <Text style={styles.replaceQtyLabel}>stems still in bucket</Text>
            <Text style={styles.replaceBucket}>{replacePrompt?.priorBucket}</Text>
            {replacePrompt?.priorVariety ? (
              <Text style={styles.replaceVariety}>{replacePrompt.priorVariety}</Text>
            ) : null}
            <View style={styles.replaceDivider} />
            <Text style={styles.replaceQuestion}>
              Switching to <Text style={{ fontFamily: fontFamily.semiBold, color: colors.text }}>
                {replacePrompt?.newBucket}
              </Text>
            </Text>
            <Text style={styles.replaceHint}>
              Pick reason(s) for the {replacePrompt?.priorRemaining ?? 0} leftover stems.
              Tap a chip to add it; total must match remaining.
            </Text>

            {/* Reason chips — tap to add a row (or remove if already added) */}
            <View style={styles.rejectChipsWrap}>
              {RECEIVING_OUT_REASONS.map((r) => {
                const already = rejectRows.some(row => row.reason === r);
                return (
                  <TouchableOpacity
                    key={r}
                    style={[styles.rejectChip, already && styles.rejectChipActive]}
                    activeOpacity={0.7}
                    onPress={() => {
                      setRejectRows(prev => {
                        const idx = prev.findIndex(x => x.reason === r);
                        if (idx >= 0) return prev.filter((_, i) => i !== idx);
                        // First reason added: default to full remaining. Any
                        // additional reason starts at 0 so the operator can
                        // redistribute manually without over-counting.
                        const isFirst = prev.length === 0;
                        const remaining = replacePrompt?.priorRemaining ?? 0;
                        return [...prev, { reason: r, qty: isFirst ? String(remaining) : '0' }];
                      });
                    }}
                  >
                    <Text style={[styles.rejectChipText, already && styles.rejectChipTextActive]}>
                      {r}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {rejectRows.some((r) => r.reason === 'Other') && (
              <TextInput
                style={styles.otherReasonInput}
                value={otherText}
                onChangeText={setOtherText}
                placeholder="Type the other reason"
                placeholderTextColor={colors.textMuted}
              />
            )}

            {/* Per-reason qty rows */}
            {rejectRows.length > 0 && (
              <View style={styles.rejectRowsWrap}>
                {rejectRows.map((row, idx) => (
                  <View key={row.reason} style={styles.rejectRow}>
                    <Text style={styles.rejectRowLabel} numberOfLines={1}>{row.reason}</Text>
                    <TextInput
                      style={styles.rejectQtyInput}
                      value={row.qty}
                      onChangeText={(t) => {
                        const clean = (t || '').replace(/[^0-9]/g, '');
                        setRejectRows(prev => prev.map((r, i) => i === idx ? { ...r, qty: clean } : r));
                      }}
                      keyboardType="number-pad"
                      maxLength={5}
                      selectTextOnFocus
                    />
                    <Text style={styles.rejectRowUnit}>stems</Text>
                    <TouchableOpacity
                      onPress={() => setRejectRows(prev => prev.filter((_, i) => i !== idx))}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ))}
                {(() => {
                  const total = rejectRows.reduce((s, r) => s + (parseInt(r.qty, 10) || 0), 0);
                  const expected = replacePrompt?.priorRemaining ?? 0;
                  const balanced = total === expected;
                  return (
                    <Text style={[styles.rejectTotal, !balanced && styles.rejectTotalOff]}>
                      Total {total} / {expected}
                      {!balanced ? ' — must match' : ''}
                    </Text>
                  );
                })()}
              </View>
            )}

            <View style={styles.replaceActions}>
              <TouchableOpacity
                style={[styles.replaceBtn, styles.replaceBtnKeep]}
                onPress={() => {
                  const prior = replacePrompt?.priorBucket;
                  setReplacePrompt(null);
                  setRejectRows([]);
                  setOtherText('');
                  showConfirmation('queued', `Kept ${prior}`, 'No change');
                  resetSlots();
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="arrow-undo-outline" size={18} color={colors.text} />
                <Text style={styles.replaceBtnKeepText}>
                  Keep {replacePrompt?.priorBucket}
                </Text>
              </TouchableOpacity>
              {(() => {
                const total = rejectRows.reduce((s, r) => s + (parseInt(r.qty, 10) || 0), 0);
                const expected = replacePrompt?.priorRemaining ?? 0;
                const disabled = rejectRows.length === 0 || total !== expected || submitting;
                return (
                  <TouchableOpacity
                    style={[styles.replaceBtn, styles.replaceBtnSwitch, disabled && styles.replaceBtnDisabled]}
                    disabled={disabled}
                    onPress={async () => {
                      const data = replacePrompt;
                      if (!data) return;
                      const validRows = rejectRows.filter(r => r.reason && (parseInt(r.qty, 10) || 0) > 0);
                      // Placed before setSubmitting(true) so the modal stays
                      // open for the operator to fill in the free-text reason;
                      // no submitting-flag reset needed on this early return.
                      if (validRows.some((r) => r.reason === 'Other') && !otherText.trim()) {
                        showConfirmation('error', 'Type the reason for “Other”');
                        return;
                      }
                      setReplacePrompt(null);
                      setSubmitting(true);
                      try {
                        const farm = (await getFarm()) || '';
                        // Post one Grading Reject per reason against the prior
                        // bucket. Doing this BEFORE confirm=reject keeps the
                        // grader as the holder of the prior bucket, which
                        // submit_bucket_reject requires.
                        for (const row of validRows) {
                          await submitBucketReject(
                            data.priorBucket,
                            data.newGrader,
                            parseInt(row.qty, 10),
                            farm,
                            resolveReason(row.reason),
                          );
                        }
                        // Close prior + open new (confirm=reject on the server
                        // marks the prior Receiving Out closed as 'Replaced').
                        await submitOnce(data.newBucket, data.newGrader, 'reject');
                        setRejectRows([]);
                        setOtherText('');
                      } catch (e: any) {
                        showConfirmation('error', e?.message || 'Reject failed');
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="close-circle" size={18} color="#fff" />
                    <Text style={styles.replaceBtnSwitchText}>Reject bucket</Text>
                  </TouchableOpacity>
                );
              })()}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },

  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
    flexWrap: 'nowrap',
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
  },
  pillLabelFilled: { color: colors.success },
  pillConnector: {
    width: 12,
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 2,
  },
  pillConnectorDone: { backgroundColor: colors.success },

  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF7ED',
    borderColor: '#FDE68A',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginBottom: spacing.sm,
  },
  offlineText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.warning,
  },

  scanSection: { marginBottom: spacing.sm },

  manualSubmitBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: {
    color: '#fff',
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
  },

  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  logRowError: { backgroundColor: '#FEF2F2' },
  logRowCancelled: { backgroundColor: '#FFFBEB' },
  logBucketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  logBucket: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  stgBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#F5F5F5',
    borderRadius: borderRadius.full,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stgBadgeText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 9,
    color: colors.primary,
    letterSpacing: 0.3,
  },
  logMessage: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  logTime: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },

  modeOffWrap: {
    flex: 1,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  modeOffTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.lg,
    color: colors.text,
  },
  modeOffBody: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },

  // ── Replace prompt modal ────────────────────────────────────────────
  replaceBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  replaceCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  replaceIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  replaceQty: {
    fontFamily: fontFamily.bold,
    fontSize: 56,
    color: colors.text,
    letterSpacing: -2,
    lineHeight: 60,
  },
  replaceQtyLabel: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginTop: 2,
  },
  replaceBucket: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.lg,
    color: colors.text,
    marginTop: spacing.md,
  },
  replaceVariety: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  replaceDivider: {
    height: 1,
    backgroundColor: colors.border,
    alignSelf: 'stretch',
    marginVertical: spacing.lg,
  },
  replaceQuestion: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.text,
    textAlign: 'center',
  },
  replaceHint: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 16,
  },
  replaceActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    alignSelf: 'stretch',
  },
  replaceBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
  },
  replaceBtnKeep: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  replaceBtnKeepText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  replaceBtnSwitch: {
    backgroundColor: colors.text,
  },
  replaceBtnSwitchText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: '#fff',
  },
  replaceBtnDisabled: {
    opacity: 0.4,
  },

  // ── Reject Bucket reason UI ─────────────────────────────────────────
  rejectChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.md,
    alignSelf: 'stretch',
  },
  rejectChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  rejectChipActive: {
    backgroundColor: colors.error || '#dc2626',
    borderColor: colors.error || '#dc2626',
  },
  rejectChipText: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    color: colors.text,
  },
  rejectChipTextActive: {
    color: '#fff',
  },
  otherReasonInput: {
    alignSelf: 'stretch',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  rejectRowsWrap: {
    alignSelf: 'stretch',
    marginTop: spacing.sm,
    gap: 6,
  },
  rejectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  rejectRowLabel: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.text,
  },
  rejectQtyInput: {
    width: 60,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.text,
    textAlign: 'center',
  },
  rejectRowUnit: {
    fontFamily: fontFamily.regular,
    fontSize: 11,
    color: colors.textMuted,
  },
  rejectTotal: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 4,
    textAlign: 'right',
  },
  rejectTotalOff: {
    color: colors.error || '#dc2626',
  },
});
