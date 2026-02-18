import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { addToSyncQueue } from '../database/sync-queue';
import { getFarm } from '../database/settings';
import { addReceivingEntry } from '../database/receiving';
import { submitReceiving } from '../services/api';
import ScanInput from '../components/ScanInput';
import SyncBanner from '../components/SyncBanner';
import ScanConfirmation from '../components/ScanConfirmation';
import { ReceivingListEntry } from '../types';
import { onScanSuccess, onScanError } from '../utils/feedback';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

export default function ReceivingScreen() {
  const { isConnected, refreshStats } = useApp();
  const [entries, setEntries] = useState<ReceivingListEntry[]>([]);
  const [confirmation, setConfirmation] = useState<{
    visible: boolean;
    type: 'success' | 'error';
    message: string;
  }>({ visible: false, type: 'success', message: '' });

  const showConfirmation = (type: 'success' | 'error', message: string) => {
    setConfirmation({ visible: true, type, message });
  };

  const handleScan = useCallback(
    async (data: string) => {
      const bunchId = data.trim();
      if (!bunchId) return;

      const now = new Date().toLocaleTimeString();
      const farm = await getFarm();

      if (isConnected) {
        try {
          await submitReceiving(bunchId, '', farm);
          await addReceivingEntry(bunchId, '', farm, true);

          setEntries((prev) => [
            { bunch_id: bunchId, time: now, status: 'success', message: 'Synced' },
            ...prev,
          ]);
          await refreshStats();
          onScanSuccess();
          showConfirmation('success', bunchId);
        } catch (error: any) {
          await addToSyncQueue('receiving_entry', { bunch_id: bunchId, farm });
          await addReceivingEntry(bunchId, '', farm, false);

          setEntries((prev) => [
            { bunch_id: bunchId, time: now, status: 'error', message: error.message },
            ...prev,
          ]);
          await refreshStats();
          onScanError();
          showConfirmation('error', error.message);
        }
      } else {
        await addToSyncQueue('receiving_entry', { bunch_id: bunchId, farm });
        await addReceivingEntry(bunchId, '', farm, false);

        setEntries((prev) => [
          { bunch_id: bunchId, time: now, status: 'queued', message: 'Saved offline' },
          ...prev,
        ]);
        await refreshStats();
        onScanSuccess();
        showConfirmation('success', 'Saved offline');
      }
    },
    [isConnected, refreshStats]
  );

  return (
    <View style={styles.container}>
      <SyncBanner />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.inputSection}>
          <Text style={styles.label}>Scan bunch to receive</Text>
          <ScanInput
            placeholder="Bunch ID"
            scannerTitle="Scan Bunch QR Code"
            onScan={handleScan}
          />
        </View>

        <View style={styles.countRow}>
          <Text style={styles.countText}>{entries.length} received</Text>
        </View>

        {entries.map((entry, idx) => (
          <View key={`${entry.bunch_id}-${idx}`} style={styles.entryRow}>
            <Ionicons
              name={
                entry.status === 'success'
                  ? 'checkmark-circle'
                  : entry.status === 'queued'
                    ? 'time'
                    : 'alert-circle'
              }
              size={18}
              color={
                entry.status === 'success'
                  ? colors.success
                  : entry.status === 'queued'
                    ? colors.warning
                    : colors.error
              }
            />
            <View style={styles.entryInfo}>
              <Text style={styles.entryId}>{entry.bunch_id}</Text>
              <Text style={styles.entryTime}>{entry.time}</Text>
            </View>
            {entry.message ? (
              <Text style={styles.entryMsg}>{entry.message}</Text>
            ) : null}
          </View>
        ))}

        {entries.length === 0 && (
          <Text style={styles.emptyText}>Scan bunches arriving at the packhouse</Text>
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
  countRow: {
    marginBottom: spacing.md,
  },
  countText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  entryInfo: {
    flex: 1,
  },
  entryId: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  entryTime: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  entryMsg: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  emptyText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xxl,
  },
});
