import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, RouteProp } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import { addToSyncQueue } from '../database/sync-queue';
import { addReceivingEntry } from '../database/receiving';
import { addQualityEntry } from '../database/quality';
import { addQuarantineBatch } from '../database/quarantine';
import { submitReceiving, submitBucketTransfer, submitQualityEntry, createQuarantineBatch } from '../services/api';
import { parseScannedBucketQR } from '../utils/shelf-utils';
import { getFarm } from '../database/settings';
import ScanInput from '../components/ScanInput';
import SyncBanner from '../components/SyncBanner';
import ScanConfirmation from '../components/ScanConfirmation';
import EntriesLog from '../components/EntriesLog';
import { ReceivingListEntry, RejectLine, QUALITY_REASONS } from '../types';
import { onScanSuccess, onScanError } from '../utils/feedback';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

type ReceivingRouteParams = { prefillBucketId?: string };
type XfloraPhase = 'scan-harvest' | 'scan-coldroom';

const RECEIVING_REJECT_REASONS = QUALITY_REASONS.receiving_reject;

function genBatchId(): string {
  return `QB-${Date.now()}`;
}

export default function ReceivingScreen() {
  const { isConnected, refreshStats, isXflora } = useApp();
  const route = useRoute<RouteProp<Record<string, ReceivingRouteParams>, string>>();
  const prefillBucketId = route.params?.prefillBucketId;

  const [entries, setEntries] = useState<ReceivingListEntry[]>([]);
  const [prefillBanner, setPrefillBanner] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    visible: boolean; type: 'success' | 'error'; message: string;
  }>({ visible: false, type: 'success', message: '' });

  // xflora two-phase state
  const [xfloraPhase, setXfloraPhase] = useState<XfloraPhase>('scan-harvest');
  const [harvestBucketId, setHarvestBucketId] = useState<string | null>(null);
  const [harvestDetail, setHarvestDetail] = useState<{ variety?: string; greenhouse?: string; qty?: number } | null>(null);

  // Inline quality check after scan
  const [pendingQuality, setPendingQuality] = useState<{
    bucketId: string; variety?: string; greenhouse?: string;
  } | null>(null);
  const [qualityLines, setQualityLines] = useState<RejectLine[]>([]);
  const [qualityNotes, setQualityNotes] = useState('');
  const [submittingQuality, setSubmittingQuality] = useState(false);

  // Batch mode
  const [batchExpanded, setBatchExpanded] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [batchBuckets, setBatchBuckets] = useState<string[]>([]);
  const [quarantineModalVisible, setQuarantineModalVisible] = useState(false);
  const [batchReason, setBatchReason] = useState('');
  const [batchNotes, setBatchNotes] = useState('');
  const [submittingBatch, setSubmittingBatch] = useState(false);

  const showConfirmation = (type: 'success' | 'error', message: string) => {
    setConfirmation({ visible: true, type, message });
  };

  const handleScanRef = useRef<((data: string) => void) | null>(null);

  // ── Quality check helpers ─────────────────────────────────────────────────
  const toggleQualityReason = (reason: string) => {
    setQualityLines((prev) => {
      const exists = prev.find((l) => l.reason === reason);
      if (exists) return prev.filter((l) => l.reason !== reason);
      return [...prev, { reason, quantity: 1 }];
    });
  };

  const adjustQualityQty = (reason: string, delta: number) => {
    setQualityLines((prev) =>
      prev.map((l) => l.reason === reason ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l)
    );
  };

  const handleQualitySubmit = async () => {
    if (!pendingQuality || qualityLines.length === 0) {
      clearQualityCheck();
      return;
    }
    setSubmittingQuality(true);
    const farm = await getFarm();
    const gh = pendingQuality.greenhouse ?? '';
    const variety = pendingQuality.variety ?? '';
    const bucketId = pendingQuality.bucketId;

    for (const line of qualityLines) {
      const payload = {
        section: 'receiving_reject',
        ref_id: bucketId,
        quantity: line.quantity,
        reason: line.reason,
        notes: qualityNotes,
        farm,
        greenhouse: gh,
        variety,
        quarantined: 0,
        quarantine_action: '',
      };
      if (isConnected) {
        try {
          await submitQualityEntry('receiving_reject', bucketId, line.quantity, line.reason, qualityNotes, farm, gh, variety, false, '');
          await addQualityEntry('receiving_reject', bucketId, line.quantity, line.reason, qualityNotes, farm, true, gh, variety, false, '');
        } catch {
          await addToSyncQueue('create_quality_entry', payload);
          await addQualityEntry('receiving_reject', bucketId, line.quantity, line.reason, qualityNotes, farm, false, gh, variety, false, '');
        }
      } else {
        await addToSyncQueue('create_quality_entry', payload);
        await addQualityEntry('receiving_reject', bucketId, line.quantity, line.reason, qualityNotes, farm, false, gh, variety, false, '');
      }
    }

    const totalRejects = qualityLines.reduce((s, l) => s + l.quantity, 0);
    showConfirmation('success', `${totalRejects} reject${totalRejects !== 1 ? 's' : ''} recorded for ${bucketId}`);
    clearQualityCheck();
    setSubmittingQuality(false);
  };

  const clearQualityCheck = () => {
    setPendingQuality(null);
    setQualityLines([]);
    setQualityNotes('');
  };

  // ── mona: single scan ──────────────────────────────────────────────────────
  const handleScanMona = useCallback(
    async (data: string) => {
      const bucketId = parseScannedBucketQR(data);
      if (!bucketId) { onScanError(); return; }
      const now = new Date().toLocaleTimeString();

      if (isConnected) {
        try {
          const response = await submitReceiving(bucketId);
          await addReceivingEntry(bucketId, true);
          setEntries((prev) => [
            { bucket_id: bucketId, time: now, status: 'success', message: 'Synced' },
            ...prev,
          ]);
          await refreshStats();
          onScanSuccess();
          showConfirmation('success', bucketId);
          // Trigger quality check with context from response
          setPendingQuality({ bucketId, variety: response.variety, greenhouse: response.greenhouse });
          if (batchMode) setBatchBuckets((prev) => prev.includes(bucketId) ? prev : [...prev, bucketId]);
        } catch (error: any) {
          await addToSyncQueue('receiving_entry', { bucket_id: bucketId });
          await addReceivingEntry(bucketId, false);
          setEntries((prev) => [
            { bucket_id: bucketId, time: now, status: 'error', message: error.message },
            ...prev,
          ]);
          await refreshStats();
          onScanError();
          showConfirmation('error', error.message);
        }
      } else {
        await addToSyncQueue('receiving_entry', { bucket_id: bucketId });
        await addReceivingEntry(bucketId, false);
        setEntries((prev) => [
          { bucket_id: bucketId, time: now, status: 'queued', message: 'Saved offline' },
          ...prev,
        ]);
        await refreshStats();
        onScanSuccess();
        showConfirmation('success', 'Saved offline');
        setPendingQuality({ bucketId });
        if (batchMode) setBatchBuckets((prev) => prev.includes(bucketId) ? prev : [...prev, bucketId]);
      }
    },
    [isConnected, refreshStats, batchMode]
  );

  // ── xflora phase 1 ────────────────────────────────────────────────────────
  const handleScanHarvest = useCallback(
    async (data: string) => {
      const bucketId = parseScannedBucketQR(data);
      if (!bucketId) { onScanError(); return; }

      if (isConnected) {
        try {
          const response = await submitReceiving(bucketId);
          await addReceivingEntry(bucketId, true);
          setHarvestBucketId(bucketId);
          setHarvestDetail({ variety: response.variety, greenhouse: response.greenhouse, qty: response.qty });
          setXfloraPhase('scan-coldroom');
          onScanSuccess();
          showConfirmation('success', bucketId);
        } catch (error: any) {
          onScanError();
          showConfirmation('error', error.message);
        }
      } else {
        await addToSyncQueue('receiving_entry', { bucket_id: bucketId });
        await addReceivingEntry(bucketId, false);
        setHarvestBucketId(bucketId);
        setHarvestDetail(null);
        setXfloraPhase('scan-coldroom');
        onScanSuccess();
        showConfirmation('success', 'Saved offline — scan coldroom bucket');
      }
    },
    [isConnected]
  );

  // ── xflora phase 2 ────────────────────────────────────────────────────────
  const handleScanColdroom = useCallback(
    async (data: string) => {
      const coldroomId = parseScannedBucketQR(data);
      if (!coldroomId || !harvestBucketId) { onScanError(); return; }
      const now = new Date().toLocaleTimeString();

      if (isConnected) {
        try {
          const response = await submitBucketTransfer(harvestBucketId, coldroomId);
          setEntries((prev) => [
            {
              bucket_id: harvestBucketId,
              coldroom_bucket_id: coldroomId,
              variety: response.variety ?? harvestDetail?.variety,
              greenhouse: response.greenhouse ?? harvestDetail?.greenhouse,
              qty: harvestDetail?.qty,
              time: now,
              status: 'success',
              message: `→ ${coldroomId}`,
            },
            ...prev,
          ]);
          await refreshStats();
          onScanSuccess();
          showConfirmation('success', coldroomId);
        } catch (error: any) {
          await addToSyncQueue('bucket_transfer', {
            source_bucket_id: harvestBucketId,
            destination_bucket_id: coldroomId,
          });
          setEntries((prev) => [
            { bucket_id: harvestBucketId, coldroom_bucket_id: coldroomId, time: now, status: 'error', message: error.message },
            ...prev,
          ]);
          await refreshStats();
          onScanError();
          showConfirmation('error', error.message);
        }
      } else {
        await addToSyncQueue('bucket_transfer', {
          source_bucket_id: harvestBucketId,
          destination_bucket_id: coldroomId,
        });
        setEntries((prev) => [
          { bucket_id: harvestBucketId, coldroom_bucket_id: coldroomId, time: now, status: 'queued', message: 'Saved offline' },
          ...prev,
        ]);
        await refreshStats();
        onScanSuccess();
        showConfirmation('success', 'Saved offline');
      }

      setHarvestBucketId(null);
      setHarvestDetail(null);
      setXfloraPhase('scan-harvest');
    },
    [harvestBucketId, harvestDetail, isConnected, refreshStats]
  );

  useEffect(() => { handleScanRef.current = handleScanMona; }, [handleScanMona]);

  useEffect(() => {
    if (!prefillBucketId || isXflora) return;
    setPrefillBanner(prefillBucketId);
    const timer = setTimeout(() => handleScanRef.current?.(prefillBucketId), 600);
    return () => clearTimeout(timer);
  }, [prefillBucketId, isXflora]);

  // ── Quarantine batch submit ───────────────────────────────────────────────
  const handleQuarantineBatch = async () => {
    if (!batchReason.trim()) {
      Alert.alert('Required', 'Enter a reason for quarantine');
      return;
    }
    setSubmittingBatch(true);
    const batchId = genBatchId();
    const farm = await getFarm();
    const payload = { batch_id: batchId, scope: 'buckets', greenhouse: '', bucket_ids: batchBuckets, reason: batchReason, notes: batchNotes };

    if (isConnected) {
      try {
        await createQuarantineBatch(batchId, 'buckets', '', batchBuckets, batchReason, batchNotes);
        await addQuarantineBatch(batchId, 'buckets', '', batchBuckets, batchReason, batchNotes, true);
      } catch {
        await addToSyncQueue('create_quarantine_batch', payload);
        await addQuarantineBatch(batchId, 'buckets', '', batchBuckets, batchReason, batchNotes, false);
      }
    } else {
      await addToSyncQueue('create_quarantine_batch', payload);
      await addQuarantineBatch(batchId, 'buckets', '', batchBuckets, batchReason, batchNotes, false);
    }

    setBatchBuckets([]);
    setBatchReason('');
    setBatchNotes('');
    setBatchMode(false);
    setBatchExpanded(false);
    setQuarantineModalVisible(false);
    setSubmittingBatch(false);
    showConfirmation('success', `Batch quarantined: ${batchBuckets.length} bucket${batchBuckets.length !== 1 ? 's' : ''}`);
  };

  const totalQualityRejects = qualityLines.reduce((s, l) => s + l.quantity, 0);

  return (
    <View style={styles.container}>
      <SyncBanner />

      {/* ── Batch mode disclosure ── */}
      <View style={styles.batchDisclosure}>
        <TouchableOpacity
          style={styles.batchDisclosureRow}
          onPress={() => setBatchExpanded(!batchExpanded)}
          activeOpacity={0.7}
        >
          <Ionicons name="layers-outline" size={14} color={colors.textMuted} />
          <Text style={styles.batchDisclosureText}>
            Batch mode{batchMode && batchBuckets.length > 0 ? ` · ${batchBuckets.length} bucket${batchBuckets.length !== 1 ? 's' : ''}` : ''}
          </Text>
          <Ionicons name={batchExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
        </TouchableOpacity>

        {batchExpanded && (
          <View style={styles.batchPanel}>
            <View style={styles.batchToggleRow}>
              <Text style={styles.batchToggleLabel}>Enable batch mode</Text>
              <TouchableOpacity
                style={[styles.toggleBtn, batchMode && styles.toggleBtnOn]}
                onPress={() => {
                  setBatchMode(!batchMode);
                  if (batchMode) setBatchBuckets([]);
                }}
                activeOpacity={0.8}
              >
                <View style={[styles.toggleKnob, batchMode && styles.toggleKnobOn]} />
              </TouchableOpacity>
            </View>

            {batchMode && (
              <>
                <Text style={styles.batchHint}>Scanned buckets are added to this batch automatically.</Text>
                {batchBuckets.length > 0 ? (
                  <>
                    <View style={styles.batchList}>
                      {batchBuckets.map((b, i) => (
                        <View key={b} style={styles.batchChip}>
                          <Text style={styles.batchChipText}>{b}</Text>
                          <TouchableOpacity onPress={() => setBatchBuckets((prev) => prev.filter((x) => x !== b))}>
                            <Ionicons name="close" size={12} color={colors.textMuted} />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                    <TouchableOpacity
                      style={styles.quarantineBatchBtn}
                      onPress={() => setQuarantineModalVisible(true)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="shield-outline" size={16} color="#fff" />
                      <Text style={styles.quarantineBatchBtnText}>Quarantine Batch ({batchBuckets.length})</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <Text style={styles.batchEmpty}>No buckets yet — scan to add</Text>
                )}
              </>
            )}
          </View>
        )}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {prefillBanner && !isXflora ? (
          <View style={styles.prefillBanner}>
            <Ionicons name="information-circle-outline" size={16} color={colors.warning} />
            <Text style={styles.prefillBannerText}>
              Receiving <Text style={styles.prefillBannerBucket}>{prefillBanner}</Text> from Shelve
            </Text>
          </View>
        ) : null}

        {isXflora ? (
          <>
            <View style={styles.inputSection}>
              <View style={styles.stepRow}>
                <View style={[styles.stepBadge, xfloraPhase === 'scan-coldroom' ? styles.stepDone : styles.stepActive]}>
                  <Text style={styles.stepNum}>1</Text>
                </View>
                <Text style={styles.label}>Scan field bucket</Text>
              </View>

              {xfloraPhase === 'scan-coldroom' ? (
                <View style={styles.scannedRow}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                  <View style={styles.scannedInfo}>
                    <Text style={styles.scannedId}>{harvestBucketId}</Text>
                    {harvestDetail?.variety ? (
                      <Text style={styles.scannedDetail}>
                        {harvestDetail.variety}
                        {harvestDetail.greenhouse ? `  ·  ${harvestDetail.greenhouse}` : ''}
                        {harvestDetail.qty ? `  ·  ${harvestDetail.qty} stems` : ''}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.rescanLabel} onPress={() => {
                    setHarvestBucketId(null);
                    setHarvestDetail(null);
                    setXfloraPhase('scan-harvest');
                  }}>
                    Re-scan
                  </Text>
                </View>
              ) : (
                <ScanInput placeholder="Field bucket ID" scannerTitle="Scan Field Bucket" onScan={handleScanHarvest} />
              )}
            </View>

            {xfloraPhase === 'scan-coldroom' ? (
              <View style={styles.inputSection}>
                <View style={styles.stepRow}>
                  <View style={[styles.stepBadge, styles.stepActive]}>
                    <Text style={styles.stepNum}>2</Text>
                  </View>
                  <Text style={styles.label}>Scan coldroom bucket</Text>
                </View>
                <ScanInput placeholder="Coldroom bucket ID" scannerTitle="Scan Coldroom Bucket" onScan={handleScanColdroom} />
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.inputSection}>
            <Text style={styles.label}>Scan bucket to receive</Text>
            <ScanInput placeholder="Bucket ID" scannerTitle="Scan Bucket QR Code" onScan={handleScanMona} />
          </View>
        )}

        {/* ── Inline quality check card ── */}
        {pendingQuality && (
          <View style={styles.qualityCard}>
            <View style={styles.qualityCardHeader}>
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.warning} />
              <View style={{ flex: 1 }}>
                <Text style={styles.qualityCardTitle}>Quality Check — {pendingQuality.bucketId}</Text>
                {(pendingQuality.variety || pendingQuality.greenhouse) ? (
                  <Text style={styles.qualityCardSub}>
                    {[pendingQuality.variety, pendingQuality.greenhouse].filter(Boolean).join('  ·  ')}
                  </Text>
                ) : null}
              </View>
            </View>

            <Text style={styles.qualityReasonLabel}>
              Any defects found? <Text style={styles.qualityOptional}>(tap to select)</Text>
            </Text>
            <View style={styles.reasonGrid}>
              {RECEIVING_REJECT_REASONS.map((reason) => {
                const selected = qualityLines.some((l) => l.reason === reason);
                return (
                  <TouchableOpacity
                    key={reason}
                    style={[styles.reasonChip, selected && styles.reasonChipActive]}
                    onPress={() => toggleQualityReason(reason)}
                    activeOpacity={0.7}
                  >
                    {selected && <Ionicons name="checkmark" size={11} color={colors.textOnPrimary} style={{ marginRight: 2 }} />}
                    <Text style={[styles.reasonChipText, selected && styles.reasonChipTextActive]}>{reason}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {qualityLines.length > 0 && (
              <View style={styles.qualityLines}>
                {qualityLines.map((line) => (
                  <View key={line.reason} style={styles.qualityLineRow}>
                    <Text style={styles.qualityLineReason} numberOfLines={1}>{line.reason}</Text>
                    <View style={styles.qtyInline}>
                      <TouchableOpacity style={styles.qtyBtn} onPress={() => adjustQualityQty(line.reason, -1)}>
                        <Ionicons name="remove" size={14} color={colors.text} />
                      </TouchableOpacity>
                      <Text style={styles.qtyText}>{line.quantity}</Text>
                      <TouchableOpacity style={styles.qtyBtn} onPress={() => adjustQualityQty(line.reason, 1)}>
                        <Ionicons name="add" size={14} color={colors.text} />
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity onPress={() => toggleQualityReason(line.reason)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ))}
                <View style={styles.qualityTotalRow}>
                  <Text style={styles.qualityTotalLabel}>Total removed stems:</Text>
                  <Text style={styles.qualityTotalValue}>{totalQualityRejects}</Text>
                </View>
              </View>
            )}

            <TextInput
              style={styles.notesInput}
              value={qualityNotes}
              onChangeText={setQualityNotes}
              placeholder="Notes (optional)…"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={2}
            />

            <View style={styles.qualityActions}>
              <TouchableOpacity style={styles.skipBtn} onPress={clearQualityCheck} activeOpacity={0.7}>
                <Text style={styles.skipBtnText}>No Defects</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.recordBtn, (submittingQuality || qualityLines.length === 0) && styles.recordBtnDisabled]}
                onPress={handleQualitySubmit}
                disabled={submittingQuality || qualityLines.length === 0}
                activeOpacity={0.8}
              >
                <Ionicons name="save-outline" size={14} color={colors.textOnPrimary} />
                <Text style={styles.recordBtnText}>
                  {submittingQuality ? 'Saving…' : qualityLines.length > 0 ? `Record ${totalQualityRejects} Reject${totalQualityRejects !== 1 ? 's' : ''}` : 'Record Rejects'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {entries.length === 0 && !pendingQuality && (
          <Text style={styles.emptyText}>
            {isXflora
              ? 'Scan field bucket, then scan the coldroom bucket it transfers into'
              : 'Scan buckets arriving at the packhouse'}
          </Text>
        )}

        <EntriesLog
          entries={entries}
          label="bucket"
          renderEntry={(entry, idx) => (
            <View key={`${entry.bucket_id}-${idx}`} style={styles.entryRow}>
              <Ionicons
                name={
                  entry.status === 'success' ? 'checkmark-circle'
                  : entry.status === 'queued' ? 'time'
                  : 'alert-circle'
                }
                size={18}
                color={
                  entry.status === 'success' ? colors.success
                  : entry.status === 'queued' ? colors.warning
                  : colors.error
                }
              />
              <View style={styles.entryInfo}>
                <Text style={styles.entryId}>{entry.bucket_id}</Text>
                {entry.coldroom_bucket_id ? <Text style={styles.coldroomId}>→ {entry.coldroom_bucket_id}</Text> : null}
                {(entry.variety || entry.greenhouse) ? (
                  <Text style={styles.entryDetail}>
                    {[entry.variety, entry.greenhouse, entry.qty ? `${entry.qty} stems` : ''].filter(Boolean).join('  ·  ')}
                  </Text>
                ) : null}
                <Text style={styles.entryTime}>{entry.time}</Text>
              </View>
              {entry.message && entry.status !== 'success' ? <Text style={styles.entryMsg}>{entry.message}</Text> : null}
            </View>
          )}
        />
      </ScrollView>

      {/* ── Quarantine batch modal ── */}
      <Modal visible={quarantineModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Ionicons name="shield-outline" size={20} color={colors.warning} />
              <Text style={styles.modalTitle}>Quarantine Batch</Text>
              <TouchableOpacity onPress={() => setQuarantineModalVisible(false)}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSub}>{batchBuckets.length} bucket{batchBuckets.length !== 1 ? 's' : ''} will be quarantined</Text>

            <Text style={styles.modalLabel}>Reason <Text style={{ color: colors.error }}>*</Text></Text>
            <TextInput
              style={styles.modalInput}
              value={batchReason}
              onChangeText={setBatchReason}
              placeholder="e.g. Botrytis detected"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.modalLabel}>Notes <Text style={styles.optionalText}>(optional)</Text></Text>
            <TextInput
              style={[styles.modalInput, { minHeight: 64, textAlignVertical: 'top' }]}
              value={batchNotes}
              onChangeText={setBatchNotes}
              placeholder="Additional details…"
              placeholderTextColor={colors.textMuted}
              multiline
            />

            <TouchableOpacity
              style={[styles.quarantineSubmitBtn, (submittingBatch || !batchReason.trim()) && styles.quarantineSubmitBtnDisabled]}
              onPress={handleQuarantineBatch}
              disabled={submittingBatch || !batchReason.trim()}
              activeOpacity={0.8}
            >
              <Ionicons name="shield-checkmark-outline" size={16} color="#fff" />
              <Text style={styles.quarantineSubmitBtnText}>{submittingBatch ? 'Saving…' : 'Confirm Quarantine'}</Text>
            </TouchableOpacity>
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

  // Batch disclosure
  batchDisclosure: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  batchDisclosureRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  batchDisclosureText: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },
  batchPanel: {
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  batchToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  batchToggleLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  toggleBtn: {
    width: 44, height: 26, borderRadius: 13,
    backgroundColor: colors.border, justifyContent: 'center', paddingHorizontal: 2,
  },
  toggleBtnOn: { backgroundColor: colors.warning },
  toggleKnob: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surface,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 2, elevation: 2,
  },
  toggleKnobOn: { alignSelf: 'flex-end' },
  batchHint: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginBottom: spacing.sm },
  batchList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  batchChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.surfaceAlt, borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderWidth: 1, borderColor: colors.border,
  },
  batchChipText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.text },
  batchEmpty: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, fontStyle: 'italic' },
  quarantineBatchBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.warning, borderRadius: borderRadius.md,
    padding: spacing.md, marginTop: spacing.sm,
  },
  quarantineBatchBtnText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: '#fff' },

  prefillBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: colors.warning,
    borderRadius: borderRadius.md, padding: spacing.md, marginBottom: spacing.md,
  },
  prefillBannerText: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.text, flex: 1 },
  prefillBannerBucket: { fontFamily: fontFamily.semiBold },
  inputSection: { marginBottom: spacing.lg },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  stepBadge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stepActive: { backgroundColor: colors.text },
  stepDone: { backgroundColor: colors.success },
  stepNum: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: '#fff' },
  label: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text },
  scannedRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.success,
    borderRadius: borderRadius.md, padding: spacing.md,
  },
  scannedInfo: { flex: 1 },
  scannedId: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  scannedDetail: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  rescanLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, textDecorationLine: 'underline' },

  // Quality check card
  qualityCard: {
    backgroundColor: '#FFFBEB', borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: '#FDE68A', padding: spacing.md, marginBottom: spacing.lg,
  },
  qualityCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.md },
  qualityCardTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text },
  qualityCardSub: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  qualityReasonLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text, marginBottom: spacing.sm },
  qualityOptional: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },
  reasonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  reasonChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.sm, paddingVertical: 5,
    borderRadius: borderRadius.full, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  reasonChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  reasonChipText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.text },
  reasonChipTextActive: { color: colors.textOnPrimary },
  qualityLines: { marginBottom: spacing.sm },
  qualityLineRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: borderRadius.sm,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginBottom: spacing.xs,
  },
  qualityLineReason: { flex: 1, fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  qtyInline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  qtyBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center',
  },
  qtyText: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: colors.text, minWidth: 24, textAlign: 'center' },
  qualityTotalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    marginBottom: spacing.sm,
  },
  qualityTotalLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textMuted },
  qualityTotalValue: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: colors.text },
  notesInput: {
    backgroundColor: colors.surface, borderRadius: borderRadius.sm, borderWidth: 1,
    borderColor: colors.border, padding: spacing.sm, fontFamily: fontFamily.regular,
    fontSize: fontSize.sm, color: colors.text, minHeight: 48, textAlignVertical: 'top', marginBottom: spacing.sm,
  },
  qualityActions: { flexDirection: 'row', gap: spacing.sm },
  skipBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.md, borderRadius: borderRadius.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  skipBtnText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.textMuted },
  recordBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    paddingVertical: spacing.md, borderRadius: borderRadius.sm, backgroundColor: colors.primary,
  },
  recordBtnDisabled: { opacity: 0.4 },
  recordBtnText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.textOnPrimary },

  entryRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  entryInfo: { flex: 1 },
  entryId: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  coldroomId: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },
  entryDetail: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },
  entryTime: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },
  entryMsg: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },
  emptyText: {
    fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted,
    textAlign: 'center', paddingVertical: spacing.xxl,
  },

  // Quarantine batch modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: spacing.xl, paddingBottom: spacing.xxl,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  modalTitle: { flex: 1, fontFamily: fontFamily.semiBold, fontSize: fontSize.lg, color: colors.text },
  modalSub: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted, marginBottom: spacing.lg },
  modalLabel: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text, marginBottom: spacing.xs },
  modalInput: {
    backgroundColor: colors.background, borderRadius: borderRadius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, fontFamily: fontFamily.regular,
    fontSize: fontSize.sm, color: colors.text, marginBottom: spacing.lg,
  },
  optionalText: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },
  quarantineSubmitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.warning, borderRadius: borderRadius.md, padding: spacing.lg,
  },
  quarantineSubmitBtnDisabled: { opacity: 0.4 },
  quarantineSubmitBtnText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: '#fff' },
});
