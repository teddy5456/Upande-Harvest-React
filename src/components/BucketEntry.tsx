import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ShelvedBucketEntry, stripStemLength } from '../types';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

interface BucketEntryProps {
  entry: ShelvedBucketEntry;
  index: number;
  onGoToReceiving?: (bucketId: string) => void;
}

function isReceivingError(message?: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('receiv') ||
    lower.includes('not in use') ||
    lower.includes('no stock entry') ||
    lower.includes('not found')
  );
}

export default function BucketEntry({ entry, index, onGoToReceiving }: BucketEntryProps) {
  const isError = entry.status === 'error';

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

  const showReceivingAction = isError && isReceivingError(entry.message) && !!onGoToReceiving;

  return (
    <View style={[styles.row, isError && styles.rowError]}>
      <View style={styles.indexCol}>
        <Text style={styles.indexText}>{index + 1}</Text>
      </View>
      <View style={styles.mainCol}>
        <Text style={styles.bucketId}>{entry.bucket_id}</Text>
        <View style={styles.details}>
          {entry.variety ? (
            <Text style={styles.detailText}>{stripStemLength(entry.variety)}</Text>
          ) : null}
          {entry.stems > 0 ? (
            <Text style={styles.detailText}>{entry.stems} stems</Text>
          ) : null}
          {entry.stem_length ? (
            <Text style={styles.detailText}>{entry.stem_length}</Text>
          ) : null}
          {entry.greenhouse ? (
            <Text style={styles.detailText}>{entry.greenhouse}</Text>
          ) : null}
        </View>
        {isError && entry.message ? (
          <Text style={styles.errorMsg}>{entry.message}</Text>
        ) : null}
        {showReceivingAction ? (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => onGoToReceiving!(entry.bucket_id)}
            activeOpacity={0.7}
          >
            <Ionicons name="download-outline" size={13} color={colors.textOnPrimary} />
            <Text style={styles.actionButtonText}>Receive this bucket first</Text>
          </TouchableOpacity>
        ) : null}
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
  rowError: {
    backgroundColor: '#FFF5F5',
    borderLeftWidth: 3,
    borderLeftColor: colors.error,
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
  bucketId: {
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
  errorMsg: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.error,
    marginTop: 3,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.error,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: borderRadius.sm,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
  },
  actionButtonText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: colors.textOnPrimary,
  },
});
