import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import {
  getTodayHarvestStems,
  getTodayGradingStems,
  getTodayRejectCount,
  getTodayRejectsBySection,
  getHarvestByGreenhouse,
  getRejectsByGreenhouse,
  getTodayGradingBunches,
  getTodayHarvestStemsByHarvester,
} from '../database/reports';
import { getTodayReceivingCount } from '../database/receiving';
import { getTodayActualHarvest } from '../database/actual_harvest';
import { fetchGradingDashboard, fetchDashboardData, fetchHarvesterStats } from '../services/api';
import SyncBanner from '../components/SyncBanner';
import { fontFamily, fontSize, spacing, borderRadius } from '../theme';
import { GreenhouseHarvestRow } from '../types';

const SECTION_LABEL: Record<string, string> = {
  field_reject: 'Field',
  receiving_reject: 'Receiving',
  grading_reject: 'Grading',
  packhouse_discard: 'Discard',
};

function formatDate(): string {
  const now = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]}`;
}

function todayISODate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ── Colour palette for bento cards ──────────────────────────────────────────
const C = {
  heroGreen: '#052E16',
  heroGreenAccent: '#0A4A22',
  tileBlue: '#0F2744',
  tileStone: '#1C1917',
  tileRed: '#3B0A0A',
  tileMint: '#ECFDF5',
  warmAmber: '#FFFBEB',
  tileGreen: '#F0FDF4',
  text: '#171717',
  textMuted: '#A3A3A3',
  textSec: '#525252',
  border: '#E5E5E5',
  surface: '#FFFFFF',
  bg: '#FAFAFA',
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  primary: '#171717',
};

export default function DashboardScreen() {
  const { fullName, userEmail, isConnected, pendingSync, isXflora, isHarvester } = useApp();
  const navigation = useNavigation<any>();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [harvestStems, setHarvestStems] = useState(0);
  const [receivingCount, setReceivingCount] = useState(0);
  const [gradingStems, setGradingStems] = useState(0);
  const [rejectCount, setRejectCount] = useState(0);
  const [rejectsBySection, setRejectsBySection] = useState<{ section: string; total: number }[]>([]);
  const [harvestByGH, setHarvestByGH] = useState<{ greenhouse: string; stems: number; varieties: string }[]>([]);
  const [rejectsByGH, setRejectsByGH] = useState<{ greenhouse: string; total: number }[]>([]);
  const [gradingBunches, setGradingBunches] = useState(0);
  const [actualHarvest, setActualHarvest] = useState<{ greenhouse: string; variety: string; quantity: number }[]>([]);
  const [harvesterStems, setHarvesterStems] = useState(0);

  const firstName = fullName.split(' ')[0] || 'there';

  const loadData = useCallback(async () => {
    const today = todayISODate();

    if (isHarvester) {
      const localStems = await getTodayHarvestStemsByHarvester(userEmail);
      let stemsVal = localStems;
      if (isConnected) {
        try {
          const resp = await fetchHarvesterStats(userEmail, today);
          stemsVal = resp.total_stems ?? localStems;
        } catch {}
      }
      setHarvesterStems(stemsVal);
      return;
    }

    const [hs, rc, rs, rbs, hgh, rgh, gb, ah] = await Promise.all([
      getTodayHarvestStems(),
      getTodayReceivingCount(),
      getTodayRejectCount(),
      getTodayRejectsBySection(),
      getHarvestByGreenhouse(),
      getRejectsByGreenhouse(),
      getTodayGradingBunches(),
      getTodayActualHarvest(),
    ]);

    let harvestStemsVal = hs;
    let receivingCountVal = rc;
    let gs = await getTodayGradingStems();
    let harvestByGHVal = hgh;

    if (isConnected) {
      try {
        const erpDash = await fetchDashboardData(today, today);
        harvestStemsVal = erpDash.quantities?.harvesting ?? hs;
        receivingCountVal = erpDash.counts?.receiving ?? rc;
        if (erpDash.greenhouse_data?.length > 0) {
          harvestByGHVal = erpDash.greenhouse_data.map((g: any) => ({
            greenhouse: g.greenhouse_name || g.greenhouse || 'Unknown',
            stems: g.total_stems || 0,
            varieties: String(g.variety_count || 0),
          }));
        }
      } catch {}
      try {
        const dash = await fetchGradingDashboard();
        gs = dash.total_graded ?? gs;
      } catch {}
    }

    setHarvestStems(harvestStemsVal);
    setReceivingCount(receivingCountVal);
    setGradingStems(gs);
    setRejectCount(rs);
    setRejectsBySection(rbs);
    setHarvestByGH(harvestByGHVal);
    setRejectsByGH(rgh);
    setGradingBunches(gb);
    setActualHarvest(ah);
  }, [isConnected, isHarvester, userEmail]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadData().finally(() => setLoading(false));
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // Merge harvest + rejects by greenhouse
  const ghRows: GreenhouseHarvestRow[] = (() => {
    const map: Record<string, GreenhouseHarvestRow> = {};
    for (const r of harvestByGH) {
      map[r.greenhouse] = { greenhouse: r.greenhouse, stems: r.stems, varieties: r.varieties, rejects: 0 };
    }
    for (const r of rejectsByGH) {
      if (map[r.greenhouse]) map[r.greenhouse].rejects = r.total;
      else map[r.greenhouse] = { greenhouse: r.greenhouse, stems: 0, varieties: '', rejects: r.total };
    }
    return Object.values(map).sort((a, b) => b.stems - a.stems);
  })();

  const totalActual = actualHarvest.reduce((s, e) => s + e.quantity, 0);
  const variance = totalActual - harvestStems;
  const variancePct = harvestStems > 0 ? Math.round((variance / harvestStems) * 100) : 0;
  const hasActualData = actualHarvest.length > 0;

  const XFLORA_HIDDEN_TABS = new Set(isXflora ? ['Harvest', 'ActualHarvest'] : []);
  const QUICK_ACTIONS = [
    { name: 'Harvest', icon: 'leaf-outline' as const, tab: 'Harvest' },
    { name: 'Receive', icon: 'download-outline' as const, tab: 'Receive' },
    { name: 'Shelve', icon: 'scan-outline' as const, tab: 'Shelve' },
    { name: 'Grade', icon: 'clipboard-outline' as const, tab: 'Grade' },
    { name: 'Quality', icon: 'shield-checkmark-outline' as const, tab: 'Quality' },
    { name: 'Actual', icon: 'analytics-outline' as const, tab: 'ActualHarvest' },
    { name: 'Settings', icon: 'settings-outline' as const, tab: 'Settings' },
  ].filter(qa => !XFLORA_HIDDEN_TABS.has(qa.tab));

  // ── Harvester view ─────────────────────────────────────────────────────────
  if (!loading && isHarvester) {
    return (
      <View style={s.container}>
        <SyncBanner />
        <ScrollView
          contentContainerStyle={s.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
        >
          <Header firstName={firstName} isConnected={isConnected} pendingSync={pendingSync} />

          {/* Harvester hero */}
          <View style={s.hero}>
            <View style={s.heroBubble} />
            <Text style={s.heroChip}>YOUR HARVEST TODAY</Text>
            <Text style={s.heroNumber}>{harvesterStems.toLocaleString()}</Text>
            <Text style={s.heroUnit}>stems</Text>
          </View>

          <View style={s.row}>
            <ActionChip icon="leaf-outline" label="Harvest" onPress={() => navigation.navigate('Harvest')} />
            <ActionChip icon="settings-outline" label="Settings" onPress={() => navigation.navigate('Settings')} />
          </View>
          <View style={{ height: spacing.xxl }} />
        </ScrollView>
      </View>
    );
  }

  // ── Manager / full dashboard ───────────────────────────────────────────────
  return (
    <View style={s.container}>
      <SyncBanner />
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        >
          <Header firstName={firstName} isConnected={isConnected} pendingSync={pendingSync} onRefresh={onRefresh} />

          {/* Hero — Harvest stems */}
          {!isXflora && (
            <View style={s.hero}>
              <View style={s.heroBubble} />
              <Text style={s.heroChip}>FIELD HARVEST TODAY</Text>
              <Text style={s.heroNumber}>{harvestStems.toLocaleString()}</Text>
              <Text style={s.heroUnit}>stems</Text>
              <Ionicons name="leaf" size={72} color="rgba(255,255,255,0.06)" style={s.heroIcon} />
            </View>
          )}

          {/* 2-col tiles: Received + Graded */}
          <View style={s.row}>
            <View style={[s.tile, { backgroundColor: C.tileBlue }]}>
              <Text style={s.tileChip}>RECEIVED</Text>
              <Text style={s.tileNumber}>{receivingCount.toLocaleString()}</Text>
              <Text style={s.tileUnit}>buckets</Text>
            </View>
            <View style={[s.tile, { backgroundColor: C.tileStone }]}>
              <Text style={s.tileChip}>GRADED</Text>
              <Text style={s.tileNumber}>{gradingStems.toLocaleString()}</Text>
              <Text style={s.tileUnit}>stems</Text>
            </View>
          </View>

          {/* Rejects tile */}
          <View style={[s.rejectTile, rejectCount > 0 && s.rejectTileActive]}>
            <View style={s.rejectTileLeft}>
              <Text style={[s.tileChip, rejectCount > 0 ? { color: '#FECACA' } : {}]}>REJECTS</Text>
              <Text style={[s.heroNumber, { fontSize: 36 }, rejectCount > 0 ? { color: '#FCA5A5' } : { color: C.textMuted }]}>
                {rejectCount.toLocaleString()}
              </Text>
              <Text style={[s.tileUnit, rejectCount > 0 ? { color: '#FCA5A5' } : {}]}>stems today</Text>
            </View>
            {rejectsBySection.length > 0 && (
              <View style={s.rejectBreakdown}>
                {rejectsBySection.map((r) => (
                  <View key={r.section} style={s.rejectBreakdownRow}>
                    <Text style={s.rejectBreakdownLabel}>{SECTION_LABEL[r.section] ?? r.section}</Text>
                    <Text style={s.rejectBreakdownValue}>{r.total}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Variance card */}
          {!isXflora && hasActualData && (
            <View style={s.varianceCard}>
              <Text style={s.folderTab}>HARVEST VS COUNT</Text>
              <View style={s.varianceBody}>
                <View style={s.varianceStat}>
                  <Text style={s.varianceStatLabel}>Recorded</Text>
                  <Text style={s.varianceStatNum}>{harvestStems.toLocaleString()}</Text>
                  <Text style={s.varianceStatUnit}>stems</Text>
                </View>
                <View style={s.varianceDivider} />
                <View style={s.varianceStat}>
                  <Text style={s.varianceStatLabel}>Counted</Text>
                  <Text style={s.varianceStatNum}>{totalActual.toLocaleString()}</Text>
                  <Text style={s.varianceStatUnit}>stems</Text>
                </View>
                <View style={s.varianceDivider} />
                <View style={s.varianceStat}>
                  <Text style={s.varianceStatLabel}>Difference</Text>
                  <Text style={[s.varianceStatNum, variance >= 0 ? s.deltaPos : s.deltaNeg]}>
                    {variance >= 0 ? '+' : ''}{variance}
                  </Text>
                  <Text style={[s.varianceStatUnit, variance >= 0 ? s.deltaPos : s.deltaNeg]}>
                    {variancePct >= 0 ? '+' : ''}{variancePct}%
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* Greenhouse breakdown */}
          {ghRows.length > 0 && (
            <View style={s.folderCard}>
              <View style={s.folderTabRow}>
                <Text style={s.folderTab}>GREENHOUSES</Text>
                <Text style={s.folderTabCount}>{ghRows.length}</Text>
              </View>
              {ghRows.map((row, i) => {
                const rejectRatio = row.stems > 0 ? row.rejects / row.stems : 0;
                return (
                  <View key={i} style={[s.ghRow, i === ghRows.length - 1 && s.ghRowLast]}>
                    <View style={s.ghLeft}>
                      <Text style={s.ghName} numberOfLines={1}>{row.greenhouse}</Text>
                      {row.varieties ? (
                        <Text style={s.ghVariety}>{row.varieties} {Number(row.varieties) === 1 ? 'variety' : 'varieties'}</Text>
                      ) : null}
                    </View>
                    <View style={s.ghRight}>
                      <Text style={s.ghStems}>{row.stems.toLocaleString()}</Text>
                      <Text style={s.ghStemsUnit}>stems</Text>
                    </View>
                    {row.rejects > 0 ? (
                      <View style={s.ghRejectBadge}>
                        <Text style={s.ghRejectText}>{row.rejects} rej</Text>
                      </View>
                    ) : (
                      <View style={[s.ghRejectBadge, s.ghRejectBadgeOk]}>
                        <Text style={s.ghRejectOkText}>clean</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* Grading detail */}
          {gradingBunches > 0 && (
            <View style={s.folderCard}>
              <Text style={s.folderTab}>GRADING</Text>
              <View style={s.row} >
                <View style={[s.miniTile, { backgroundColor: C.tileGreen }]}>
                  <Text style={[s.miniTileNum, { color: '#166534' }]}>{gradingBunches.toLocaleString()}</Text>
                  <Text style={[s.miniTileLabel, { color: '#166534' }]}>bunches</Text>
                </View>
                <View style={[s.miniTile, { backgroundColor: C.tileMint }]}>
                  <Text style={[s.miniTileNum, { color: '#166534' }]}>{gradingStems.toLocaleString()}</Text>
                  <Text style={[s.miniTileLabel, { color: '#166534' }]}>stems</Text>
                </View>
              </View>
            </View>
          )}

          {/* Quick actions */}
          <View style={s.actionsWrap}>
            <Text style={s.actionsLabel}>QUICK ACTIONS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.actionsRow}>
              {QUICK_ACTIONS.map((qa) => (
                <ActionChip key={qa.name} icon={qa.icon} label={qa.name} onPress={() => navigation.navigate(qa.tab)} />
              ))}
            </ScrollView>
          </View>

          <View style={{ height: spacing.xxl }} />
        </ScrollView>
      )}
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Header({
  firstName, isConnected, pendingSync, onRefresh,
}: {
  firstName: string; isConnected: boolean; pendingSync: number; onRefresh?: () => void;
}) {
  return (
    <View style={s.header}>
      <View>
        <Text style={s.headerDate}>{formatDate()}</Text>
        <Text style={s.headerName}>Hi, {firstName}</Text>
      </View>
      <View style={s.headerRight}>
        <View style={[s.statusPill, isConnected ? s.pillLive : s.pillOffline]}>
          <View style={[s.statusDot, isConnected ? s.dotLive : s.dotOffline]} />
          <Text style={[s.statusText, isConnected ? s.statusTextLive : s.statusTextOffline]}>
            {isConnected ? 'Live' : 'Offline'}
          </Text>
        </View>
        {pendingSync > 0 && (
          <View style={s.syncBadge}>
            <Ionicons name="cloud-upload-outline" size={11} color={C.warning} />
            <Text style={s.syncBadgeText}>{pendingSync}</Text>
          </View>
        )}
        {onRefresh && (
          <TouchableOpacity onPress={onRefresh} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="refresh-outline" size={18} color={C.textMuted} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function ActionChip({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.actionChip} onPress={onPress} activeOpacity={0.75}>
      <Ionicons name={icon} size={15} color={C.text} />
      <Text style={s.actionChipLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.xl,
  },
  headerDate: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: C.textMuted, marginBottom: 2 },
  headerName: { fontFamily: fontFamily.bold, fontSize: fontSize.xxl, color: C.text },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },

  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: borderRadius.full, borderWidth: 1,
  },
  pillLive: { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' },
  pillOffline: { backgroundColor: '#FEF3C7', borderColor: '#FCD34D' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  dotLive: { backgroundColor: '#16A34A' },
  dotOffline: { backgroundColor: '#D97706' },
  statusText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs },
  statusTextLive: { color: '#16A34A' },
  statusTextOffline: { color: '#D97706' },
  syncBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: borderRadius.full, backgroundColor: '#FFFBEB',
    borderWidth: 1, borderColor: '#FDE68A',
  },
  syncBadgeText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: C.warning },

  // Hero card
  hero: {
    backgroundColor: C.heroGreen,
    borderRadius: 24,
    padding: spacing.xl,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    position: 'relative',
    minHeight: 160,
  },
  heroBubble: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
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
    fontSize: 52,
    color: '#FFFFFF',
    lineHeight: 56,
  },
  heroUnit: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
  },
  heroIcon: {
    position: 'absolute',
    bottom: spacing.lg,
    right: spacing.xl,
  },

  // 2-col tiles
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  tile: {
    flex: 1,
    borderRadius: 20,
    padding: spacing.lg,
    minHeight: 110,
    justifyContent: 'flex-end',
  },
  tileChip: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  tileNumber: {
    fontFamily: fontFamily.bold,
    fontSize: 34,
    color: '#FFFFFF',
    lineHeight: 38,
  },
  tileUnit: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },

  // Rejects tile
  rejectTile: {
    backgroundColor: C.tileStone,
    borderRadius: 20,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.lg,
  },
  rejectTileActive: { backgroundColor: C.tileRed },
  rejectTileLeft: { flex: 1 },
  rejectBreakdown: {
    justifyContent: 'center',
    gap: spacing.xs,
    paddingTop: 6,
  },
  rejectBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minWidth: 100,
  },
  rejectBreakdownLabel: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.45)',
  },
  rejectBreakdownValue: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: '#FCA5A5',
  },

  // Variance card
  varianceCard: {
    backgroundColor: C.warmAmber,
    borderRadius: 20,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  varianceBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    marginTop: spacing.md,
  },
  varianceStat: { alignItems: 'center', flex: 1 },
  varianceDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#FDE68A',
  },
  varianceStatLabel: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: '#92400E',
    marginBottom: 4,
  },
  varianceStatNum: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xl,
    color: C.text,
  },
  varianceStatUnit: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: C.textMuted,
    marginTop: 2,
  },
  deltaPos: { color: '#16A34A' },
  deltaNeg: { color: '#DC2626' },

  // Folder cards (greenhouse, grading)
  folderCard: {
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  folderTabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  folderTab: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    color: C.textMuted,
    letterSpacing: 1.2,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  folderTabCount: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: C.textMuted,
  },

  ghRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    gap: spacing.sm,
  },
  ghRowLast: {},
  ghLeft: { flex: 1 },
  ghName: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: C.text,
  },
  ghVariety: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: C.textMuted,
    marginTop: 1,
  },
  ghRight: { alignItems: 'flex-end', marginRight: spacing.sm },
  ghStems: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: C.text,
  },
  ghStemsUnit: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: C.textMuted,
  },
  ghRejectBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: '#FEE2E2',
  },
  ghRejectBadgeOk: { backgroundColor: '#DCFCE7' },
  ghRejectText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: '#DC2626',
  },
  ghRejectOkText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: '#16A34A',
  },

  // Mini tiles inside folder
  miniTile: {
    flex: 1,
    borderRadius: 14,
    margin: spacing.md,
    marginTop: 0,
    padding: spacing.md,
    alignItems: 'center',
  },
  miniTileNum: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xl,
  },
  miniTileLabel: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    marginTop: 2,
  },

  // Actions
  actionsWrap: { marginTop: spacing.sm },
  actionsLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    color: C.textMuted,
    letterSpacing: 1.2,
    marginBottom: spacing.sm,
  },
  actionsRow: { gap: spacing.sm, paddingBottom: 4 },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.surface,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionChipLabel: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: C.text,
  },

  // Removed unused accordion / table styles — data now displayed in bento cards
});
