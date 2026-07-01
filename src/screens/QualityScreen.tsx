import React, { useState, useEffect } from 'react';
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
import { getFarm } from '../database/settings';
import { addQualityEntry } from '../database/quality';
import { addQuarantineBatch, getQuarantineBatches, updateQuarantineBatchStatus } from '../database/quarantine';
import { addToSyncQueue } from '../database/sync-queue';
import { submitQualityEntry, getBucketBalance, createQuarantineBatch, fetchQuarantineBatches, resolveQuarantineBatch, fetchPackableVarieties } from '../services/api';
import ScanConfirmation from '../components/ScanConfirmation';
import Dropdown, { DropdownOption } from '../components/Dropdown';
import { getCachedGreenhouses } from '../utils/greenhouse-cache';
import {
  QualitySection,
  QuarantineAction,
  QUALITY_SECTIONS,
  QUALITY_REASONS,
  RejectLine,
  QualityListEntry,
  Greenhouse,
  BucketBalance,
  QuarantineBatchListEntry,
  QuarantineScope,
  PackableVariety,
  stripStemLength,
  extractStemLength,
  setPackableVarieties,
  resolveVarietyToItemCode,
} from '../types';
import { onScanSuccess, onScanError } from '../utils/feedback';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';
import DiscardSection from './quality/DiscardSection';

// ---------------------------------------------------------------------------
// Section config — only what's truly needed per section
// ---------------------------------------------------------------------------
// Note: `discard` is request-driven and renders its own component, so it
// doesn't appear in SECTION_CONFIG — we short-circuit before consulting it.
type FormSection = Exclude<QualitySection, 'discard'>;
const SECTION_CONFIG: Record<FormSection, {
  showGreenhouse: boolean;
  greenhouseRequired: boolean;
  showVariety: boolean;
  showStandaloneVariety: boolean;
  varietyRequired: boolean;
  showBucketId: boolean;
  bucketRequired: boolean;
  showQuarantine: boolean;
  refPlaceholder: string;
}> = {
  field_reject: {
    showGreenhouse: true, greenhouseRequired: true,
    showVariety: true, showStandaloneVariety: false, varietyRequired: false,
    showBucketId: false, bucketRequired: false,
    showQuarantine: false,
    refPlaceholder: '',
  },
  receiving_reject: {
    // Greenhouse/variety come from the bucket — no need to re-enter
    showGreenhouse: false, greenhouseRequired: false,
    showVariety: false, showStandaloneVariety: false, varietyRequired: false,
    showBucketId: true, bucketRequired: false,
    showQuarantine: true,
    refPlaceholder: 'Bucket ID (optional)',
  },
  grading_reject: {
    showGreenhouse: false, greenhouseRequired: false,
    showVariety: false, showStandaloneVariety: false, varietyRequired: false,
    showBucketId: true, bucketRequired: true,
    showQuarantine: false,
    refPlaceholder: 'Bucket ID',
  },
};

type QuarantineScope3 = 'bucket' | 'batch' | 'greenhouse';

function genBatchId(): string {
  return `QB-${Date.now()}`;
}

function statusColor(status: string): string {
  if (status === 'discarded') return colors.error;
  if (status === 'intake') return colors.success;
  return colors.warning;
}
function statusLabel(status: string): string {
  if (status === 'discarded') return 'Discarded';
  if (status === 'intake') return 'Moved to Intake';
  return 'Pending';
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
export default function QualityScreen() {
  const { isConnected } = useApp();
  const [activeSection, setActiveSection] = useState<QualitySection>('field_reject');

  const [greenhouses, setGreenhouses] = useState<Greenhouse[]>([]);
  const [loadingGreenhouses, setLoadingGreenhouses] = useState(false);
  const [packableVarieties, setPackableVarieties] = useState<PackableVariety[]>([]);
  const [loadingPackable, setLoadingPackable] = useState(false);

  // Form
  const [greenhouse, setGreenhouse] = useState('');
  const [variety, setVariety] = useState('');
  const [bucketId, setBucketId] = useState('');
  const [rejectLines, setRejectLines] = useState<RejectLine[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [bucketBalance, setBucketBalance] = useState<BucketBalance | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [recentEntries, setRecentEntries] = useState<QualityListEntry[]>([]);

  // Unified quarantine card (receiving_reject only)
  const [quarantineOn, setQuarantineOn] = useState(false);
  const [quarantineScope, setQuarantineScope] = useState<QuarantineScope3>('bucket');
  const [quarantineGreenhouse, setQuarantineGreenhouse] = useState('');
  const [quarantineAction, setQuarantineAction] = useState<QuarantineAction>('');
  const [submittingQuarantine, setSubmittingQuarantine] = useState(false);

  // Quarantine list modal
  const [listVisible, setListVisible] = useState(false);
  const [batches, setBatches] = useState<QuarantineBatchListEntry[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  const [confirmation, setConfirmation] = useState<{
    visible: boolean; type: 'success' | 'error'; message: string;
  }>({ visible: false, type: 'success', message: '' });

  const show = (type: 'success' | 'error', msg: string) =>
    setConfirmation({ visible: true, type, message: msg });

  // `discard` is request-driven and renders its own component below — guard
  // every lookup that would index by `activeSection` here so a tab swap to
  // Discard never tries to read the form config / reasons.
  const isDiscard = activeSection === 'discard';
  const cfg = isDiscard ? null : SECTION_CONFIG[activeSection as FormSection];
  const reasons = isDiscard ? [] : QUALITY_REASONS[activeSection as FormSection];
  const totalRejects = rejectLines.reduce((s, l) => s + l.quantity, 0);

  useEffect(() => {
    setLoadingGreenhouses(true);
    getCachedGreenhouses()
      .then(setGreenhouses)
      .catch(() => {})
      .finally(() => setLoadingGreenhouses(false));
  }, []);

// Lazy-load packable varieties the first time a section that needs them is opened
useEffect(() => {
  if (!cfg?.showStandaloneVariety || packableVarieties.length > 0 || loadingPackable) return;
  setLoadingPackable(true);
  fetchPackableVarieties()
    .then((resp) => {
      const varieties = resp.varieties ?? [];
      setPackableVarieties(varieties);
      setPackableVarieties(varieties); // Cache in the types module for resolveVarietyToItemCode
    })
    .catch(() => {})
    .finally(() => setLoadingPackable(false));
}, [cfg?.showStandaloneVariety, packableVarieties.length, loadingPackable]);

  const ghOptions: DropdownOption[] = greenhouses.map((g) => ({
    label: g.warehouse_name || g.name,
    value: g.name,
  }));

  const selectedGH = greenhouses.find((g) => g.name === greenhouse);
// Greenhouse-scoped variety list — Quality pages only deal with 50cm
// stock, so hide any 40cm/60cm variants and show a single entry per
// variety. A name without a stem-length suffix is treated as 50cm.
const varietyOptions: DropdownOption[] = (() => {
  if (!selectedGH) return [];
  const seen = new Set<string>();
  const options: DropdownOption[] = [];
  for (const v of selectedGH.custom_varieties_grown ?? []) {
    const len = extractStemLength(v.variety);
    if (len && len !== '50cm') continue;
    const base = stripStemLength(v.variety);
    if (!base || seen.has(base.toLowerCase())) continue;
    seen.add(base.toLowerCase());
    // Use the enhanced resolveVarietyToItemCode which now uses the cache
    const itemCode = resolveVarietyToItemCode(base);
    options.push({ label: base, value: itemCode });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
})();

  // Standalone variety list (dispatch_reject): every 50cm item, displayed
  // without the suffix so the picker just shows "Athena", "Madam Red" …
  const standaloneVarietyOptions: DropdownOption[] = packableVarieties.map((v) => ({
    label: v.display,
    value: v.item_code,
  }));

  const resetForm = () => {
    setGreenhouse(''); setVariety(''); setBucketId('');
    setRejectLines([]); setNotes(''); setBucketBalance(null);
    setQuarantineOn(false); setQuarantineScope('bucket');
    setQuarantineGreenhouse(''); setQuarantineAction('');
  };

  const handleSectionChange = (s: QualitySection) => {
    setActiveSection(s);
    resetForm();
  };

  const fetchBalance = async (id: string) => {
    if (!id.trim() || activeSection !== 'receiving_reject') return;
    setLoadingBalance(true);
    try { setBucketBalance(await getBucketBalance(id.trim())); }
    catch { setBucketBalance(null); }
    finally { setLoadingBalance(false); }
  };

  const toggleReason = (reason: string) => {
    setRejectLines((prev) => {
      const exists = prev.find((l) => l.reason === reason);
      if (exists) return prev.filter((l) => l.reason !== reason);
      const defaultQty = (activeSection === 'grading_reject' || activeSection === 'receiving_reject') && bucketBalance
        ? bucketBalance.remaining_stems : 1;
      return [...prev, { reason, quantity: Math.max(1, defaultQty) }];
    });
  };

  const adjustQty = (reason: string, delta: number) =>
    setRejectLines((prev) =>
      prev.map((l) => l.reason === reason ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l)
    );

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!cfg) return; // discard section has its own submit path
    const quarantineOnly = cfg.showQuarantine && quarantineOn && rejectLines.length === 0;
    if (!quarantineOnly && rejectLines.length === 0) {
      show('error', 'Select at least one reason or toggle Quarantine');
      return;
    }
    if (cfg.greenhouseRequired && !greenhouse.trim()) { show('error', 'Select a greenhouse'); return; }
    if (cfg.bucketRequired && !bucketId.trim()) { show('error', 'Enter bucket ID'); return; }

    if (cfg.varietyRequired && !variety.trim()) { show('error', 'Select a variety'); return; }

    setSubmitting(true);
    const farm = await getFarm();
    const now = new Date().toLocaleTimeString();
    const refId = bucketId.trim() || greenhouse.trim() || 'unknown';
    const gh = greenhouse.trim();
    // Resolve to full item_code (e.g. "Athena" → "Athena 50cm") before submit.
    // Works whether the value already has " 50cm" appended or not.
    const vr = variety.trim() ? resolveVarietyToItemCode(variety.trim()) : '';

    // For receiving_reject with full-greenhouse quarantine scope, quarantine is separate
    // The quality entries themselves are not "quarantined" in that case
    const isQuarantined = cfg.showQuarantine && quarantineOn && quarantineScope !== 'greenhouse';
    const qAction = isQuarantined ? quarantineAction : '';

    let allSuccess = true;
    for (const line of rejectLines) {
      const payload = {
        section: activeSection, ref_id: refId, quantity: line.quantity,
        reason: line.reason, notes, farm, greenhouse: gh, variety: vr,
        quarantined: isQuarantined ? 1 : 0, quarantine_action: qAction,
      };
      if (isConnected) {
        try {
          await submitQualityEntry(activeSection, refId, line.quantity, line.reason, notes, farm, gh, vr, isQuarantined, qAction as QuarantineAction);
          await addQualityEntry(activeSection, refId, line.quantity, line.reason, notes, farm, true, gh, vr, isQuarantined, qAction as QuarantineAction);
        } catch {
          await addToSyncQueue('create_quality_entry', payload);
          await addQualityEntry(activeSection, refId, line.quantity, line.reason, notes, farm, false, gh, vr, isQuarantined, qAction as QuarantineAction);
          allSuccess = false;
        }
      } else {
        await addToSyncQueue('create_quality_entry', payload);
        await addQualityEntry(activeSection, refId, line.quantity, line.reason, notes, farm, false, gh, vr, isQuarantined, qAction as QuarantineAction);
      }
    }

    // If quarantine is on and scope is greenhouse or batch, create the batch record too
    if (cfg!.showQuarantine && quarantineOn) {
      setSubmittingQuarantine(true);
      const batchId = genBatchId();
      const scope: QuarantineScope = quarantineScope === 'greenhouse' ? 'greenhouse' : 'buckets';
      const ghForBatch = quarantineScope === 'greenhouse' ? quarantineGreenhouse : gh;
      const bucketsForBatch = quarantineScope !== 'greenhouse' && refId !== 'unknown' ? [refId] : [];
      const payload = { batch_id: batchId, scope, greenhouse: ghForBatch, bucket_ids: bucketsForBatch, reason: rejectLines.map(l => l.reason).join(', '), notes };
      if (isConnected) {
        try { await createQuarantineBatch(batchId, scope, ghForBatch, bucketsForBatch, payload.reason, notes); }
        catch { await addToSyncQueue('create_quarantine_batch', payload); }
      } else {
        await addToSyncQueue('create_quarantine_batch', payload);
      }
      await addQuarantineBatch(batchId, scope, ghForBatch, bucketsForBatch, payload.reason, notes, isConnected);
      setSubmittingQuarantine(false);
    }

    const summary = rejectLines.length > 0
      ? rejectLines.map((l) => `${l.quantity}×${l.reason}`).join(', ')
      : 'Quarantine';
    setRecentEntries((prev) => [{
      ref_id: refId, quantity: totalRejects, reason: summary, time: now,
      status: !isConnected ? 'queued' : allSuccess ? 'success' : 'error',
    }, ...prev]);

    const successMsg = rejectLines.length > 0
      ? `Recorded ${totalRejects} reject${totalRejects !== 1 ? 's' : ''}`
      : 'Bucket quarantined';
    if (!isConnected) { onScanSuccess(); show('success', `Saved offline — ${successMsg.toLowerCase()}`); }
    else if (allSuccess) { onScanSuccess(); show('success', successMsg); }
    else { onScanError(); show('error', 'Some entries queued for retry'); }

    resetForm();
    setSubmitting(false);
  };

  // ── Quarantine list ───────────────────────────────────────────────────────
  const openList = async () => {
    setListVisible(true);
    setLoadingBatches(true);
    try {
      if (isConnected) {
        try {
          const resp = await fetchQuarantineBatches();
          if (resp.batches?.length) { setBatches(resp.batches as QuarantineBatchListEntry[]); return; }
        } catch {}
      }
      setBatches(await getQuarantineBatches());
    } finally { setLoadingBatches(false); }
  };

  const handleResolve = async (batch: QuarantineBatchListEntry, action: 'discard' | 'intake') => {
    setResolvingId(batch.id);
    try {
      if (isConnected) { try { await resolveQuarantineBatch(batch.batch_id, action); } catch {} }
      else { await addToSyncQueue('resolve_quarantine_batch', { batch_id: batch.batch_id, action }); }
      await updateQuarantineBatchStatus(batch.id, action === 'discard' ? 'discarded' : 'intake');
      setBatches((prev) => prev.map((b) => b.id === batch.id
        ? { ...b, status: action === 'discard' ? 'discarded' : 'intake' } : b));
    } finally { setResolvingId(null); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>

      {/* Tab bar + quarantine list icon */}
      <View style={styles.tabBar}>
        {QUALITY_SECTIONS.map((s) => (
          <TouchableOpacity
            key={s.key}
            style={[styles.tab, activeSection === s.key && styles.tabActive]}
            onPress={() => handleSectionChange(s.key)}
            activeOpacity={0.7}
          >
            <Ionicons name={s.icon as any} size={13} color={activeSection === s.key ? colors.textOnPrimary : colors.textMuted} />
            <Text style={[styles.tabText, activeSection === s.key && styles.tabTextActive]} numberOfLines={1}>
              {s.label}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.listIconBtn} onPress={openList} activeOpacity={0.7}>
          <Ionicons name="archive-outline" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {isDiscard ? (
        <DiscardSection show={show} />
      ) : (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

        {/* Greenhouse — field_reject only */}
        {cfg!.showGreenhouse && (
          <View style={styles.field}>
            <Text style={styles.label}>Greenhouse <Text style={styles.req}>*</Text></Text>
            {loadingGreenhouses
              ? <ActivityIndicator size="small" color={colors.textMuted} />
              : <Dropdown value={greenhouse} options={ghOptions} placeholder="Select greenhouse"
                  onSelect={(v) => { setGreenhouse(v); setVariety(''); }}
                  searchable={ghOptions.length > 6} />}
          </View>
        )}

        {/* Variety — field_reject only, after greenhouse picked */}
        {cfg!.showVariety && greenhouse ? (
          <View style={styles.field}>
            <Text style={styles.label}>Variety</Text>
            <Dropdown value={variety} options={varietyOptions} placeholder="Select variety"
              onSelect={setVariety} searchable={varietyOptions.length > 6} />
          </View>
        ) : null}

        {/* Variety — standalone picker for dispatch_reject (all 50cm items) */}
        {cfg!.showStandaloneVariety && (
          <View style={styles.field}>
            <Text style={styles.label}>
              Variety {cfg!.varietyRequired && <Text style={styles.req}>*</Text>}
            </Text>
            {loadingPackable
              ? <ActivityIndicator size="small" color={colors.textMuted} />
              : <Dropdown
                  value={variety}
                  options={standaloneVarietyOptions}
                  placeholder="Select variety"
                  onSelect={setVariety}
                  searchable={standaloneVarietyOptions.length > 6}
                />}
          </View>
        )}

        {/* Bucket / reference ID */}
        {cfg!.showBucketId && (
          <View style={styles.field}>
            <TextInput
              style={styles.input}
              value={bucketId}
              onChangeText={(v) => { setBucketId(v); setBucketBalance(null); }}
              onSubmitEditing={() => fetchBalance(bucketId)}
              onBlur={() => fetchBalance(bucketId)}
              placeholder={cfg!.refPlaceholder}
              placeholderTextColor={colors.textMuted}
              returnKeyType="done"
            />
            {loadingBalance && (
              <View style={styles.balanceLoading}>
                <ActivityIndicator size="small" color={colors.textMuted} />
                <Text style={styles.balanceLoadingText}>Fetching bucket balance…</Text>
              </View>
            )}
            {bucketBalance && !loadingBalance && (
              <View style={styles.balanceCard}>
                <Text style={styles.balanceVariety}>{stripStemLength(bucketBalance.variety || '')}</Text>
                <View style={styles.balanceStats}>
                  {activeSection === 'receiving_reject' ? [
                    { n: bucketBalance.bucket_total, l: bucketBalance.pre_receive ? 'Harvested' : 'Received' },
                    { n: bucketBalance.already_rejected, l: 'Rejected' },
                    { n: bucketBalance.remaining_stems, l: 'Remaining', hi: true },
                  ].map((s) => (
                    <View key={s.l} style={[styles.balanceStat, s.hi && styles.balanceStatHi]}>
                      <Text style={[styles.balanceNum, s.hi && styles.balanceNumHi]}>{s.n}</Text>
                      <Text style={[styles.balanceLbl, s.hi && styles.balanceLblHi]}>{s.l}</Text>
                    </View>
                  )) : [
                    { n: bucketBalance.bucket_total, l: 'Received' },
                    { n: bucketBalance.already_graded, l: 'Graded' },
                    { n: bucketBalance.already_rejected, l: 'Rejected' },
                    { n: bucketBalance.remaining_stems, l: 'Remaining', hi: true },
                  ].map((s) => (
                    <View key={s.l} style={[styles.balanceStat, s.hi && styles.balanceStatHi]}>
                      <Text style={[styles.balanceNum, s.hi && styles.balanceNumHi]}>{s.n}</Text>
                      <Text style={[styles.balanceLbl, s.hi && styles.balanceLblHi]}>{s.l}</Text>
                    </View>
                  ))}
                </View>
                {bucketBalance.bucket_full && (
                  <View style={styles.fullBanner}>
                    <Ionicons name="warning-outline" size={13} color="#92400E" />
                    <Text style={styles.fullBannerText}>Bucket full — no stems remaining</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Reject reason chips */}
        <View style={styles.field}>
          <Text style={styles.label}>
            Reason{rejectLines.length > 1 ? 's' : ''}{' '}
            <Text style={styles.hint}>tap to select</Text>
          </Text>
          <View style={styles.chipGrid}>
            {reasons.map((r) => {
              const sel = rejectLines.some((l) => l.reason === r);
              return (
                <TouchableOpacity
                  key={r}
                  style={[styles.chip, sel && styles.chipActive]}
                  onPress={() => toggleReason(r)}
                  activeOpacity={0.7}
                >
                  {sel && <Ionicons name="checkmark" size={11} color={colors.textOnPrimary} style={{ marginRight: 2 }} />}
                  <Text style={[styles.chipText, sel && styles.chipTextActive]}>{r}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Qty per reason */}
        {rejectLines.length > 0 && (
          <View style={styles.field}>
            {rejectLines.map((line) => (
              <View key={line.reason} style={styles.qtyRow}>
                <Text style={styles.qtyReason} numberOfLines={1}>{line.reason}</Text>
                <View style={styles.qtyStepper}>
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => adjustQty(line.reason, -1)}>
                    <Ionicons name="remove" size={15} color={colors.text} />
                  </TouchableOpacity>
                  <TextInput
                    style={styles.qtyInput}
                    value={String(line.quantity)}
                    onChangeText={(t) => {
                      const n = parseInt(t, 10);
                      if (!isNaN(n) && n > 0) setRejectLines((prev) => prev.map((l) => l.reason === line.reason ? { ...l, quantity: n } : l));
                      else if (t === '') setRejectLines((prev) => prev.map((l) => l.reason === line.reason ? { ...l, quantity: 1 } : l));
                    }}
                    keyboardType="number-pad"
                    selectTextOnFocus
                    returnKeyType="done"
                  />
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => adjustQty(line.reason, 1)}>
                    <Ionicons name="add" size={15} color={colors.text} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity onPress={() => toggleReason(line.reason)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={17} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{totalRejects} stem{totalRejects !== 1 ? 's' : ''}</Text>
            </View>
          </View>
        )}

        {/* Notes */}
        <View style={styles.field}>
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes (optional)…"
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={2}
          />
        </View>

        {/* ── Unified quarantine card (receiving_reject only) ── */}
        {cfg!.showQuarantine && (
          <View style={styles.field}>
            <TouchableOpacity
              style={[styles.quarantineToggleRow, quarantineOn && styles.quarantineToggleRowOn]}
              onPress={() => { setQuarantineOn(!quarantineOn); if (quarantineOn) { setQuarantineScope('bucket'); setQuarantineGreenhouse(''); setQuarantineAction(''); } }}
              activeOpacity={0.8}
            >
              <Ionicons name={quarantineOn ? 'shield-checkmark' : 'shield-outline'} size={16}
                color={quarantineOn ? '#fff' : colors.warning} />
              <Text style={[styles.quarantineToggleText, quarantineOn && styles.quarantineToggleTextOn]}>
                {quarantineOn ? 'Quarantine enabled' : 'Quarantine'}
              </Text>
              <View style={[styles.toggleKnobWrap, quarantineOn && styles.toggleKnobWrapOn]}>
                <View style={[styles.toggleKnob, quarantineOn && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>

            {quarantineOn && (
              <View style={styles.quarantineBody}>
                {/* Scope selector */}
                <Text style={styles.quarantineSubLabel}>What are you quarantining?</Text>
                <View style={styles.scopeRow}>
                  {([
                    { key: 'bucket', label: 'This Bucket', icon: 'cube-outline' },
                    { key: 'batch', label: 'A Batch', icon: 'layers-outline' },
                    { key: 'greenhouse', label: 'Full Greenhouse', icon: 'leaf-outline' },
                  ] as { key: QuarantineScope3; label: string; icon: string }[]).map((opt) => (
                    <TouchableOpacity
                      key={opt.key}
                      style={[styles.scopeChip, quarantineScope === opt.key && styles.scopeChipActive]}
                      onPress={() => { setQuarantineScope(opt.key); setQuarantineGreenhouse(''); }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name={opt.icon as any} size={13}
                        color={quarantineScope === opt.key ? colors.textOnPrimary : colors.textMuted} />
                      <Text style={[styles.scopeChipText, quarantineScope === opt.key && styles.scopeChipTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Greenhouse picker — only for "Full Greenhouse" scope */}
                {quarantineScope === 'greenhouse' && (
                  <View style={{ marginTop: spacing.md }}>
                    <Text style={styles.quarantineSubLabel}>Select greenhouse <Text style={styles.req}>*</Text></Text>
                    {loadingGreenhouses
                      ? <ActivityIndicator size="small" color={colors.textMuted} />
                      : <Dropdown value={quarantineGreenhouse} options={ghOptions}
                          placeholder="Select greenhouse" onSelect={setQuarantineGreenhouse}
                          searchable={ghOptions.length > 6} />}
                  </View>
                )}

                {/* Action */}
                <Text style={[styles.quarantineSubLabel, { marginTop: spacing.md }]}>Action</Text>
                <View style={styles.actionRow}>
                  {([
                    { value: '' as QuarantineAction, label: 'Hold', icon: 'time-outline' },
                    { value: 'discard' as QuarantineAction, label: 'Discard', icon: 'trash-outline' },
                    { value: 'intake' as QuarantineAction, label: 'Send to Intake', icon: 'arrow-forward-outline' },
                  ]).map((opt) => (
                    <TouchableOpacity
                      key={String(opt.value)}
                      style={[styles.actionChip, quarantineAction === opt.value && styles.actionChipActive]}
                      onPress={() => setQuarantineAction(opt.value)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name={opt.icon as any} size={13}
                        color={quarantineAction === opt.value ? colors.textOnPrimary : colors.textMuted} />
                      <Text style={[styles.actionChipText, quarantineAction === opt.value && styles.actionChipTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        {/* Submit — enabled when there are reject lines OR quarantine is toggled on */}
        <TouchableOpacity
          style={[styles.submitBtn,
            (submitting || (rejectLines.length === 0 && !(cfg!.showQuarantine && quarantineOn))) && styles.submitBtnOff]}
          onPress={handleSubmit}
          disabled={submitting || (rejectLines.length === 0 && !(cfg!.showQuarantine && quarantineOn))}
          activeOpacity={0.8}
        >
          <Ionicons name="save-outline" size={19} color={colors.textOnPrimary} />
          <Text style={styles.submitBtnText}>
            {submitting
              ? 'Saving…'
              : totalRejects > 0
                ? `Record ${totalRejects} Reject${totalRejects !== 1 ? 's' : ''}`
                : (cfg!.showQuarantine && quarantineOn)
                  ? 'Quarantine Bucket'
                  : 'Record Rejects'}
          </Text>
        </TouchableOpacity>

        {/* Recent */}
        {recentEntries.length > 0 && (
          <View style={styles.recent}>
            <Text style={styles.recentTitle}>Recent</Text>
            {recentEntries.map((e, i) => (
              <View key={`${e.ref_id}-${i}`} style={styles.recentRow}>
                <View style={[
                  styles.dot,
                  e.status === 'success' ? styles.dotOk : e.status === 'error' ? styles.dotErr : styles.dotQ,
                ]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.recentRef}>{e.ref_id} · {e.quantity} stems</Text>
                  <Text style={styles.recentReason} numberOfLines={1}>{e.reason}</Text>
                </View>
                <Text style={styles.recentTime}>{e.time}</Text>
              </View>
            ))}
          </View>
        )}

      </ScrollView>
      )}

      {/* ── Quarantine list modal ── */}
      <Modal visible={listVisible} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Quarantine</Text>
              <TouchableOpacity onPress={() => setListVisible(false)}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {loadingBatches ? (
              <View style={styles.sheetLoading}>
                <ActivityIndicator size="small" color={colors.textMuted} />
              </View>
            ) : batches.length === 0 ? (
              <Text style={styles.sheetEmpty}>No quarantine records yet.</Text>
            ) : (
              <ScrollView style={styles.sheetList} showsVerticalScrollIndicator={false}>
                {batches.map((b) => {
                  const open = expandedId === b.id;
                  const buckets: string[] = (() => { try { return JSON.parse(b.bucket_ids); } catch { return []; } })();
                  const isPending = b.status === 'pending';
                  return (
                    <View key={b.id} style={styles.batchCard}>
                      <TouchableOpacity
                        style={styles.batchCardHeader}
                        onPress={() => setExpandedId(open ? null : b.id)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.batchDot, { backgroundColor: statusColor(b.status) }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.batchId}>{b.batch_id}</Text>
                          <Text style={styles.batchMeta}>
                            {b.scope === 'greenhouse' ? `GH: ${b.greenhouse}` : `${buckets.length} bucket${buckets.length !== 1 ? 's' : ''}`}
                            {' · '}{statusLabel(b.status)}
                          </Text>
                        </View>
                        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={colors.textMuted} />
                      </TouchableOpacity>

                      {open && (
                        <View style={styles.batchBody}>
                          {b.reason ? <><Text style={styles.batchDetailLbl}>Reason</Text><Text style={styles.batchDetailVal}>{b.reason}</Text></> : null}
                          {b.notes ? <><Text style={styles.batchDetailLbl}>Notes</Text><Text style={styles.batchDetailVal}>{b.notes}</Text></> : null}
                          {buckets.length > 0 ? <><Text style={styles.batchDetailLbl}>Buckets</Text><Text style={styles.batchDetailVal}>{buckets.join(', ')}</Text></> : null}
                          <Text style={styles.batchDetailLbl}>Date</Text>
                          <Text style={styles.batchDetailVal}>{(b.date_added ?? '').slice(0, 16).replace('T', ' ')}</Text>

                          {isPending && (
                            <View style={styles.batchActions}>
                              <TouchableOpacity
                                style={[styles.batchBtn, styles.batchBtnDiscard]}
                                onPress={() => handleResolve(b, 'discard')}
                                disabled={resolvingId === b.id}
                                activeOpacity={0.8}
                              >
                                <Ionicons name="trash-outline" size={13} color="#fff" />
                                <Text style={styles.batchBtnText}>{resolvingId === b.id ? '…' : 'Discard'}</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.batchBtn, styles.batchBtnIntake]}
                                onPress={() => handleResolve(b, 'intake')}
                                disabled={resolvingId === b.id}
                                activeOpacity={0.8}
                              >
                                <Ionicons name="arrow-forward-outline" size={13} color="#fff" />
                                <Text style={styles.batchBtnText}>{resolvingId === b.id ? '…' : 'Move to Intake'}</Text>
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            )}
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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  // Tab bar
  tabBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: spacing.xs,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 3, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs,
    borderRadius: borderRadius.sm, backgroundColor: colors.surfaceAlt,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontFamily: fontFamily.medium, fontSize: 10, color: colors.textMuted, flexShrink: 1 },
  tabTextActive: { color: colors.textOnPrimary },
  listIconBtn: {
    width: 34, height: 34, borderRadius: borderRadius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border,
  },

  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },

  field: { marginBottom: spacing.lg },
  label: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text, marginBottom: spacing.sm },
  req: { color: colors.error },
  hint: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },

  input: {
    backgroundColor: colors.surface, borderRadius: borderRadius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, fontFamily: fontFamily.regular,
    fontSize: fontSize.sm, color: colors.text,
  },
  notesInput: {
    backgroundColor: colors.surface, borderRadius: borderRadius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, fontFamily: fontFamily.regular,
    fontSize: fontSize.sm, color: colors.text, minHeight: 56, textAlignVertical: 'top',
  },

  // Reason chips
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: borderRadius.full, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  chipTextActive: { color: colors.textOnPrimary },

  // Qty rows
  qtyRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: borderRadius.sm, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  qtyReason: { flex: 1, fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  qtyStepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  qtyBtn: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyNum: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: colors.text, minWidth: 26, textAlign: 'center' },
  qtyInput: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: colors.text, minWidth: 36, textAlign: 'center', padding: 0 },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: spacing.sm, marginTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  totalLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  totalValue: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: colors.text },

  // Balance card
  balanceLoading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  balanceLoadingText: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },
  balanceCard: {
    marginTop: spacing.sm, backgroundColor: colors.surface, borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  balanceVariety: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text, marginBottom: spacing.sm },
  balanceStats: { flexDirection: 'row', justifyContent: 'space-between' },
  balanceStat: { alignItems: 'center', flex: 1 },
  balanceStatHi: { backgroundColor: '#EFF6FF', borderRadius: borderRadius.sm, paddingVertical: 4 },
  balanceNum: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: colors.text },
  balanceNumHi: { color: '#1D4ED8' },
  balanceLbl: { fontFamily: fontFamily.regular, fontSize: 10, color: colors.textMuted, marginTop: 2 },
  balanceLblHi: { color: '#3B82F6' },
  fullBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginTop: spacing.sm, backgroundColor: '#FEF3C7', borderRadius: borderRadius.sm, padding: spacing.sm,
  },
  fullBannerText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: '#92400E', flex: 1 },

  // Quarantine card
  quarantineToggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: '#FFFBEB', borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: '#FDE68A', padding: spacing.md,
  },
  quarantineToggleRowOn: { backgroundColor: colors.warning, borderColor: colors.warning },
  quarantineToggleText: { flex: 1, fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.warning },
  quarantineToggleTextOn: { color: '#fff' },
  toggleKnobWrap: {
    width: 44, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.15)',
    justifyContent: 'center', paddingHorizontal: 2,
  },
  toggleKnobWrapOn: { backgroundColor: 'rgba(255,255,255,0.3)' },
  toggleKnob: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: '#FDE68A',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 2, elevation: 2,
  },
  toggleKnobOn: { alignSelf: 'flex-end', backgroundColor: '#fff' },
  quarantineBody: {
    marginTop: spacing.sm, backgroundColor: colors.surface, borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  quarantineSubLabel: {
    fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm,
  },
  scopeRow: { flexDirection: 'row', gap: spacing.sm },
  scopeChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: spacing.sm, borderRadius: borderRadius.sm,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt,
  },
  scopeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  scopeChipText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textMuted },
  scopeChipTextActive: { color: colors.textOnPrimary },
  actionRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  actionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: borderRadius.full, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  actionChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionChipText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.textMuted },
  actionChipTextActive: { color: colors.textOnPrimary },

  // Submit
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, borderRadius: borderRadius.md,
    padding: spacing.lg, marginBottom: spacing.xl,
  },
  submitBtnOff: { opacity: 0.4 },
  submitBtnText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.textOnPrimary },

  // Recent
  recent: {},
  recentTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.textMuted, marginBottom: spacing.sm },
  recentRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: borderRadius.sm, padding: spacing.md,
    marginBottom: spacing.xs, borderWidth: 1, borderColor: colors.border,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOk: { backgroundColor: colors.success },
  dotErr: { backgroundColor: colors.error },
  dotQ: { backgroundColor: colors.warning },
  recentRef: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  recentReason: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },
  recentTime: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },

  // Quarantine list sheet
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: spacing.xl, maxHeight: '82%',
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  sheetTitle: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: colors.text },
  sheetLoading: { paddingVertical: spacing.xl, alignItems: 'center' },
  sheetEmpty: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted, paddingVertical: spacing.xl },
  sheetList: { flexGrow: 0 },

  batchCard: {
    backgroundColor: colors.background, borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, overflow: 'hidden',
  },
  batchCardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  batchDot: { width: 10, height: 10, borderRadius: 5 },
  batchId: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text },
  batchMeta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  batchBody: {
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm,
  },
  batchDetailLbl: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  batchDetailVal: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.text },
  batchActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  batchBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, padding: spacing.md, borderRadius: borderRadius.sm,
  },
  batchBtnDiscard: { backgroundColor: colors.error },
  batchBtnIntake: { backgroundColor: colors.success },
  batchBtnText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: '#fff' },
});
