/**
 * What is in this bucket, said loudly.
 *
 * Shelving, Receiving and Receiving Out all put an operator in front of a bucket
 * whose contents they cannot see from the outside — the variety and the stem
 * length live only on the harvest record. Both were either thrown away by the
 * screen or buried in a dot-separated line of metadata at 12px, and stem length
 * was actively stripped out of the variety name by `stripStemLength()` before
 * display.
 *
 * So: one component, used by all three, showing the variety large and the length
 * as its own chip beside it. The length is a separate mark rather than a suffix
 * because it is what the operator is matching against a shelf or an order, and a
 * number at the tail of a word does not get read at arm's length.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { extractStemLength, stripStemLength } from '../types';
import { borderRadius, colors, fontFamily, fontSize, spacing } from '../theme';

interface Props {
  /** Item code or item name, with or without a length suffix ("Athena-50cm"). */
  variety?: string | null;
  /** Length from the server when it sends one; otherwise read off the variety. */
  stemLength?: string | null;
  /** Stems in the bucket, when known. */
  stems?: number | null;
  /** Greenhouse or any other single line of context. */
  context?: string | null;
  /** 'lg' for a full-width card on a scan screen, 'sm' for a list row. */
  size?: 'lg' | 'sm';
}

export default function VarietyBanner({
  variety, stemLength, stems, context, size = 'lg',
}: Props) {
  const name = stripStemLength(variety || '').trim();
  // Server-supplied length wins; fall back to the tail of the variety name so a
  // response that only carries "Athena-50cm" still shows the 50cm.
  const len = (stemLength || extractStemLength(variety || '') || '').trim();

  // Nothing known — say so rather than rendering an empty box that looks broken.
  if (!name && !len) {
    return (
      <View style={[styles.wrap, size === 'sm' && styles.wrapSm, styles.wrapUnknown]}>
        <Ionicons name="help-circle-outline" size={size === 'lg' ? 20 : 15}
          color={colors.textMuted} />
        <Text style={styles.unknown}>Variety not recorded on this bucket</Text>
      </View>
    );
  }

  const big = size === 'lg';
  return (
    <View style={[styles.wrap, !big && styles.wrapSm]}>
      <View style={styles.row}>
        <Text
          style={[styles.name, !big && styles.nameSm]}
          numberOfLines={2}
          adjustsFontSizeToFit={big}
          minimumFontScale={0.7}
        >
          {name || 'Unnamed variety'}
        </Text>
        {!!len && (
          <View style={[styles.lenChip, !big && styles.lenChipSm]}>
            <Text style={[styles.lenText, !big && styles.lenTextSm]}>{len}</Text>
          </View>
        )}
      </View>
      {(stems != null || !!context) && (
        <Text style={[styles.meta, !big && styles.metaSm]}>
          {[stems != null ? `${stems} stems` : '', context || '']
            .filter(Boolean).join('  ·  ')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  wrapSm: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: 'transparent',
  },
  wrapUnknown: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  unknown: {
    fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted, flex: 1,
  },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Big, but not shouting: tight tracking and a single weight keep it a label
  // rather than a headline. adjustsFontSizeToFit handles the long names.
  name: {
    flexShrink: 1,
    fontFamily: fontFamily.semiBold,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.8,
    color: colors.text,
  },
  nameSm: { fontSize: fontSize.md, lineHeight: 20, letterSpacing: -0.2 },

  // The length is the operator's matching key, so it gets its own mark.
  lenChip: {
    backgroundColor: colors.text,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
  },
  lenChipSm: { paddingHorizontal: spacing.sm, paddingVertical: 1 },
  lenText: {
    fontFamily: fontFamily.semiBold, fontSize: 17, letterSpacing: -0.2,
    color: colors.textOnPrimary,
  },
  lenTextSm: { fontSize: fontSize.xs },

  meta: {
    fontFamily: fontFamily.regular, fontSize: fontSize.sm,
    color: colors.textSecondary, marginTop: 5,
  },
  metaSm: { fontSize: fontSize.xs, marginTop: 2 },
});
