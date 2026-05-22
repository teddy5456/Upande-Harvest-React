import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { addToSyncQueue } from '../database/sync-queue';
import { submitBucketTransfer } from '../services/api';
import { parseScannedBucketQR } from '../utils/shelf-utils';
import ScanInput from '../components/ScanInput';
import ScanConfirmation from '../components/ScanConfirmation';
import EntriesLog from '../components/EntriesLog';
import { ReceivingListEntry, stripStemLength } from '../types';
import { onScanSuccess, onScanError } from '../utils/feedback';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

type Phase = 'scan-source' | 'scan-destination';

interface SourceDetail {
  bucket_id: string;
  variety?: string;
  greenhouse?: string;
  qty?: number;
}

export default function TransferScreen() {
  const { isConnected, refreshStats } = useApp();
  const [phase, setPhase] = useState<Phase>('scan-source');
  const [source, setSource] = useState<SourceDetail | null>(null);
  const [entries, setEntries] = useState<ReceivingListEntry[]>([]);
  const [confirmation, setConfirmation] = useState<{
    visible: boolean; type: 'success' | 'error'; message: string;
  }>({ visible: false, type: 'success', message: '' });

  const showConfirmation = (type: 'success' | 'error', message: string) => {
    setConfirmation({ visible: true, type, message });
  };

  const reset = () => {
    setSource(null);
    setPhase('scan-source');
  };

  const handleScanSource = useCallback((data: string) => {
    const bucketId = parseScannedBucketQR(data);
    if (!bucketId) { onScanError(); return; }
    setSource({ bucket_id: bucketId });
    setPhase('scan-destination');
    onScanSuccess();
    showConfirmation('success', `Source ${bucketId}`);
  }, []);

  const handleScanDestination = useCallback(async (data: string) => {
    const destId = parseScannedBucketQR(data);
    if (!destId || !source) { onScanError(); return; }
    const now = new Date().toLocaleTimeString();

    if (isConnected) {
      try {
        const response = await submitBucketTransfer(source.bucket_id, destId);
        setEntries((prev) => [{
          bucket_id: source.bucket_id,
          coldroom_bucket_id: destId,
          variety: response.variety,
          greenhouse: response.greenhouse,
          time: now,
          status: 'success',
          message: `→ ${destId}`,
        }, ...prev]);
        await refreshStats();
        onScanSuccess();
        showConfirmation('success', destId);
        reset();
      } catch (error: any) {
        await addToSyncQueue('bucket_transfer', {
          source_bucket_id: source.bucket_id,
          destination_bucket_id: destId,
        });
        setEntries((prev) => [{
          bucket_id: source.bucket_id,
          coldroom_bucket_id: destId,
          time: now,
          status: 'error',
          message: error.message,
        }, ...prev]);
        onScanError();
        showConfirmation('error', error.message);
        reset();
      }
    } else {
      await addToSyncQueue('bucket_transfer', {
        source_bucket_id: source.bucket_id,
        destination_bucket_id: destId,
      });
      setEntries((prev) => [{
        bucket_id: source.bucket_id,
        coldroom_bucket_id: destId,
        time: now,
        status: 'queued',
        message: 'Saved offline',
      }, ...prev]);
      onScanSuccess();
      showConfirmation('success', 'Saved offline');
      reset();
    }
  }, [source, isConnected, refreshStats]);

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        <View style={styles.inputSection}>
          <View style={styles.stepRow}>
            <View style={[styles.stepBadge, phase === 'scan-destination' ? styles.stepDone : styles.stepActive]}>
              <Text style={styles.stepNum}>1</Text>
            </View>
            <Text style={styles.label}>Scan source bucket</Text>
          </View>

          {phase === 'scan-destination' && source ? (
            <View style={styles.scannedRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <View style={styles.scannedInfo}>
                <Text style={styles.scannedId}>{source.bucket_id}</Text>
                {source.variety ? (
                  <Text style={styles.scannedDetail}>
                    {stripStemLength(source.variety)}
                    {source.greenhouse ? `  ·  ${source.greenhouse}` : ''}
                    {source.qty ? `  ·  ${source.qty} stems` : ''}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.rescanLabel} onPress={reset}>Re-scan</Text>
            </View>
          ) : (
            <ScanInput
              placeholder="Source bucket ID"
              scannerTitle="Scan Source Bucket"
              onScan={handleScanSource}
            />
          )}
        </View>

        {phase === 'scan-destination' ? (
          <View style={styles.inputSection}>
            <View style={styles.stepRow}>
              <View style={[styles.stepBadge, styles.stepActive]}>
                <Text style={styles.stepNum}>2</Text>
              </View>
              <Text style={styles.label}>Scan destination bucket</Text>
            </View>
            <ScanInput
              placeholder="Destination bucket ID"
              scannerTitle="Scan Destination Bucket"
              onScan={handleScanDestination}
            />
          </View>
        ) : null}

        {entries.length === 0 && (
          <Text style={styles.emptyText}>
            Scan a source bucket, then scan the destination it transfers into
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
                    {[stripStemLength(entry.variety || ''), entry.greenhouse].filter(Boolean).join('  ·  ')}
                  </Text>
                ) : null}
                <Text style={styles.entryTime}>{entry.time}</Text>
              </View>
              {entry.message && entry.status !== 'success' ? <Text style={styles.entryMsg}>{entry.message}</Text> : null}
            </View>
          )}
        />
      </ScrollView>

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

  inputSection: { marginBottom: spacing.lg },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  stepBadge: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  stepActive: { backgroundColor: colors.primary },
  stepDone: { backgroundColor: colors.success },
  stepNum: { fontFamily: fontFamily.bold, fontSize: 11, color: colors.textOnPrimary },
  label: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.text, flex: 1 },

  scannedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  scannedInfo: { flex: 1 },
  scannedId: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.text },
  scannedDetail: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  rescanLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.primary, paddingHorizontal: spacing.sm },

  emptyText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },

  entryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  entryInfo: { flex: 1 },
  entryId: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  coldroomId: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.success, marginTop: 2 },
  entryDetail: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  entryTime: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  entryMsg: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.error, maxWidth: 140, textAlign: 'right' },
});
