import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { listOpenOplsForPacking } from '../services/api';
import { PackableOpl } from '../types';
import {
  colors,
  fontFamily,
  fontSize,
  spacing,
  borderRadius,
} from '../theme';

type LayoutMode = 'list' | 'grid';
type RangeKey = '1d' | '7d' | '14d' | '30d' | 'all';

const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: '1d',  label: 'Today', days: 0 },
  { key: '7d',  label: '7d',    days: 7 },
  { key: '14d', label: '14d',   days: 14 },
  { key: '30d', label: '30d',   days: 30 },
  { key: 'all', label: 'All',   days: null },
];

interface Props {
  onSelect: (opl: PackableOpl) => void;
  disabled?: boolean;
}

// ── Date helpers ─────────────────────────────────────────────────────────
function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function formatPretty(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return iso;
  }
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function parseDateLoose(s: string | null): Date | null {
  if (!s) return null;
  try {
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}
function ageBadge(iso: string | null): string {
  const d = parseDateLoose(iso);
  if (!d) return '';
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff <= 0) return 'today';
  if (diff === 1) return '1d ago';
  return `${diff}d ago`;
}

export default function OplPicker({ onSelect, disabled }: Props) {
  const [opls, setOpls] = useState<PackableOpl[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Default: last 14 days — covers a typical week with a few days of slack
  const [rangeKey, setRangeKey] = useState<RangeKey>('14d');

  const { fromDate, toDate } = useMemo(() => {
    const r = RANGES.find((x) => x.key === rangeKey) ?? RANGES[2];
    if (r.days === null) return { fromDate: undefined, toDate: undefined };
    const today = new Date();
    return {
      fromDate: isoDay(daysAgo(r.days)),
      toDate: isoDay(today),
    };
  }, [rangeKey]);

  const [layout, setLayout] = useState<LayoutMode>('list');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'in_progress' | 'mix'>('all');

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const params: { from_date?: string; to_date?: string } = {};
      if (fromDate) params.from_date = fromDate;
      if (toDate) params.to_date = toDate;
      const resp = await listOpenOplsForPacking(params);
      setOpls(resp.opls || []);
    } catch (e: any) {
      setError(e?.message || 'Could not load OPLs');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => { load('initial'); }, [load]);

  const filtered = useMemo(() => {
    if (!opls) return [];
    const q = query.trim().toLowerCase();
    return opls.filter((o) => {
      if (statusFilter === 'ready' && o.status !== 'ready') return false;
      if (statusFilter === 'in_progress' && o.status !== 'in_progress') return false;
      if (statusFilter === 'mix' && !o.is_mix) return false;
      if (!q) return true;
      return (
        (o.customer_name || '').toLowerCase().includes(q) ||
        (o.opl || '').toLowerCase().includes(q) ||
        (o.sales_order || '').toLowerCase().includes(q) ||
        (o.varieties || '').toLowerCase().includes(q)
      );
    });
  }, [opls, query, statusFilter]);

  // ── Render helpers ────────────────────────────────────────────────────
  const renderListItem = ({ item }: { item: PackableOpl }) => (
    <ListCard opl={item} disabled={disabled} onSelect={onSelect} />
  );

  const renderGridItem = ({ item }: { item: PackableOpl }) => (
    <GridCard opl={item} disabled={disabled} onSelect={onSelect} />
  );

  return (
    <View style={styles.container}>
      {/* ── Filter bar ───────────────────────────────────────────────── */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Customer, OPL, SO or variety"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.toolRow}>
        <View style={styles.rangeGroup}>
          <Ionicons name="calendar-outline" size={13} color={colors.textSecondary} />
          {RANGES.map((r) => (
            <TouchableOpacity
              key={r.key}
              style={[styles.rangeChip, rangeKey === r.key && styles.rangeChipActive]}
              onPress={() => setRangeKey(r.key)}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.rangeChipText,
                rangeKey === r.key && styles.rangeChipTextActive,
              ]}>
                {r.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.layoutToggle}>
          <TouchableOpacity
            style={[styles.layoutBtn, layout === 'list' && styles.layoutBtnActive]}
            onPress={() => setLayout('list')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="list"
              size={14}
              color={layout === 'list' ? colors.textOnPrimary : colors.textMuted}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.layoutBtn, layout === 'grid' && styles.layoutBtnActive]}
            onPress={() => setLayout('grid')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="grid"
              size={13}
              color={layout === 'grid' ? colors.textOnPrimary : colors.textMuted}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Quick status filters */}
      <View style={styles.chipRow}>
        {(
          [
            { key: 'all',         label: 'All' },
            { key: 'ready',       label: 'Ready' },
            { key: 'in_progress', label: 'In progress' },
            { key: 'mix',         label: 'Mix box' },
          ] as const
        ).map((c) => (
          <TouchableOpacity
            key={c.key}
            style={[styles.filterChip, statusFilter === c.key && styles.filterChipActive]}
            onPress={() => setStatusFilter(c.key)}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.filterChipText,
              statusFilter === c.key && styles.filterChipTextActive,
            ]}>
              {c.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── List / Grid / States ─────────────────────────────────────── */}
      {loading && !opls ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={colors.text} />
          <Text style={styles.centerText}>Loading OPLs…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={22} color={colors.warning} />
          <Text style={styles.centerText}>{error}</Text>
          <TouchableOpacity style={styles.retry} onPress={() => load('initial')}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="file-tray-outline" size={22} color={colors.textMuted} />
          <Text style={styles.centerText}>
            {query
              ? `No OPLs match "${query}"`
              : 'No OPLs in this range.'}
          </Text>
        </View>
      ) : layout === 'list' ? (
        <FlatList
          data={filtered}
          renderItem={renderListItem}
          keyExtractor={(item) => item.opl}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('refresh')}
              tintColor={colors.textMuted}
            />
          }
        />
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderGridItem}
          keyExtractor={(item) => item.opl}
          numColumns={2}
          key="grid-2col"
          columnWrapperStyle={{ gap: spacing.sm }}
          contentContainerStyle={[styles.listContent, { gap: spacing.sm }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('refresh')}
              tintColor={colors.textMuted}
            />
          }
        />
      )}

    </View>
  );
}

// ── List card (full row, primary visual) ─────────────────────────────────
function ListCard({ opl, disabled, onSelect }: {
  opl: PackableOpl;
  disabled?: boolean;
  onSelect: (o: PackableOpl) => void;
}) {
  const age = ageBadge(opl.date_created);
  return (
    <TouchableOpacity
      style={[listCardStyles.card, disabled && listCardStyles.disabled]}
      onPress={() => !disabled && onSelect(opl)}
      activeOpacity={0.75}
      disabled={disabled}
    >
      <View style={listCardStyles.body}>
        <View style={listCardStyles.headerRow}>
          <Text style={listCardStyles.customer} numberOfLines={1}>
            {opl.customer_name || opl.customer || '—'}
          </Text>
          {opl.is_mix && (
            <View style={listCardStyles.mixPill}>
              <Text style={listCardStyles.mixPillText}>MIX</Text>
            </View>
          )}
        </View>

        <View style={listCardStyles.metaRow}>
          <Text style={listCardStyles.opl}>{opl.opl}</Text>
          {!!age && (
            <>
              <View style={listCardStyles.bullet} />
              <Text style={listCardStyles.metaMuted}>{age}</Text>
            </>
          )}
        </View>

        <View style={listCardStyles.statsRow}>
          <StatPill
            icon="layers-outline"
            label={`${opl.pack_rate}/box`}
          />
          <StatPill
            icon="leaf-outline"
            label={`${opl.total_stems.toLocaleString()} stems`}
          />
          <StatusBadge status={opl.status} sequence={opl.current_sequence} />
        </View>
      </View>

      <View style={listCardStyles.actions}>
        <View style={listCardStyles.cta}>
          <Ionicons name="chevron-forward" size={18} color={colors.text} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Grid card (2-column compact) ──────────────────────────────────────────
function GridCard({ opl, disabled, onSelect }: {
  opl: PackableOpl;
  disabled?: boolean;
  onSelect: (o: PackableOpl) => void;
}) {
  return (
    <TouchableOpacity
      style={[gridCardStyles.card, disabled && gridCardStyles.disabled]}
      onPress={() => !disabled && onSelect(opl)}
      activeOpacity={0.75}
      disabled={disabled}
    >
      <View style={gridCardStyles.topRow}>
        <StatusBadge status={opl.status} sequence={opl.current_sequence} compact />
        {opl.is_mix && (
          <View style={gridCardStyles.mixPillCompact}>
            <Text style={gridCardStyles.mixPillTextCompact}>MIX</Text>
          </View>
        )}
      </View>

      <Text style={gridCardStyles.customer} numberOfLines={2}>
        {opl.customer_name || opl.customer || '—'}
      </Text>

      <Text style={gridCardStyles.opl} numberOfLines={1}>{opl.opl}</Text>

      <View style={gridCardStyles.statsRow}>
        <View style={gridCardStyles.stat}>
          <Text style={gridCardStyles.statValue}>
            {opl.total_stems.toLocaleString()}
          </Text>
          <Text style={gridCardStyles.statLabel}>stems</Text>
        </View>
        <View style={gridCardStyles.statDivider} />
        <View style={gridCardStyles.stat}>
          <Text style={gridCardStyles.statValue}>{opl.pack_rate}</Text>
          <Text style={gridCardStyles.statLabel}>per box</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────
function StatPill({ icon, label }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
}) {
  return (
    <View style={pillStyles.pill}>
      <Ionicons name={icon} size={11} color={colors.textSecondary} />
      <Text style={pillStyles.text}>{label}</Text>
    </View>
  );
}

function StatusBadge({ status, sequence, compact }: {
  status: PackableOpl['status'];
  sequence: number;
  compact?: boolean;
}) {
  const meta = (() => {
    if (status === 'in_progress') return {
      label: sequence > 0 ? `Box ${sequence}` : 'In progress',
      bg: 'rgba(34, 197, 94, 0.12)',
      fg: '#15803d',
    };
    if (status === 'done') return {
      label: 'Done',
      bg: 'rgba(163, 163, 163, 0.18)',
      fg: '#525252',
    };
    return {
      label: 'Ready',
      bg: 'rgba(14, 165, 233, 0.12)',
      fg: '#0369a1',
    };
  })();
  return (
    <View style={[
      badgeStyles.badge,
      { backgroundColor: meta.bg },
      compact && badgeStyles.badgeCompact,
    ]}>
      <View style={[badgeStyles.dot, { backgroundColor: meta.fg }]} />
      <Text style={[badgeStyles.text, { color: meta.fg }]}>{meta.label}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },

  // Filter bar
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.text,
    padding: 0,
  },

  toolRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  rangeGroup: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.full,
    paddingHorizontal: 6, paddingVertical: 3,
    flex: 1,
  },
  rangeChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  rangeChipActive: { backgroundColor: colors.primary },
  rangeChipText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 11,
    color: colors.textSecondary,
    letterSpacing: 0.2,
  },
  rangeChipTextActive: {
    color: colors.textOnPrimary,
  },

  layoutToggle: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.full,
    padding: 2,
  },
  layoutBtn: {
    width: 30, height: 26,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: borderRadius.full,
  },
  layoutBtnActive: { backgroundColor: colors.primary },

  chipRow: {
    flexDirection: 'row', gap: 6, flexWrap: 'wrap',
    marginBottom: spacing.md,
  },
  filterChip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  filterChipTextActive: {
    color: colors.textOnPrimary,
    fontFamily: fontFamily.semiBold,
  },

  // Lists
  listContent: { paddingBottom: spacing.xxl },

  // Center states
  center: {
    flex: 1,
    alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  centerText: {
    fontFamily: fontFamily.regular, fontSize: fontSize.sm,
    color: colors.textSecondary, textAlign: 'center',
  },
  retry: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
  },
  retryText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: colors.textOnPrimary,
  },
});

const listCardStyles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  disabled: { opacity: 0.5 },
  body: { flex: 1, gap: 4 },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
  },
  customer: {
    flex: 1,
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: colors.text,
    letterSpacing: -0.3,
  },
  mixPill: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  mixPillText: {
    fontFamily: fontFamily.bold,
    fontSize: 9,
    color: colors.textOnPrimary,
    letterSpacing: 0.7,
  },
  metaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  opl: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  bullet: {
    width: 3, height: 3, borderRadius: 1.5,
    backgroundColor: colors.textMuted,
  },
  metaMuted: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 6, marginTop: 6, flexWrap: 'wrap',
  },
  actions: {
    flexDirection: 'row', alignItems: 'center',
    gap: spacing.xs,
  },
  cta: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
});

const gridCardStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: 6,
    minHeight: 152,
  },
  disabled: { opacity: 0.5 },
  topRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 4,
  },
  customer: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: colors.text,
    letterSpacing: -0.3,
    lineHeight: 20,
    minHeight: 40,
  },
  opl: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  mixPillCompact: {
    backgroundColor: colors.primary,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  mixPillTextCompact: {
    fontFamily: fontFamily.bold,
    fontSize: 9,
    color: colors.textOnPrimary,
    letterSpacing: 0.5,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.md,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 'auto',
  },
  stat: {
    flex: 1, alignItems: 'center',
  },
  statValue: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: colors.text,
    letterSpacing: -0.3,
  },
  statLabel: {
    fontFamily: fontFamily.regular,
    fontSize: 9,
    color: colors.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 1,
  },
  statDivider: {
    width: 1, alignSelf: 'stretch',
    backgroundColor: colors.border,
    marginHorizontal: 4,
  },
});

const pillStyles = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  text: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    color: colors.textSecondary,
  },
});

const badgeStyles = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  badgeCompact: {
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  dot: {
    width: 6, height: 6, borderRadius: 3,
  },
  text: {
    fontFamily: fontFamily.semiBold,
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
