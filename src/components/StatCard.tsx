import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily, fontSize, spacing, borderRadius, shadow } from '../theme';

interface StatCardProps {
  label: string;
  value: number | string;
  icon?: keyof typeof Ionicons.glyphMap;
}

export default function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <View style={styles.card}>
      {icon ? (
        <View style={styles.iconContainer}>
          <Ionicons name={icon} size={18} color={colors.textMuted} />
        </View>
      ) : null}
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginHorizontal: spacing.xs,
    ...shadow.sm,
  },
  iconContainer: {
    marginBottom: spacing.xs,
  },
  value: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xxl,
    color: colors.text,
  },
  label: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
});
