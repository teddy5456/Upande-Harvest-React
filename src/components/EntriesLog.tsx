import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

interface EntriesLogProps<T extends { status: string }> {
  entries: T[];
  renderEntry: (entry: T, index: number) => React.ReactNode;
  label?: string; // e.g. "scan", "entry"
}

export default function EntriesLog<T extends { status: string }>({
  entries,
  renderEntry,
  label = 'entry',
}: EntriesLogProps<T>) {
  const [expanded, setExpanded] = useState(false);

  const errors = entries.filter((e) => e.status === 'error');
  const total = entries.length;
  const errorCount = errors.length;
  const plural = (n: number) => (n === 1 ? label : `${label}s`);

  if (total === 0) return null;

  const visibleEntries = expanded ? entries : errors;

  return (
    <View style={styles.container}>
      {/* Header row */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.count}>{total} {plural(total)}</Text>
          {errorCount > 0 && (
            <View style={styles.errorBadge}>
              <Ionicons name="alert-circle" size={12} color={colors.error} />
              <Text style={styles.errorBadgeText}>{errorCount} error{errorCount > 1 ? 's' : ''}</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={styles.toggleBtn}
          onPress={() => setExpanded((p) => !p)}
          activeOpacity={0.7}
        >
          <Text style={styles.toggleText}>
            {expanded ? 'Hide' : `Show all ${total}`}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      {/* Error-only notice when collapsed */}
      {!expanded && errorCount === 0 && (
        <View style={styles.allGood}>
          <Ionicons name="checkmark-circle-outline" size={14} color={colors.success} />
          <Text style={styles.allGoodText}>All {plural(total)} OK</Text>
        </View>
      )}

      {/* Entry rows */}
      {visibleEntries.length > 0 && (
        <View style={styles.list}>
          {visibleEntries.map((entry, idx) => (
            <React.Fragment key={idx}>
              {renderEntry(entry, idx)}
            </React.Fragment>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  count: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  errorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FEF2F2',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorBadgeText: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    color: colors.error,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  toggleText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  allGood: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  allGoodText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.success,
  },
  list: {
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
});
