import React from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BouquetRecipe, BouquetVarietyRecipe } from '../types';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

export interface BouquetVarietyState {
  variety: BouquetVarietyRecipe;
  bucket_id: string | null;
  stems: number;
}

interface Props {
  recipe: BouquetRecipe;
  bunchesCount: number;
  onBunchesCountChange: (value: number) => void;
  varieties: BouquetVarietyState[];
  onSubmit: () => void;
  submitting: boolean;
}

export default function BouquetRecipeCard({
  recipe,
  bunchesCount,
  onBunchesCountChange,
  varieties,
  onSubmit,
  submitting,
}: Props) {
  const allFilled = varieties.every((v) => v.bucket_id);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerText}>
          Bouquet {recipe.bouquet_group} • {recipe.number_of_bunches} bunches total
        </Text>
        <View style={styles.bunchInputRow}>
          <Text style={styles.bunchLabel}>Grading</Text>
          <TextInput
            style={styles.bunchInput}
            keyboardType="numeric"
            value={String(bunchesCount)}
            onChangeText={(t) => onBunchesCountChange(Math.max(1, parseInt(t || '1', 10)))}
          />
          <Text style={styles.bunchLabel}>bunches now</Text>
        </View>
      </View>

      {varieties.map((row) => (
        <View key={row.variety.item_code} style={styles.varietyRow}>
          <View style={styles.varietyInfo}>
            <Text style={styles.varietyName}>{row.variety.item_name}</Text>
            <Text style={styles.varietyMeta}>
              {row.variety.stems_per_bunch} stems/bunch • need{' '}
              {row.variety.stems_per_bunch * bunchesCount}
            </Text>
          </View>
          <View style={styles.bucketSlot}>
            {row.bucket_id ? (
              <>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                <Text style={styles.bucketText}>{row.bucket_id}</Text>
              </>
            ) : (
              <Text style={styles.bucketPlaceholder}>scan bucket…</Text>
            )}
          </View>
        </View>
      ))}

      <TouchableOpacity
        style={[styles.submitBtn, (!allFilled || submitting) && styles.submitBtnDisabled]}
        disabled={!allFilled || submitting}
        onPress={onSubmit}
      >
        <Text style={styles.submitBtnText}>
          {submitting ? 'Submitting…' : 'Submit Bouquet'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    margin: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
  },
  headerText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
  },
  bunchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  bunchLabel: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  bunchInput: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minWidth: 32,
    textAlign: 'center',
    paddingHorizontal: spacing.xs,
  },
  varietyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  varietyInfo: {
    flex: 1,
  },
  varietyName: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  varietyMeta: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  bucketSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 100,
    justifyContent: 'flex-end',
  },
  bucketText: {
    fontFamily: 'monospace',
    fontSize: fontSize.sm,
    color: colors.text,
  },
  bucketPlaceholder: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.surface,
  },
});
