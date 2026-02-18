import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ShelfOccupancy, SHELF_LEVELS, LEVEL_LABELS } from '../types';
import { colors, shelfColors, fontFamily, fontSize, spacing, borderRadius, shadow } from '../theme';

interface ShelfGridProps {
  occupancy: ShelfOccupancy[];
  side: string;
  onShelfPress?: (shelfId: string) => void;
}

export default function ShelfGrid({ occupancy, side, onShelfPress }: ShelfGridProps) {
  const positions = [1, 2, 3, 4, 5, 6];

  const getOccupancy = (pos: number, level: string): number => {
    const entry = occupancy.find(
      (o) => o.side === side && o.position === pos && o.level === level
    );
    return entry?.bucket_count ?? 0;
  };

  const getCellColor = (count: number) => {
    if (count === 0) return shelfColors.empty;
    if (count <= 2) return shelfColors.partial;
    return shelfColors.full;
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sideLabel}>Side {side}</Text>
      <View style={styles.grid}>
        <View style={styles.row}>
          <View style={styles.levelLabel} />
          {positions.map((pos) => (
            <View key={pos} style={styles.headerCell}>
              <Text style={styles.headerText}>{pos}</Text>
            </View>
          ))}
        </View>

        {(['T', 'M', 'B'] as const).map((level) => (
          <View key={level} style={styles.row}>
            <View style={styles.levelLabel}>
              <Text style={styles.levelText}>{LEVEL_LABELS[level]?.[0]}</Text>
            </View>
            {positions.map((pos) => {
              const count = getOccupancy(pos, level);
              const shelfId = `${side}${pos}${level}`;
              return (
                <TouchableOpacity
                  key={shelfId}
                  style={[styles.cell, { backgroundColor: getCellColor(count) }]}
                  onPress={() => onShelfPress?.(shelfId)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.cellText,
                      count >= 3 && styles.cellTextFull,
                    ]}
                  >
                    {count}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  sideLabel: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  grid: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    ...shadow.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  levelLabel: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  headerCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  headerText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  cell: {
    flex: 1,
    aspectRatio: 1,
    margin: 2,
    borderRadius: borderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cellText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  cellTextFull: {
    color: colors.textOnPrimary,
  },
});
