import React, { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Animated,
  Modal,
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
  getMyHarvestByGreenhouse,
  getMyHarvestByVariety,
  getReceivedByGreenhouse,
  getHarvestVarietiesByGreenhouse,
} from '../database/reports';
import { stripStemLength } from '../types';
import { getTodayReceivingCount } from '../database/receiving';
import { getTodayActualHarvest } from '../database/actual_harvest';
import { fetchGradingDashboard, fetchDashboardData, fetchUnreceivedBuckets } from '../services/api';
import { DashboardSkeleton } from '../components/Skeleton';
import { fontFamily, fontSize, spacing, borderRadius } from '../theme';
import { GreenhouseHarvestRow, UnreceivedBucketsResponse } from '../types';

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

  // Fade-in animation for content — runs every time loading transitions to false
  // so both the first load and subsequent focus-refreshes feel smooth.
  const contentFade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (loading) {
      contentFade.setValue(0);
    } else {
      Animated.timing(contentFade, { toValue: 1, duration: 280, useNativeDriver: true }).start();
    }
  }, [loading, contentFade]);

  const [harvestStems, setHarvestStems] = useState(0);
  const [receivingCount, setReceivingCount] = useState(0);
  const [gradingStems, setGradingStems] = useState(0);
  const [rejectCount, setRejectCount] = useState(0);
  const [rejectsBySection, setRejectsBySection] = useState<{ section: string; total: number }[]>([]);
  const [harvestByGH, setHarvestByGH] = useState<{ greenhouse: string; stems: number; varieties: string }[]>([]);
  const [rejectsByGH, setRejectsByGH] = useState<{ greenhouse: string; total: number }[]>([]);
  const [receivedByGH, setReceivedByGH] = useState<{ greenhouse: string; stems: number }[]>([]);
  const [varietiesByGH, setVarietiesByGH] = useState<{ greenhouse: string; variety: string; stems: number }[]>([]);
  const [varianceByGHVariety, setVarianceByGHVariety] = useState<
    { greenhouse: string; variety: string; harvested: number; received: number; variance: number }[]
  >([]);
  const [gradingBunches, setGradingBunches] = useState(0);
  const [actualHarvest, setActualHarvest] = useState<{ greenhouse: string; variety: string; quantity: number }[]>([]);
  const [harvesterStems, setHarvesterStems] = useState(0);

  const [missingModal, setMissingModal] = useState<{
    visible: boolean;
    greenhouse: string;
    variety: string;
    loading: boolean;
    data: UnreceivedBucketsResponse | null;
  }>({ visible: false, greenhouse: '', variety: '', loading: false, data: null });

  const openMissingBuckets = useCallback(async (greenhouse: string, variety: string, _variance: number) => {
    setMissingModal({ visible: true, greenhouse, variety, loading: true, data: null });
    try {
      const today = todayISODate();
      const data = await fetchUnreceivedBuckets(greenhouse, variety, today, today);
      setMissingModal((p) => ({ ...p, loading: false, data }));
    } catch {
      setMissingModal((p) => ({ ...p, loading: false, data: null }));
    }
  }, []);

  const firstName = fullName.split(' ')[0] || 'there';

  const loadData = useCallback(async () => {
    const today = todayISODate();

    if (isHarvester) {
      setHarvesterStems(await getTodayHarvestStemsByHarvester(userEmail));
      return;
    }

    const [hs, rc, rs, rbs, hgh, rgh, gb, ah, recvGh, varGh] = await Promise.all([
      getTodayHarvestStems(),
      getTodayReceivingCount(),
      getTodayRejectCount(),
      getTodayRejectsBySection(),
      getHarvestByGreenhouse(),
      getRejectsByGreenhouse(),
      getTodayGradingBunches(),
      getTodayActualHarvest(),
      getReceivedByGreenhouse(),
      getHarvestVarietiesByGreenhouse(),
    ]);

    let harvestStemsVal = hs;
    let receivingCountVal = rc;
    let gs = await getTodayGradingStems();
    let harvestByGHVal = hgh;
    let receivedByGHVal = recvGh;
    let rejectsByGHVal = rgh;
    let varietiesByGHVal = varGh;
    let actualHarvestVal = ah;
    let rejectCountVal = rs;
    let rejectsBySectionVal = rbs;

    if (isConnected) {
      try {
        const erpDash = await fetchDashboardData(today, today);
        harvestStemsVal = erpDash.quantities?.harvesting ?? hs;
        receivingCountVal = erpDash.quantities?.receiving ?? erpDash.counts?.receiving ?? rc;
        if (erpDash.greenhouse_data?.length > 0) {
          harvestByGHVal = erpDash.greenhouse_data.map((g: any) => ({
            greenhouse: g.greenhouse_name || g.greenhouse || 'Unknown',
            stems: g.total_stems || 0,
            varieties: String(g.variety_count || 0),
          }));
        }
        // New per-greenhouse breakdowns from get_dashboard_data_full
        if (Array.isArray(erpDash.received_by_greenhouse) && erpDash.received_by_greenhouse.length > 0) {
          receivedByGHVal = erpDash.received_by_greenhouse.map((r: any) => ({
            greenhouse: String(r.greenhouse ?? ''),
            stems: Number(r.stems ?? 0),
          }));
        }
        if (Array.isArray(erpDash.rejects_by_greenhouse) && erpDash.rejects_by_greenhouse.length > 0) {
          rejectsByGHVal = erpDash.rejects_by_greenhouse.map((r: any) => ({
            greenhouse: String(r.greenhouse ?? ''),
            total: Number(r.stems ?? 0),
          }));
        }
        if (Array.isArray(erpDash.varieties_by_greenhouse) && erpDash.varieties_by_greenhouse.length > 0) {
          varietiesByGHVal = erpDash.varieties_by_greenhouse.map((r: any) => ({
            greenhouse: String(r.greenhouse ?? ''),
            variety: String(r.variety ?? ''),
            stems: Number(r.stems ?? 0),
          }));
        }
        // Per-greenhouse-per-variety harvested vs received variance
        // (single backend query → variance_by_greenhouse_variety)
        if (Array.isArray(erpDash.variance_by_greenhouse_variety)) {
          setVarianceByGHVariety(
            erpDash.variance_by_greenhouse_variety.map((r: any) => ({
              greenhouse: String(r.greenhouse ?? ''),
              variety: String(r.variety ?? ''),
              harvested: Number(r.harvested ?? 0),
              received: Number(r.received ?? 0),
              variance: Number(r.variance ?? 0),
            }))
          );
        }
        if (Array.isArray(erpDash.actual_harvest) && erpDash.actual_harvest.length > 0) {
          actualHarvestVal = erpDash.actual_harvest.map((r: any) => ({
            greenhouse: String(r.greenhouse ?? ''),
            variety: String(r.variety ?? ''),
            quantity: Number(r.quantity ?? 0),
          }));
        }
        if (typeof erpDash.rejects_total === 'number') rejectCountVal = erpDash.rejects_total;
        if (Array.isArray(erpDash.rejects_by_section) && erpDash.rejects_by_section.length > 0) {
          rejectsBySectionVal = erpDash.rejects_by_section.map((r: any) => ({
            section: String(r.section ?? ''),
            total: Number(r.total ?? 0),
          }));
        }
      } catch {}
      try {
        const dash = await fetchGradingDashboard(today, today);
        gs = dash.total_graded ?? gs;
        if (dash.grading_count != null) setGradingBunches(dash.grading_count);
      } catch {}
    }

    setHarvestStems(harvestStemsVal);
    setReceivingCount(receivingCountVal);
    setGradingStems(gs);
    setRejectCount(rejectCountVal);
    setRejectsBySection(rejectsBySectionVal);
    setHarvestByGH(harvestByGHVal);
    setRejectsByGH(rejectsByGHVal);
    setReceivedByGH(receivedByGHVal);
    setVarietiesByGH(varietiesByGHVal);
    setGradingBunches(gb);
    setActualHarvest(actualHarvestVal);
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

  // Merge harvest + received + rejects + variety breakdown by greenhouse
  const ghRows: GreenhouseHarvestRow[] = (() => {
    const map: Record<string, GreenhouseHarvestRow> = {};
    const empty = (gh: string): GreenhouseHarvestRow => ({
      greenhouse: gh, stems: 0, received: 0, varieties: '', varietyBreakdown: [], rejects: 0,
    });
    for (const r of harvestByGH) {
      map[r.greenhouse] = { ...empty(r.greenhouse), stems: r.stems, varieties: r.varieties };
    }
    for (const r of receivedByGH) {
      if (!map[r.greenhouse]) map[r.greenhouse] = empty(r.greenhouse);
      map[r.greenhouse].received = r.stems;
    }
    for (const r of rejectsByGH) {
      if (!map[r.greenhouse]) map[r.greenhouse] = empty(r.greenhouse);
      map[r.greenhouse].rejects = r.total;
    }
    // Prefer the variance breakdown (per-variety harvested AND received) when
    // available — gives us the variance per variety per greenhouse in a single
    // pass. Falls back to the harvest-only variety list when variance data is
    // absent (e.g. offline or older server).
    if (varianceByGHVariety.length > 0) {
      for (const r of varianceByGHVariety) {
        if (!map[r.greenhouse]) map[r.greenhouse] = empty(r.greenhouse);
        map[r.greenhouse].varietyBreakdown.push({
          variety: r.variety,
          stems: r.harvested,
          received: r.received,
          variance: r.variance,
        });
      }
    } else {
      for (const r of varietiesByGH) {
        if (!map[r.greenhouse]) map[r.greenhouse] = empty(r.greenhouse);
        map[r.greenhouse].varietyBreakdown.push({
          variety: r.variety, stems: r.stems, received: 0, variance: r.stems,
        });
      }
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
    ...(isXflora ? [{ name: 'Transfer', icon: 'swap-horizontal-outline' as const, tab: 'Transfer' }] : []),
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
        <Animated.ScrollView
          style={{ flex: 1, opacity: contentFade }}
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
        </Animated.ScrollView>
      </View>
    );
  }

  // ── Manager / full dashboard ───────────────────────────────────────────────
  return (
    <View style={s.container}>
      {loading ? (
        <DashboardSkeleton />
      ) : (
        <Animated.ScrollView
          style={{ flex: 1, opacity: contentFade }}
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
              <Text style={s.tileUnit}>stems</Text>
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
            <View style={s.ghSection}>
              <View style={s.ghSectionHeader}>
                <Text style={s.ghSectionLabel}>GREENHOUSES</Text>
                <Text style={s.ghSectionCount}>{ghRows.length} active</Text>
              </View>
              {ghRows.map((row) => (
                <GreenhouseRow
                  key={row.greenhouse}
                  row={row}
                  onLongPressVariety={openMissingBuckets}
                />
              ))}
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

          <MissingBucketsModal
            visible={missingModal.visible}
            greenhouse={missingModal.greenhouse}
            variety={missingModal.variety}
            loading={missingModal.loading}
            data={missingModal.data}
            onClose={() => setMissingModal((p) => ({ ...p, visible: false }))}
          />

          <View style={{ height: spacing.xxl }} />
        </Animated.ScrollView>
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

// Compact, scannable greenhouse row. One line: name on the left, paired
// harvest / received numbers on the right with a thin proportion bar beneath.
// Tapping expands a per-variety breakdown.
function GreenhouseRow({
  row,
  onLongPressVariety,
}: {
  row: GreenhouseHarvestRow;
  onLongPressVariety?: (greenhouse: string, variety: string, variance: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasVarieties = row.varietyBreakdown.length > 0;
  const ratio = row.stems > 0 ? Math.min(1, row.received / row.stems) : 0;
  const ratioPct = Math.round(ratio * 100);
  const complete = row.stems > 0 && row.received >= row.stems;

  return (
    <View style={s.ghRowCard}>
      <TouchableOpacity
        onPress={() => hasVarieties && setOpen(!open)}
        activeOpacity={hasVarieties ? 0.6 : 1}
        style={s.ghRowMain}
      >
        <View style={s.ghRowLeft}>
          <Text style={s.ghRowName} numberOfLines={1}>{row.greenhouse}</Text>
          <View style={s.ghRowMetaLine}>
            {row.varieties ? (
              <Text style={s.ghRowMeta}>
                {row.varieties} {Number(row.varieties) === 1 ? 'variety' : 'varieties'}
              </Text>
            ) : null}
            {row.rejects > 0 ? (
              <View style={s.ghRowRejDot}>
                <Text style={s.ghRowRejDotText}>·  {row.rejects} rej</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.ghRowRight}>
          <View style={s.ghRowPair}>
            <Text style={s.ghRowNum}>{row.stems.toLocaleString()}</Text>
            <Text style={s.ghRowArrow}>→</Text>
            <Text style={[s.ghRowNum, row.received === 0 && s.ghRowNumMuted, complete && s.ghRowNumGood]}>
              {row.received.toLocaleString()}
            </Text>
          </View>
          <Text style={s.ghRowRatio}>
            {row.stems > 0 ? `${ratioPct}% received` : '—'}
          </Text>
        </View>

        {hasVarieties && (
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={C.textMuted}
            style={{ marginLeft: 6 }}
          />
        )}
      </TouchableOpacity>

      <View style={s.ghRowBarTrack}>
        <View style={[s.ghRowBarFill, complete && s.ghRowBarFillFull, { width: `${ratioPct}%` }]} />
      </View>

      {open && hasVarieties && (
        <View style={s.ghVarietyList}>
          {row.varietyBreakdown.map((v) => {
            const variance = (v as any).variance ?? Math.max(0, v.stems - ((v as any).received ?? 0));
            const received = (v as any).received ?? 0;
            return (
              <TouchableOpacity
                key={v.variety}
                style={s.ghVarietyRow}
                disabled={variance <= 0 || !onLongPressVariety}
                onLongPress={() => onLongPressVariety?.(row.greenhouse, v.variety, variance)}
                delayLongPress={400}
                activeOpacity={variance > 0 ? 0.7 : 1}
              >
                <Text style={s.ghVarietyName} numberOfLines={1}>{v.variety}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                  <Text style={s.ghVarietyStems}>{v.stems.toLocaleString()}</Text>
                  <Text style={s.ghVarietyUnit}>→</Text>
                  <Text style={[s.ghVarietyStems, received === 0 && s.ghRowNumMuted]}>
                    {received.toLocaleString()}
                  </Text>
                  {variance > 0 ? (
                    <Text style={[s.ghVarietyUnit, { color: '#dc2626' }]}>
                      ({variance.toLocaleString()})
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
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

  // Compact greenhouse rows
  ghRowCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 2,
    paddingBottom: 0,
    marginBottom: spacing.xs + 2,
    overflow: 'hidden',
  },
  ghRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.sm,
  },
  ghRowLeft: { flex: 1, paddingRight: spacing.sm },
  ghRowName: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: C.text,
  },
  ghRowMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 1,
  },
  ghRowMeta: {
    fontFamily: fontFamily.regular,
    fontSize: 10,
    color: C.textMuted,
  },
  ghRowRejDot: { marginLeft: 0 },
  ghRowRejDotText: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    color: '#DC2626',
  },
  ghRowRight: { alignItems: 'flex-end' },
  ghRowPair: { flexDirection: 'row', alignItems: 'baseline' },
  ghRowNum: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    color: C.text,
    minWidth: 36,
    textAlign: 'right',
  },
  ghRowNumMuted: { color: C.textMuted, fontFamily: fontFamily.regular },
  ghRowNumGood: { color: '#15803D' },
  ghRowArrow: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    color: C.textMuted,
    marginHorizontal: 6,
  },
  ghRowRatio: {
    fontFamily: fontFamily.medium,
    fontSize: 9,
    color: C.textMuted,
    letterSpacing: 0.6,
    marginTop: 1,
    textTransform: 'uppercase',
  },
  ghRowBarTrack: {
    height: 3,
    backgroundColor: C.bg,
    marginHorizontal: -spacing.md,
  },
  ghRowBarFill: {
    height: '100%',
    backgroundColor: '#22C55E',
  },
  ghRowBarFillFull: { backgroundColor: '#15803D' },

  ghSection: { marginTop: spacing.md, marginBottom: spacing.sm },
  ghSectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    paddingHorizontal: 2,
  },
  ghSectionLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: 10,
    color: C.textMuted,
    letterSpacing: 1.4,
  },
  ghSectionCount: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    color: C.textMuted,
    letterSpacing: 0.6,
  },
  ghCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  ghCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  ghCardName: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: C.text,
  },
  ghCardSub: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: C.textMuted,
    marginTop: 2,
  },
  ghRejBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: '#FEE2E2',
  },
  ghRejBadgeText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 11,
    color: '#DC2626',
  },
  ghMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  ghMetricBlock: { flex: 1 },
  ghMetricLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 9,
    color: C.textMuted,
    letterSpacing: 1,
    marginBottom: 2,
  },
  ghMetricBig: {
    fontFamily: fontFamily.bold,
    fontSize: 26,
    color: C.text,
    lineHeight: 30,
  },
  ghMetricBigMuted: { color: C.textMuted },
  ghMetricUnit: {
    fontFamily: fontFamily.regular,
    fontSize: 10,
    color: C.textMuted,
    marginTop: 1,
  },
  ghMetricDivider: {
    width: 1,
    height: 44,
    backgroundColor: C.border,
    marginHorizontal: spacing.md,
  },
  ghProgressTrack: {
    height: 4,
    borderRadius: 4,
    backgroundColor: C.bg,
    overflow: 'hidden',
  },
  ghProgressFill: {
    height: '100%',
    backgroundColor: '#16A34A',
    borderRadius: 4,
  },

  // Legacy (kept for older references, no longer used)
  ghHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    backgroundColor: C.bg,
    gap: spacing.sm,
  },
  ghHeaderText: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    color: C.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  ghHeaderMetric: { width: 52, textAlign: 'right' },
  ghHeaderBadgeCol: { width: 36, textAlign: 'center' },
  ghHeaderChevron: { width: 16 },
  ghRowWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  ghRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
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
  ghMetric: { width: 52, alignItems: 'flex-end' },
  ghMetricNum: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: C.text,
  },
  ghMetricMuted: { color: C.textMuted, fontFamily: fontFamily.regular },
  ghReceivedNum: { color: '#0F2744' },
  ghBadgeCol: { width: 36, alignItems: 'center' },
  ghChevron: { width: 16, alignItems: 'center' },
  ghRejectBadge: {
    minWidth: 28,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
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
  ghVarietyList: {
    backgroundColor: C.bg,
    paddingVertical: spacing.xs,
  },
  ghVarietyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg + spacing.sm,
    paddingVertical: 6,
    gap: spacing.sm,
  },
  ghVarietyName: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: C.textSec,
  },
  ghVarietyStems: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: C.text,
  },
  ghVarietyUnit: {
    fontFamily: fontFamily.regular,
    fontSize: 10,
    color: C.textMuted,
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

  // Collapsible section
  collapseCard: {
    marginTop: spacing.md,
    backgroundColor: C.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  collapseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  collapseTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: C.text,
  },
  collapseBody: {
    paddingTop: 0,
    paddingBottom: spacing.sm,
  },

  // Missing buckets modal
  mbOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  mbCard: {
    backgroundColor: C.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    width: '100%',
    maxWidth: 360,
    maxHeight: '80%',
  },
  mbHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  mbTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: C.text,
  },
  mbSubtitle: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: C.textMuted,
    marginBottom: spacing.sm,
  },
  mbRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  mbBucket: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: C.text,
  },
  mbMeta: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: C.textMuted,
  },
  mbQty: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: '#dc2626',
  },
  mbEmpty: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: C.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
});

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={s.collapseCard}>
      <TouchableOpacity
        style={s.collapseHeader}
        onPress={() => setOpen(!open)}
        activeOpacity={0.7}
      >
        <Text style={s.collapseTitle}>{title}</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={C.textMuted}
        />
      </TouchableOpacity>
      {open ? <View style={s.collapseBody}>{children}</View> : null}
    </View>
  );
}

function MissingBucketsModal({
  visible,
  greenhouse,
  variety,
  loading,
  data,
  onClose,
}: {
  visible: boolean;
  greenhouse: string;
  variety: string;
  loading: boolean;
  data: UnreceivedBucketsResponse | null;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={s.mbOverlay}>
        <View style={s.mbCard}>
          <View style={s.mbHeader}>
            <Text style={s.mbTitle}>Missing Buckets</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={20} color={C.textMuted} />
            </TouchableOpacity>
          </View>
          <Text style={s.mbSubtitle}>
            {greenhouse} · {variety}
            {data ? `  ·  ${data.missing_count} buckets, ${data.missing_stems} stems` : ''}
          </Text>
          {loading ? (
            <View style={{ paddingVertical: spacing.md }}>
              <ActivityIndicator size="small" color={C.textMuted} />
            </View>
          ) : !data || data.missing_buckets.length === 0 ? (
            <Text style={s.mbEmpty}>No missing buckets — all received.</Text>
          ) : (
            <ScrollView style={{ maxHeight: 360 }}>
              {data.missing_buckets.map((b) => (
                <View key={b.bucket_id} style={s.mbRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.mbBucket}>{b.bucket_id}</Text>
                    <Text style={s.mbMeta}>
                      {b.posting_date}{b.harvester ? `  ·  ${b.harvester}` : ''}
                    </Text>
                  </View>
                  <Text style={s.mbQty}>{b.qty}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
