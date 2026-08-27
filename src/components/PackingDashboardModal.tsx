import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Modal, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchPackingDashboard } from '../services/api';
import { PackingDashboardData, PackingDashboardBreakdown } from '../types';
import { fontFamily, fontSize, spacing, scale, isCompactDevice } from '../theme';

// Same visual language as DashboardScreen (hero card, 2-col tiles, folder
// cards) — Teddy asked for the packing dashboard to "look exactly like the
// main dashboard". Kept as its own component rather than reusing
// DashboardScreen directly: that screen is 1300+ lines of harvest-specific
// data wiring that doesn't apply here.
const C = {
  heroGreen: '#052E16',
  heroGreenAccent: '#0A4A22',
  tileBlue: '#0F2744',
  tileStone: '#1C1917',
  text: '#171717',
  textMuted: '#A3A3A3',
  border: '#E5E5E5',
  surface: '#FFFFFF',
  bg: '#FAFAFA',
  warmAmber: '#FFFBEB',
};

function BreakdownCard({ title, rows, unitLabel }: {
  title: string;
  rows: PackingDashboardBreakdown[];
  unitLabel: string;
}) {
  if (!rows.length) return null;
  const label = (r: PackingDashboardBreakdown) => r.customer || r.variety || r.farm || '—';
  return (
    <View style={s.folderCard}>
      <Text style={s.folderTab}>{title}</Text>
      {rows.map((r, i) => (
        <View key={`${label(r)}-${i}`} style={s.breakdownRow}>
          <Text style={s.breakdownLabel} numberOfLines={1}>{label(r)}</Text>
          <Text style={s.breakdownValue}>
            {r.stems.toLocaleString()} <Text style={s.breakdownUnit}>{unitLabel}</Text>
          </Text>
        </View>
      ))}
    </View>
  );
}

export default function PackingDashboardModal({ visible, onClose }: {
  visible: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PackingDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetchPackingDashboard(today, today);
      setData(res);
    } catch (e: any) {
      setError(e?.message || 'Could not load packing dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const t = data?.totals;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.container}>
        <View style={s.header}>
          <View>
            <Text style={s.headerDate}>TODAY</Text>
            <Text style={s.headerName}>Packing</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={s.closeBtn}>
            <Ionicons name="close" size={22} color={C.text} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={C.text} /></View>
        ) : error ? (
          <View style={s.center}>
            <Text style={s.errorText}>{error}</Text>
            <TouchableOpacity style={s.retryBtn} onPress={load}>
              <Text style={s.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView contentContainerStyle={s.content}>
            {/* Hero — stems packed today */}
            <View style={s.hero}>
              <View style={s.heroBubble} />
              <Text style={s.heroChip}>STEMS PACKED TODAY</Text>
              <Text style={s.heroNumber}>{(t?.stems || 0).toLocaleString()}</Text>
              <Text style={s.heroUnit}>{t?.closed || 0} boxes closed</Text>
              <Ionicons name="cube" size={72} color="rgba(255,255,255,0.06)" style={s.heroIcon} />
            </View>

            {/* 2-col tiles: Open boxes + Avg fill % */}
            <View style={s.row}>
              <View style={[s.tile, { backgroundColor: C.tileBlue }]}>
                <Text style={s.tileChip}>OPEN BOXES</Text>
                <Text style={s.tileNumber}>{t?.open || 0}</Text>
                <Text style={s.tileUnit}>in progress</Text>
              </View>
              <View style={[s.tile, { backgroundColor: C.tileStone }]}>
                <Text style={s.tileChip}>AVG FILL</Text>
                <Text style={s.tileNumber}>{t?.avg_fill_pct || 0}%</Text>
                <Text style={s.tileUnit}>of pack rate</Text>
              </View>
            </View>

            {data?.mix_vs_single && (
              <View style={s.varianceCard}>
                <Text style={s.folderTab}>MIX VS SINGLE-VARIETY</Text>
                <View style={s.varianceBody}>
                  <View style={s.varianceStat}>
                    <Text style={s.varianceStatLabel}>Mix boxes</Text>
                    <Text style={s.varianceStatNum}>{data.mix_vs_single.mix.boxes}</Text>
                    <Text style={s.varianceStatUnit}>{data.mix_vs_single.mix.stems.toLocaleString()} stems</Text>
                  </View>
                  <View style={s.varianceDivider} />
                  <View style={s.varianceStat}>
                    <Text style={s.varianceStatLabel}>Single boxes</Text>
                    <Text style={s.varianceStatNum}>{data.mix_vs_single.single.boxes}</Text>
                    <Text style={s.varianceStatUnit}>{data.mix_vs_single.single.stems.toLocaleString()} stems</Text>
                  </View>
                </View>
              </View>
            )}

            {(t?.downsized_stems ?? 0) > 0 && (
              <View style={s.folderCard}>
                <Text style={s.folderTab}>DOWNSIZED</Text>
                <View style={s.row}>
                  <View style={[s.miniTile, { backgroundColor: '#F0FDF4' }]}>
                    <Text style={s.miniTileNum}>{t!.downsized_stems.toLocaleString()}</Text>
                    <Text style={s.miniTileLabel}>stems</Text>
                  </View>
                  <View style={[s.miniTile, { backgroundColor: '#ECFDF5' }]}>
                    <Text style={s.miniTileNum}>{t!.downsized_entries}</Text>
                    <Text style={s.miniTileLabel}>entries</Text>
                  </View>
                </View>
              </View>
            )}

            <BreakdownCard title="TOP CUSTOMERS" rows={data?.per_customer || []} unitLabel="stems" />
            <BreakdownCard title="TOP VARIETIES" rows={data?.per_variety || []} unitLabel="stems" />
            <BreakdownCard title="PER FARM" rows={data?.per_farm || []} unitLabel="stems" />

            {!t?.boxes && (
              <View style={s.center}>
                <Text style={s.emptyText}>Nothing packed yet today.</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: spacing.xxl, gap: spacing.md },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  headerDate: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: C.textMuted, marginBottom: 2, letterSpacing: 1 },
  headerName: { fontFamily: fontFamily.bold, fontSize: fontSize.xxl, color: C.text },
  closeBtn: { padding: 4 },

  errorText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: C.text, textAlign: 'center', paddingHorizontal: spacing.xl },
  retryBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: C.tileStone, borderRadius: scale(20) },
  retryText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: '#fff' },
  emptyText: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: C.textMuted },

  hero: {
    backgroundColor: C.heroGreen,
    borderRadius: scale(24),
    padding: spacing.xl,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    position: 'relative',
    minHeight: scale(160),
  },
  heroBubble: {
    position: 'absolute',
    width: scale(200),
    height: scale(200),
    borderRadius: scale(100),
    backgroundColor: C.heroGreenAccent,
    bottom: -60,
    right: -40,
  },
  heroChip: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 1.2,
    marginBottom: spacing.sm,
  },
  heroNumber: {
    fontFamily: fontFamily.bold,
    fontSize: isCompactDevice ? 30 : 52,
    color: '#FFFFFF',
    lineHeight: isCompactDevice ? 34 : 56,
  },
  heroUnit: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
  },
  heroIcon: { position: 'absolute', bottom: spacing.lg, right: spacing.xl },

  row: {
    flexDirection: isCompactDevice ? 'column' : 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  tile: {
    flex: isCompactDevice ? 0 : 1,
    borderRadius: scale(20),
    padding: spacing.lg,
    minHeight: scale(110),
    justifyContent: 'flex-end',
  },
  tileChip: { fontFamily: fontFamily.medium, fontSize: isCompactDevice ? 9 : 10, color: 'rgba(255,255,255,0.5)', letterSpacing: 1, marginBottom: spacing.xs },
  tileNumber: { fontFamily: fontFamily.bold, fontSize: isCompactDevice ? 22 : 34, color: '#FFFFFF', lineHeight: isCompactDevice ? 26 : 38 },
  tileUnit: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: 'rgba(255,255,255,0.5)', marginTop: 2 },

  varianceCard: {
    backgroundColor: C.warmAmber,
    borderRadius: scale(20),
    padding: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  varianceBody: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginTop: spacing.md },
  varianceStat: { alignItems: 'center', flex: 1 },
  varianceDivider: { width: 1, height: scale(40), backgroundColor: '#FDE68A' },
  varianceStatLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: '#92400E', marginBottom: 4 },
  varianceStatNum: { fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: C.text },
  varianceStatUnit: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: C.textMuted, marginTop: 2 },

  folderCard: {
    backgroundColor: C.surface,
    borderRadius: scale(20),
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    paddingBottom: spacing.sm,
  },
  folderTab: {
    fontFamily: fontFamily.medium,
    fontSize: isCompactDevice ? 9 : 10,
    color: C.textMuted,
    letterSpacing: 1.2,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  miniTile: { flex: 1, borderRadius: scale(14), padding: spacing.md, alignItems: 'center', marginHorizontal: spacing.xs },
  miniTileNum: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: '#166534' },
  miniTileLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: '#166534' },

  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs + 2,
    gap: spacing.md,
  },
  breakdownLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: C.text, flex: 1 },
  breakdownValue: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: C.text },
  breakdownUnit: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: C.textMuted },
});
