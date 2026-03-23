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
import { useApp } from '../context/AppContext';
import { getFarm } from '../database/settings';
import { createPackingBox, addBunchToBox, removeBunchFromBox } from '../database/packing';
import { addToSyncQueue } from '../database/sync-queue';
import { submitPackingBox } from '../services/api';
import ScanInput from '../components/ScanInput';
import SyncBanner from '../components/SyncBanner';
import ScanConfirmation from '../components/ScanConfirmation';
import { PackingListEntry } from '../types';
import { onScanSuccess, onScanError } from '../utils/feedback';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

export default function PackingScreen() {
  const { isConnected } = useApp();

  const [boxId, setBoxId] = useState<string | null>(null);
  const [bunches, setBunches] = useState<PackingListEntry[]>([]);
  const [closing, setClosing] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    visible: boolean;
    type: 'success' | 'error';
    message: string;
  }>({ visible: false, type: 'success', message: '' });

  const showConfirmation = (type: 'success' | 'error', message: string) => {
    setConfirmation({ visible: true, type, message });
  };

  const handleBoxScanned = useCallback(async (data: string) => {
    const id = data.trim();
    if (!id) return;
    const farm = await getFarm();
    await createPackingBox(id, farm);
    setBoxId(id);
    setBunches([]);
    onScanSuccess();
    showConfirmation('success', `Box: ${id}`);
  }, []);

  const handleBunchScanned = useCallback(async (data: string) => {
    if (!boxId) return;
    const id = data.trim();
    if (!id) return;

    // Prevent duplicate
    if (bunches.some((b) => b.bunch_id === id)) {
      onScanError();
      showConfirmation('error', `${id} already in box`);
      return;
    }

    await addBunchToBox(boxId, id);
    const entry: PackingListEntry = {
      bunch_id: id,
      time: new Date().toLocaleTimeString(),
      status: 'queued',
      message: 'In box',
    };
    setBunches((prev) => [entry, ...prev]);
    onScanSuccess();
    showConfirmation('success', `Bunch ${id} added`);
  }, [boxId, bunches]);

  const handleRemoveBunch = (bunchId: string) => {
    setBunches((prev) => prev.filter((b) => b.bunch_id !== bunchId));
  };

  const handleCloseBox = async () => {
    if (!boxId || bunches.length === 0) {
      Alert.alert('Empty box', 'Scan at least one bunch before closing.');
      return;
    }

    Alert.alert(
      'Close Box',
      `Close box ${boxId} with ${bunches.length} bunch${bunches.length > 1 ? 'es' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close Box',
          onPress: async () => {
            setClosing(true);
            const farm = await getFarm();
            const bunchIds = bunches.map((b) => b.bunch_id);

            if (isConnected) {
              try {
                await submitPackingBox(boxId, farm, bunchIds);
                showConfirmation('success', `Box ${boxId} closed — ${bunches.length} bunches`);
              } catch (error: any) {
                await addToSyncQueue('create_packing_box', { box_id: boxId, farm, bunches: bunchIds });
                showConfirmation('error', `Saved offline: ${error.message}`);
              }
            } else {
              await addToSyncQueue('create_packing_box', { box_id: boxId, farm, bunches: bunchIds });
              showConfirmation('success', 'Box saved offline');
            }

            setBoxId(null);
            setBunches([]);
            setClosing(false);
          },
        },
      ]
    );
  };

  const resetBox = () => {
    Alert.alert('Reset', 'Discard current box and start over?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => { setBoxId(null); setBunches([]); } },
    ]);
  };

  return (
    <View style={styles.container}>
      <SyncBanner />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

        {/* Phase 1: Scan Box */}
        {!boxId ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="cube-outline" size={20} color={colors.text} />
              <Text style={styles.sectionTitle}>Scan Box Label</Text>
            </View>
            <Text style={styles.sectionHint}>Scan the box QR/barcode to start packing</Text>
            <ScanInput
              placeholder="Box ID"
              scannerTitle="Scan Box Label"
              onScan={handleBoxScanned}
            />
          </View>
        ) : (
          <>
            {/* Active box header */}
            <View style={styles.activeBox}>
              <View style={styles.activeBoxLeft}>
                <Ionicons name="cube" size={20} color={colors.primary} />
                <View>
                  <Text style={styles.activeBoxLabel}>Active Box</Text>
                  <Text style={styles.activeBoxId}>{boxId}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={resetBox} style={styles.resetBtn}>
                <Ionicons name="refresh-outline" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Scan bunch */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="leaf-outline" size={20} color={colors.text} />
                <Text style={styles.sectionTitle}>Scan Bunch</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{bunches.length}</Text>
                </View>
              </View>
              <ScanInput
                placeholder="Bunch ID"
                scannerTitle="Scan Bunch QR Code"
                onScan={handleBunchScanned}
                disabled={closing}
              />
            </View>

            {/* Bunches list */}
            {bunches.length > 0 && (
              <View style={styles.listSection}>
                <Text style={styles.listHeader}>Bunches in box</Text>
                {bunches.map((item) => (
                  <View key={item.bunch_id} style={styles.listItem}>
                    <Ionicons name="leaf-outline" size={16} color={colors.success} />
                    <Text style={styles.listItemId} numberOfLines={1}>{item.bunch_id}</Text>
                    <Text style={styles.listItemTime}>{item.time}</Text>
                    <TouchableOpacity onPress={() => handleRemoveBunch(item.bunch_id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle-outline" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Close box button */}
            <TouchableOpacity
              style={[styles.closeBoxBtn, (closing || bunches.length === 0) && styles.closeBoxBtnDisabled]}
              onPress={handleCloseBox}
              disabled={closing || bunches.length === 0}
              activeOpacity={0.8}
            >
              <Ionicons name="checkmark-circle-outline" size={20} color={colors.textOnPrimary} />
              <Text style={styles.closeBoxBtnText}>
                {closing ? 'Closing…' : `Close Box (${bunches.length} bunch${bunches.length !== 1 ? 'es' : ''})`}
              </Text>
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
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },

  section: { marginBottom: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  sectionTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.text, flex: 1 },
  sectionHint: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted, marginBottom: spacing.md },

  countBadge: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  countBadgeText: { fontFamily: fontFamily.bold, fontSize: fontSize.xs, color: colors.textOnPrimary },

  activeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primaryMuted,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  activeBoxLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  activeBoxLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textMuted, textTransform: 'uppercase' },
  activeBoxId: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: colors.text },
  resetBtn: { padding: spacing.xs },

  listSection: { marginBottom: spacing.lg },
  listHeader: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text, marginBottom: spacing.sm },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  listItemId: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text, flex: 1 },
  listItemTime: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },

  closeBoxBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
  },
  closeBoxBtnDisabled: { opacity: 0.4 },
  closeBoxBtnText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.textOnPrimary },
});
