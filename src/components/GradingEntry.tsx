import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GradedEntry, stripStemLength } from '../types';
import { colors, fontFamily, fontSize, spacing } from '../theme';

interface GradingEntryProps {
  entry: GradedEntry;
  index: number;
}

export default function GradingEntry({ entry, index }: GradingEntryProps) {
  const statusColor =
    entry.status === 'success'
      ? colors.success
      : entry.status === 'queued'
        ? colors.warning
        : colors.error;

  const statusIcon: keyof typeof Ionicons.glyphMap =
    entry.status === 'success'
      ? 'checkmark-circle'
      : entry.status === 'queued'
        ? 'time'
        : 'alert-circle';

  return (
    <View style={styles.row}>
      <View style={styles.indexCol}>
        <Text style={styles.indexText}>{index + 1}</Text>
      </View>
      <View style={styles.mainCol}>
        <Text style={styles.bunchId}>{entry.bunch_id}</Text>
        <View style={styles.details}>
          {entry.variety ? (
            <Text style={styles.detailText}>{stripStemLength(entry.variety)}</Text>
          ) : null}
          {entry.qty > 0 ? (
            <Text style={styles.detailText}>{entry.qty} stems</Text>
          ) : null}
          {entry.stem_length ? (
            <Text style={styles.detailText}>{entry.stem_length}</Text>
          ) : null}
          {entry.bucket_id ? (
            <Text style={styles.detailText}>{entry.bucket_id}</Text>
          ) : null}
        </View>
        <Text style={styles.time}>{entry.time}</Text>
      </View>
      <View style={styles.statusCol}>
        <Ionicons name={statusIcon} size={22} color={statusColor} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  indexCol: {
    width: 28,
    alignItems: 'center',
  },
  indexText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  mainCol: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  bunchId: {
    fontFamily: 'monospace',
    fontSize: fontSize.md,
    color: colors.text,
  },
  details: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 2,
    gap: spacing.sm,
  },
  detailText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  time: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  statusCol: {
    marginLeft: spacing.sm,
  },
});
