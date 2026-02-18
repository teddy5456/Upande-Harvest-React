import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { colors, fontFamily, fontSize, spacing } from '../theme';

export default function SyncBanner() {
  const { isConnected, isSyncing, pendingSync, failedSync } = useApp();

  if (isConnected && pendingSync === 0 && failedSync === 0 && !isSyncing) {
    return null;
  }

  let icon: keyof typeof Ionicons.glyphMap = 'cloud-offline-outline';
  let label = '';
  let textColor = colors.textSecondary;

  if (!isConnected) {
    icon = 'cloud-offline-outline';
    label = `Offline${pendingSync > 0 ? ` \u00B7 ${pendingSync} queued` : ''}`;
    textColor = colors.warning;
  } else if (isSyncing) {
    label = 'Syncing...';
    textColor = colors.primary;
  } else if (failedSync > 0) {
    icon = 'alert-circle-outline';
    label = `${failedSync} failed`;
    textColor = colors.error;
  } else if (pendingSync > 0) {
    icon = 'time-outline';
    label = `${pendingSync} pending`;
    textColor = colors.warning;
  }

  return (
    <View style={styles.bar}>
      {isSyncing ? (
        <ActivityIndicator size={14} color={textColor} />
      ) : (
        <Ionicons name={icon} size={14} color={textColor} />
      )}
      <Text style={[styles.label, { color: textColor }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceAlt,
    gap: spacing.sm,
  },
  label: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
  },
});
