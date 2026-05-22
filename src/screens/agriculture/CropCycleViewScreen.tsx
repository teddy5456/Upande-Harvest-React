import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useApp } from '../../context/AppContext';
import { listActiveCropCycles } from '../../services/api';
import { CropCycleSummary } from '../../types';
import {
  colors,
  fontFamily,
  fontSize,
  spacing,
  borderRadius,
  shadow,
} from '../../theme';

function statusColor(status: string): string {
  if (status === 'Active') return colors.success;
  if (status === 'Planned') return colors.warning;
  if (status === 'Replanting' || status === 'Partially Uprooted') return colors.warning;
  if (status === 'Completed' || status === 'Ended') return colors.textMuted;
  return colors.textSecondary;
}

export default function CropCycleViewScreen() {
  const { isConnected } = useApp();
  const [cycles, setCycles] = useState<CropCycleSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'active' | 'all'>('active');

  const load = useCallback(async () => {
    if (!isConnected) return;
    setLoading(true);
    try {
      setCycles(await listActiveCropCycles(undefined, 200));
    } catch {
      setCycles([]);
    }
    setLoading(false);
  }, [isConnected]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const grouped = useMemo(() => {
    const byGH = new Map<string, CropCycleSummary[]>();
    const filtered = statusFilter === 'active'
      ? cycles.filter((c) => c.cycle_status === 'Active')
      : cycles;
    for (const c of filtered) {
      const arr = byGH.get(c.greenhouse) ?? [];
      arr.push(c);
      byGH.set(c.greenhouse, arr);
    }
    return Array.from(byGH.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [cycles, statusFilter]);

  const totalLive = useMemo(
    () => grouped.reduce((s, [, arr]) => s + arr.reduce((x, c) => x + c.current_live_plants, 0), 0),
    [grouped]
  );
  const totalHarvested = useMemo(
    () => grouped.reduce((s, [, arr]) => s + arr.reduce((x, c) => x + c.total_stems_harvested, 0), 0),
    [grouped]
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <Text style={styles.heading}>Crop Cycles</Text>
      <Text style={styles.sub}>Read-only overview of active plantings</Text>

      <View style={styles.segmented}>
        {(['active', 'all'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.segItem, statusFilter === f && styles.segItemActive]}
            onPress={() => setStatusFilter(f)}
            activeOpacity={0.7}
          >
            <Text style={[styles.segText, statusFilter === f && styles.segTextActive]}>
              {f === 'active' ? 'Active only' : 'All cycles'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.summary}>
        <View style={styles.summaryCell}>
          <Text style={styles.summaryValue}>{totalLive.toLocaleString()}</Text>
          <Text style={styles.summaryLabel}>live plants</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCell}>
          <Text style={styles.summaryValue}>{totalHarvested.toLocaleString()}</Text>
          <Text style={styles.summaryLabel}>stems harvested</Text>
        </View>
      </View>

      {loading && cycles.length === 0 ? (
        <ActivityIndicator color={colors.textMuted} style={{ marginTop: spacing.xl }} />
      ) : grouped.length === 0 ? (
        <Text style={styles.emptyText}>No crop cycles</Text>
      ) : (
        grouped.map(([gh, list]) => (
          <View key={gh} style={styles.ghBlock}>
            <Text style={styles.ghName}>{gh}</Text>
            {list.map((c) => (
              <View key={c.name} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{c.name}</Text>
                    {c.variety && <Text style={styles.cardMeta}>{c.variety}</Text>}
                  </View>
                  <View style={[styles.statusPill, { borderColor: statusColor(c.cycle_status) }]}>
                    <Text style={[styles.statusText, { color: statusColor(c.cycle_status) }]}>
                      {c.cycle_status}
                    </Text>
                  </View>
                </View>
                <View style={styles.metrics}>
                  <View style={styles.metric}>
                    <Text style={styles.metricValue}>{c.current_live_plants.toLocaleString()}</Text>
                    <Text style={styles.metricLabel}>live</Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricValue}>
                      {c.total_stems_harvested.toLocaleString()}
                    </Text>
                    <Text style={styles.metricLabel}>harvested</Text>
                  </View>
                  {c.mortality_rate_pct != null && (
                    <View style={styles.metric}>
                      <Text style={[styles.metricValue, { color: c.mortality_rate_pct > 5 ? colors.error : colors.text }]}>
                        {c.mortality_rate_pct.toFixed(1)}%
                      </Text>
                      <Text style={styles.metricLabel}>mortality</Text>
                    </View>
                  )}
                  {c.planting_date && (
                    <View style={styles.metric}>
                      <Text style={styles.metricValue}>{c.planting_date}</Text>
                      <Text style={styles.metricLabel}>planted</Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  heading: { fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: colors.text },
  sub: {
    fontFamily: fontFamily.regular, fontSize: fontSize.sm,
    color: colors.textSecondary, marginBottom: spacing.md,
  },
  segmented: {
    flexDirection: 'row', backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.full, padding: 2,
    alignSelf: 'center', marginBottom: spacing.lg,
  },
  segItem: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderRadius: borderRadius.full,
  },
  segItemActive: { backgroundColor: colors.primary },
  segText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.textSecondary },
  segTextActive: { color: colors.textOnPrimary },
  summary: {
    flexDirection: 'row', backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    paddingVertical: spacing.md, marginBottom: spacing.lg, ...shadow.sm,
  },
  summaryCell: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  summaryValue: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: colors.text },
  summaryLabel: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs,
    color: colors.textMuted, marginTop: 2,
  },
  ghBlock: { marginBottom: spacing.lg },
  ghName: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.xs,
    color: colors.textMuted, textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm, ...shadow.sm,
  },
  cardTop: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: spacing.sm,
  },
  cardTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text },
  cardMeta: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs,
    color: colors.textSecondary, marginTop: 2,
  },
  statusPill: {
    paddingHorizontal: spacing.sm, paddingVertical: 2,
    borderRadius: borderRadius.full, borderWidth: 1,
  },
  statusText: {
    fontFamily: fontFamily.medium, fontSize: 10,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  metric: { minWidth: 60 },
  metricValue: { fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: colors.text },
  metricLabel: {
    fontFamily: fontFamily.regular, fontSize: 10,
    color: colors.textMuted, marginTop: 1,
  },
  emptyText: {
    fontFamily: fontFamily.regular, fontSize: fontSize.sm,
    color: colors.textMuted, paddingVertical: spacing.xl, textAlign: 'center',
  },
});
