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
import { submitShelve } from '../services/api';
import { parseScannedShelfQR, parseScannedBucketQR, formatShelfLocation } from '../utils/shelf-utils';
import ScanInput from '../components/ScanInput';
import BucketEntry from '../components/BucketEntry';
import ScanConfirmation from '../components/ScanConfirmation';
import EntriesLog from '../components/EntriesLog';
import { ScanPhase, ShelvedBucketEntry } from '../types';
import { onScanSuccess, onScanError } from '../utils/feedback';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

export default function ShelveScreen() {
  const { isConnected, refreshStats, isXflora } = useApp();
  const navigation = useNavigation<any>();
  const [phase, setPhase] = useState<ScanPhase>('scan-shelf');
  const [currentShelf, setCurrentShelf] = useState<string | null>(null);
  const [bucketCount, setBucketCount] = useState(0);
  const [entries, setEntries] = useState<ShelvedBucketEntry[]>([]);
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
          await addShelfItem(
            currentShelf,
            bucketId,
            response.stem_length ? '' : '',
            response.stem_length ?? '',
            response.stems ?? 0,
            '',
            true
          );

          setEntries((prev) => [{
            bucket_id: bucketId, variety: '', stems: response.stems ?? 0,
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
