import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import { getOrCreateShelf, addShelfItem, getShelfItemCount } from '../database/shelves';
import { addToSyncQueue } from '../database/sync-queue';
import { getFarm } from '../database/settings';
import {
  submitShelve,
  getBucketCurrentShelf,
  transferBucketBetweenShelves,
} from '../services/api';
import { parseScannedShelfQR, parseScannedBucketQR, formatShelfLocation } from '../utils/shelf-utils';
import ScanInput from '../components/ScanInput';
import BucketEntry from '../components/BucketEntry';
import ScanConfirmation from '../components/ScanConfirmation';
import EntriesLog from '../components/EntriesLog';
import VarietyBanner from '../components/VarietyBanner';
import { ScanPhase, ShelvedBucketEntry } from '../types';
import { onScanSuccess, onScanError } from '../utils/feedback';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

export default function ShelveScreen() {
  const { isConnected, refreshStats, isXflora } = useApp();
  const navigation = useNavigation<any>();
  const [mode, setMode] = useState<'shelve' | 'transfer'>('shelve');
  const [phase, setPhase] = useState<ScanPhase>('scan-shelf');
  const [currentShelf, setCurrentShelf] = useState<string | null>(null);
  const [bucketCount, setBucketCount] = useState(0);
  const [entries, setEntries] = useState<ShelvedBucketEntry[]>([]);

  // Transfer-mode state. The flow is: scan bucket → server reports current
  // shelf → scan destination → confirm.
  const [transferBucket, setTransferBucket] = useState<string | null>(null);
  const [transferFromShelf, setTransferFromShelf] = useState<string | null>(null);
  const [transferToShelf, setTransferToShelf] = useState<string | null>(null);
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  type TransferLogEntry = {
    bucket_id: string; from_shelf: string | null; to_shelf: string;
    time: string; status: 'success' | 'error'; message?: string;
  };
  const [transferLog, setTransferLog] = useState<TransferLogEntry[]>([]);

  const resetTransfer = useCallback(() => {
    setTransferBucket(null);
    setTransferFromShelf(null);
    setTransferToShelf(null);
  }, []);

  const handleTransferBucketScanned = useCallback(async (data: string) => {
    const bucketId = parseScannedBucketQR(data);
    if (!bucketId) {
      onScanError();
      Alert.alert('Invalid', 'Could not read a bucket ID.');
      return;
    }
    try {
      const lookup = await getBucketCurrentShelf(bucketId);
      if (!lookup.shelf_id) {
        onScanError();
        Alert.alert(
          'Bucket isn\'t on a shelf',
          `${bucketId} isn't currently on any shelf. Use Shelve mode to place it first.`,
        );
        return;
      }
      setTransferBucket(bucketId);
      setTransferFromShelf(lookup.shelf_id);
      setTransferToShelf(null);
      onScanSuccess();
    } catch (e: any) {
      onScanError();
      Alert.alert('Lookup failed', e?.message || String(e));
    }
  }, []);

  const handleTransferDestScanned = useCallback((data: string) => {
    const shelfId = parseScannedShelfQR(data);
    if (!shelfId) {
      onScanError();
      Alert.alert('Invalid', 'Could not read a shelf ID.');
      return;
    }
    if (shelfId === transferFromShelf) {
      onScanError();
      Alert.alert('Same shelf', `${shelfId} is already where this bucket is.`);
      return;
    }
    setTransferToShelf(shelfId);
    onScanSuccess();
  }, [transferFromShelf]);

  const handleConfirmTransfer = useCallback(async () => {
    if (!transferBucket || !transferToShelf || transferSubmitting) return;
    setTransferSubmitting(true);
    const now = new Date().toLocaleTimeString();
    try {
      const res = await transferBucketBetweenShelves(transferBucket, transferToShelf);
      const ok: TransferLogEntry = {
        bucket_id:  res.bucket_id,
        from_shelf: res.from_shelf,
        to_shelf:   res.to_shelf,
        time:       now,
        status:     'success',
        message:    res.status === 'noop' ? 'No-op (same shelf)' : 'Moved',
      };
      setTransferLog(prev => [ok, ...prev].slice(0, 30));
      await refreshStats();
      onScanSuccess();
      showConfirmation('success', `${res.bucket_id} → ${res.to_shelf}`);
      resetTransfer();
    } catch (e: any) {
      const err: TransferLogEntry = {
        bucket_id:  transferBucket,
        from_shelf: transferFromShelf,
        to_shelf:   transferToShelf,
        time:       now,
        status:     'error',
        message:    e?.message || String(e),
      };
      setTransferLog(prev => [err, ...prev].slice(0, 30));
      onScanError();
      showConfirmation('error', e?.message || 'Transfer failed');
    } finally {
      setTransferSubmitting(false);
    }
  }, [transferBucket, transferToShelf, transferFromShelf, transferSubmitting, refreshStats, resetTransfer]);
  const [confirmation, setConfirmation] = useState<{
    visible: boolean;
    type: 'success' | 'error';
    message: string;
  }>({ visible: false, type: 'success', message: '' });

  const showConfirmation = (type: 'success' | 'error', message: string) => {
    setConfirmation({ visible: true, type, message });
  };

  const handleGoToReceiving = useCallback((bucketId: string) => {
    if (isXflora) return;
    navigation.navigate('Receive', { prefillBucketId: bucketId });
  }, [navigation, isXflora]);

  const resetToShelfScan = useCallback(() => {
    setPhase('scan-shelf');
    setCurrentShelf(null);
    setBucketCount(0);
    setEntries([]);
    setLastBucket(null);
  }, []);

  const handleShelfScanned = useCallback(
    async (data: string) => {
      const shelfId = parseScannedShelfQR(data);
      if (!shelfId) {
        onScanError();
        Alert.alert('Invalid', 'Could not read a shelf ID.');
        return;
      }

      try {
        const farm = await getFarm();
        await getOrCreateShelf(shelfId, farm);
        const count = await getShelfItemCount(shelfId);

        setCurrentShelf(shelfId);
        setBucketCount(count);
        setEntries([]);
        setPhase('scan-buckets');
        onScanSuccess();
        showConfirmation('success', `Shelf ${shelfId}`);
      } catch (error: any) {
        onScanError();
        Alert.alert('Error', error.message);
      }
    },
    []
  );

  // What the bucket just scanned actually holds. The server has always sent it;
  // the operator could never see it.
  const [lastBucket, setLastBucket] = useState<{
    bucketId: string; variety: string; stemLength: string; stems: number;
  } | null>(null);

  const handleBucketScanned = useCallback(
    async (data: string) => {
      const bucketId = parseScannedBucketQR(data);
      if (!bucketId || !currentShelf) {
        onScanError();
        Alert.alert('Invalid', 'Could not read a bucket ID.');
        return;
      }

      const now = new Date().toLocaleTimeString();
      const farm = await getFarm();

      if (isConnected) {
        try {
          const response = await submitShelve(currentShelf, bucketId, farm);
          const variety = response.variety ?? '';
          await addShelfItem(
            currentShelf,
            bucketId,
            variety,
            response.stem_length ?? '',
            response.stems ?? 0,
            '',
            true
          );

          setLastBucket({
            bucketId, variety, stemLength: response.stem_length ?? '',
            stems: response.stems ?? 0,
          });
          setEntries((prev) => [{
            bucket_id: bucketId, variety, stems: response.stems ?? 0,
            stem_length: response.stem_length ?? '', greenhouse: '',
            time: now, status: 'success', message: `${response.stems} stems`,
          }, ...prev]);
          setBucketCount((prev) => prev + 1);
          await refreshStats();
          onScanSuccess();
          showConfirmation('success', bucketId);
        } catch (error: any) {
          await addToSyncQueue('shelving_entry', { shelf_id: currentShelf, bucket_id: bucketId, farm });
          try { await addShelfItem(currentShelf, bucketId, '', '', 0, '', false); } catch {}

          setLastBucket(null);
          setEntries((prev) => [{
            bucket_id: bucketId, variety: '', stems: 0, stem_length: '', greenhouse: '',
            time: now, status: 'error', message: error.message,
          }, ...prev]);
          setBucketCount((prev) => prev + 1);
          await refreshStats();
          onScanError();
          showConfirmation('error', error.message);
        }
      } else {
        await addToSyncQueue('shelving_entry', { shelf_id: currentShelf, bucket_id: bucketId, farm });
        try { await addShelfItem(currentShelf, bucketId, '', '', 0, '', false); } catch {}

        setLastBucket(null);
        setEntries((prev) => [{
          bucket_id: bucketId, variety: '', stems: 0, stem_length: '', greenhouse: '',
          time: now, status: 'queued', message: 'Saved offline',
        }, ...prev]);
        setBucketCount((prev) => prev + 1);
        await refreshStats();
        onScanSuccess();
        showConfirmation('success', 'Saved offline');
      }
    },
    [currentShelf, isConnected, refreshStats]
  );

  return (
    <View style={styles.container}>
      {/* Mode tabs — Shelve (default) vs Transfer */}
      <View style={styles.modeTabs}>
        <TouchableOpacity
          style={[styles.modeTab, mode === 'shelve' && styles.modeTabActive]}
          onPress={() => { setMode('shelve'); resetTransfer(); }}
          activeOpacity={0.7}
        >
          <Ionicons name="add-circle-outline" size={16}
            color={mode === 'shelve' ? colors.text : colors.textMuted} />
          <Text style={[styles.modeTabText, mode === 'shelve' && styles.modeTabTextActive]}>
            Shelve
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeTab, mode === 'transfer' && styles.modeTabActive]}
          onPress={() => setMode('transfer')}
          activeOpacity={0.7}
        >
          <Ionicons name="swap-horizontal-outline" size={16}
            color={mode === 'transfer' ? colors.text : colors.textMuted} />
          <Text style={[styles.modeTabText, mode === 'transfer' && styles.modeTabTextActive]}>
            Transfer
          </Text>
        </TouchableOpacity>
      </View>

      {mode === 'transfer' ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Step 1: bucket scan */}
          {!transferBucket ? (
            <View style={styles.inputSection}>
              <Text style={styles.label}>Step 1 · Scan the bucket to move</Text>
              <ScanInput
                placeholder="Bucket ID"
                scannerTitle="Scan Bucket to Transfer"
                onScan={handleTransferBucketScanned}
              />
            </View>
          ) : (
            <>
              {/* From / To chips */}
              <View style={styles.transferChips}>
                <View style={styles.transferChip}>
                  <Text style={styles.transferChipLabel}>FROM</Text>
                  <Text style={styles.transferChipValue}>{transferFromShelf || '—'}</Text>
                </View>
                <Ionicons name="arrow-forward" size={18} color={colors.textMuted} />
                <View style={[styles.transferChip, transferToShelf && styles.transferChipFilled]}>
                  <Text style={styles.transferChipLabel}>TO</Text>
                  <Text style={styles.transferChipValue}>{transferToShelf || '— scan —'}</Text>
                </View>
              </View>
              <Text style={styles.transferBucketLine}>Bucket {transferBucket}</Text>

              {/* Step 2: destination shelf */}
              {!transferToShelf ? (
                <View style={styles.inputSection}>
                  <Text style={styles.label}>Step 2 · Scan the destination shelf</Text>
                  <ScanInput
                    placeholder="Destination Shelf ID"
                    scannerTitle="Scan Destination Shelf QR Code"
                    onScan={handleTransferDestScanned}
                  />
                </View>
              ) : (
                <View style={styles.inputSection}>
                  <TouchableOpacity
                    style={[styles.confirmBtn, transferSubmitting && styles.confirmBtnDisabled]}
                    onPress={handleConfirmTransfer}
                    disabled={transferSubmitting}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                    <Text style={styles.confirmBtnText}>
                      {transferSubmitting ? 'Moving…' : `Confirm move to ${transferToShelf}`}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={resetTransfer}
                    disabled={transferSubmitting}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.cancelBtnText}>Start over</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}

          {/* Recent transfers log */}
          {transferLog.length > 0 && (
            <View style={{ marginTop: spacing.lg }}>
              <Text style={styles.label}>Recent transfers</Text>
              {transferLog.map((l, i) => (
                <View key={`${l.bucket_id}-${i}`} style={[
                  styles.logRow,
                  l.status === 'success' ? styles.logRowOk : styles.logRowErr,
                ]}>
                  <Ionicons
                    name={l.status === 'success' ? 'checkmark-circle' : 'close-circle'}
                    size={16}
                    color={l.status === 'success' ? (colors.success || '#10b981') : colors.error}
                  />
                  <Text style={styles.logText} numberOfLines={1}>
                    {l.bucket_id}  ·  {l.from_shelf || '—'} → {l.to_shelf}
                    {l.message ? `  ·  ${l.message}` : ''}
                  </Text>
                  <Text style={styles.logTime}>{l.time}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      ) : (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {phase === 'scan-shelf' ? (
          <View style={styles.inputSection}>
            <Text style={styles.label}>Scan shelf</Text>
            <ScanInput
              placeholder="Shelf ID (e.g. A1T)"
              scannerTitle="Scan Shelf QR Code"
              onScan={handleShelfScanned}
            />
          </View>
        ) : (
          <>
            {/* Shelf header */}
            <View style={styles.shelfHeader}>
              <View style={styles.shelfHeaderLeft}>
                <Text style={styles.shelfId}>{currentShelf}</Text>
                <Text style={styles.shelfLocation}>
                  {currentShelf ? formatShelfLocation(currentShelf) : ''}
                </Text>
              </View>
              <View style={styles.bucketBadge}>
                <Text style={styles.bucketBadgeValue}>{bucketCount}</Text>
                <Text style={styles.bucketBadgeLabel}>buckets</Text>
              </View>
            </View>

            {/* What the last bucket held — the reason the operator is here */}
            {lastBucket && (
              <VarietyBanner
                variety={lastBucket.variety}
                stemLength={lastBucket.stemLength}
                stems={lastBucket.stems}
                context={`Bucket ${lastBucket.bucketId}`}
              />
            )}

            {/* Bucket scan input */}
            <View style={styles.inputSection}>
              <Text style={styles.label}>{isXflora ? 'Scan coldroom bucket' : 'Scan bucket'}</Text>
              <ScanInput
                placeholder={isXflora ? 'Coldroom bucket ID' : 'Bucket ID'}
                scannerTitle={isXflora ? 'Scan Coldroom Bucket QR Code' : 'Scan Bucket QR Code'}
                onScan={handleBucketScanned}
              />
            </View>

            {entries.length === 0 && (
              <Text style={styles.emptyText}>
                {isXflora ? 'Scan coldroom buckets to shelve them' : 'Scan buckets to shelve them'}
              </Text>
            )}

            <EntriesLog
              entries={entries}
              label="bucket"
              renderEntry={(entry, idx) => (
                <BucketEntry
                  key={`${entry.bucket_id}-${idx}`}
                  entry={entry}
                  index={idx}
                  onGoToReceiving={isXflora ? undefined : handleGoToReceiving}
                />
              )}
            />

            {/* Next shelf */}
            <TouchableOpacity style={styles.nextButton} onPress={resetToShelfScan} activeOpacity={0.6}>
              <Text style={styles.nextButtonText}>Next Shelf</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.text} />
            </TouchableOpacity>
          </>
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
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  inputSection: {
    marginBottom: spacing.lg,
  },
  label: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  modeTabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  modeTabActive: {
    backgroundColor: colors.primary + '15',
    borderColor: colors.primary,
  },
  modeTabText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  modeTabTextActive: {
    color: colors.text,
    fontFamily: fontFamily.semiBold,
  },
  transferChips: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  transferChip: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
  },
  transferChipFilled: {
    backgroundColor: colors.primary + '15',
    borderColor: colors.primary,
  },
  transferChipLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: 9,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  transferChipValue: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.text,
    marginTop: 2,
  },
  transferBucketLine: {
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
  },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmBtnText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: '#fff',
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  cancelBtnText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
    marginBottom: 4,
  },
  logRowOk: { backgroundColor: '#ECFDF5' },
  logRowErr: { backgroundColor: '#FEF2F2' },
  logText: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.text,
  },
  logTime: {
    fontFamily: fontFamily.regular,
    fontSize: 10,
    color: colors.textMuted,
  },
  shelfHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  shelfHeaderLeft: {
    flex: 1,
  },
  shelfId: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xl,
    color: colors.text,
  },
  shelfLocation: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  bucketBadge: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  bucketBadgeValue: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.text,
  },
  bucketBadgeLabel: {
    fontFamily: fontFamily.regular,
    fontSize: 10,
    color: colors.textMuted,
  },
  countText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  emptyText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xxl,
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  nextButtonText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.text,
  },
});
