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
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { listOpenOplsForPacking } from '../services/api';
import { getSetting, setSetting } from '../database/settings';
import { PackableOpl } from '../types';
import {
  colors,
  fontFamily,
  fontSize,
  spacing,
  borderRadius,
  scale,
} from '../theme';

type LayoutMode = 'list' | 'grid';
type RangeKey = '1d' | '7d' | '14d' | '30d' | 'all';
type StatusKey = 'all' | 'ready' | 'in_progress' | 'mix';

const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: '1d',  label: 'Today', days: 0 },
  { key: '7d',  label: 'Last 7 days',    days: 7 },
  { key: '14d', label: 'Last 14 days',   days: 14 },
  { key: '30d', label: 'Last 30 days',   days: 30 },
  { key: 'all', label: 'All time',       days: null },
];

const STATUSES: { key: StatusKey; label: string }[] = [
  { key: 'all',         label: 'All orders' },
  { key: 'ready',       label: 'Ready to pack' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'mix',         label: 'Mix boxes only' },
];

interface Props {
  onSelect: (opl: PackableOpl) => void;
  disabled?: boolean;
  // Screen-level actions (Fix sticker, Dashboard, …) that don't belong to
  // OplPicker itself — the caller owns the menu, this just gives it a home
  // in the same row as search/filter instead of a separate toolbar.
  onMenuPress?: () => void;
}

// ── Date helpers ─────────────────────────────────────────────────────────
function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

/**
 * How far along an order is. Pack-tab OPLs carry real per-line stem targets
 * in `pack_lines`, so that is the true figure — a box can be "closed" while
 * under target on a partial box, so box counts alone would overstate it.
 * Older OPLs (no Packing tab) only have box counts, so a box's open/closed
 * state is the best signal available without inventing numbers client-side.
 */
function packingProgress(opl: PackableOpl): { pct: number; label: string } {
  if (opl.pack_lines && opl.pack_lines.length > 0) {
    const target = opl.pack_lines.reduce((n, l) => n + (l.target_stems || 0), 0);
    const packed = opl.pack_lines.reduce((n, l) => n + (l.packed_stems || 0), 0);
    if (target > 0) {
      return {
        pct: Math.min(100, Math.round((packed / target) * 100)),
        label: `${packed.toLocaleString()} / ${target.toLocaleString()} stems`,
      };
    }
  }
  if (opl.box_count > 0) {
    const closed = Math.max(0, opl.box_count - opl.open_count);
    return {
      pct: Math.min(100, Math.round((closed / opl.box_count) * 100)),
      label: `${closed} / ${opl.box_count} boxes packed`,
    };
  }
  return { pct: 0, label: 'Not started' };
}

function statusMeta(status: PackableOpl['status'], sequence: number) {
  if (status === 'in_progress') {
    return { label: sequence > 0 ? `In progress · Box ${sequence}` : 'In progress', color: colors.success };
  }
  if (status === 'done') {
    return { label: 'Done', color: colors.textMuted };
  }
  return { label: 'Ready', color: colors.textSecondary };
}

export default function OplPicker({ onSelect, disabled, onMenuPress }: Props) {
  const [opls, setOpls] = useState<PackableOpl[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Default to today — the packer walks in and wants what's on the floor
  // right now, not a two-week backlog. Overridden below by whatever the
  // packer last had set, once that's loaded from local settings.
  const [rangeKey, setRangeKey] = useState<RangeKey>('1d');
  const [layout, setLayout] = useState<LayoutMode>('list');
  const [statusFilter, setStatusFilter] = useState<StatusKey>('all');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [presetsLoaded, setPresetsLoaded] = useState(false);

  // Remember the packer's last filter choices across sessions — re-picking
  // "This week" / "Mix only" / grid view every single time you open Packing
  // got old fast.
  useEffect(() => {
    (async () => {
      const [savedRange, savedLayout, savedStatus] = await Promise.all([
        getSetting('packing_range_key'),
        getSetting('packing_layout'),
        getSetting('packing_status_filter'),
      ]);
      if (savedRange && RANGES.some((r) => r.key === savedRange)) setRangeKey(savedRange as RangeKey);
      if (savedLayout === 'list' || savedLayout === 'grid') setLayout(savedLayout);
      if (savedStatus && STATUSES.some((s) => s.key === savedStatus)) setStatusFilter(savedStatus as StatusKey);
      setPresetsLoaded(true);
    })();
  }, []);

  // Guarded on presetsLoaded so the just-loaded values don't get immediately
  // overwritten by whatever the defaults were on the very first render.
  useEffect(() => { if (presetsLoaded) setSetting('packing_range_key', rangeKey); }, [presetsLoaded, rangeKey]);
  useEffect(() => { if (presetsLoaded) setSetting('packing_layout', layout); }, [presetsLoaded, layout]);
  useEffect(() => { if (presetsLoaded) setSetting('packing_status_filter', statusFilter); }, [presetsLoaded, statusFilter]);

  const { fromDate, toDate } = useMemo(() => {
    const r = RANGES.find((x) => x.key === rangeKey) ?? RANGES[0];
    if (r.days === null) return { fromDate: undefined, toDate: undefined };
    const today = new Date();
    return {
      fromDate: isoDay(daysAgo(r.days)),
      toDate: isoDay(today),
    };
  }, [rangeKey]);

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
    const matches = opls.filter((o) => {
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

    // The server returns these newest-first, which scatters one customer's
    // orders down the whole list — on a floor day that is a hundred rows the
    // packer has to scroll for a name they already know. Arrange it the way
    // they actually work: a box already open is finished before a new one is
    // started, and within that, customers in alphabetical order so every OPL
    // for a customer sits together.
    const rank = (s: string) => (s === 'in_progress' ? 0 : 1);
    return matches.sort((a, b) => {
      const byStatus = rank(a.status) - rank(b.status);
      if (byStatus) return byStatus;
      const byCustomer = (a.customer_name || '').localeCompare(b.customer_name || '');
      if (byCustomer) return byCustomer;
      return (a.opl || '').localeCompare(b.opl || '');
    });
  }, [opls, query, statusFilter]);

  const filtersActive = rangeKey !== '1d' || statusFilter !== 'all';
  const activeRangeLabel = RANGES.find((r) => r.key === rangeKey)?.label || 'Today';

  // ── Render helpers ────────────────────────────────────────────────────
  const renderListItem = ({ item }: { item: PackableOpl }) => (
    <ListCard opl={item} disabled={disabled} onSelect={onSelect} />
  );

  const renderGridItem = ({ item }: { item: PackableOpl }) => (
    <GridCard opl={item} disabled={disabled} onSelect={onSelect} />
  );

  return (
    <View style={styles.container}>
      {/* ── Search + filter entry point ─────────────────────────────── */}
      <View style={styles.toolRow}>
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

        <TouchableOpacity
          style={styles.filterBtn}
          onPress={() => setFilterSheetOpen(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="options-outline" size={18} color={colors.text} />
          {filtersActive && <View style={styles.filterDot} />}
        </TouchableOpacity>

        {onMenuPress && (
          <TouchableOpacity style={styles.filterBtn} onPress={onMenuPress} activeOpacity={0.7}>
            <Ionicons name="ellipsis-vertical" size={18} color={colors.text} />
          </TouchableOpacity>
        )}
      </View>

      {/* Only surfaces when the view isn't the default — a quiet reminder of
          why the list looks the way it does, not a permanent fixture. */}
      {filtersActive && (
        <Text style={styles.filterSummary} numberOfLines={1}>
          {activeRangeLabel}
          {statusFilter !== 'all' ? ` · ${STATUSES.find((s) => s.key === statusFilter)?.label}` : ''}
        </Text>
      )}

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
              // opls.length > 0 means the server DID return real OPLs for this
              // date range — a status filter (persisted from last time, per
              // the presets feature) is what's hiding them, not an actually
              // empty range. Saying so, instead of the same generic line
              // either way, is the difference between "the app is broken"
              // and "oh, I still had Mix Only on".
              : (opls && opls.length > 0)
                ? `${opls.length} OPL${opls.length !== 1 ? 's' : ''} in this range, but none match "${STATUSES.find((s) => s.key === statusFilter)?.label || statusFilter}".`
                : 'No OPLs in this range.'}
          </Text>
          {!query && statusFilter !== 'all' && opls && opls.length > 0 && (
            <TouchableOpacity style={styles.retry} onPress={() => setStatusFilter('all')}>
              <Text style={styles.retryText}>Clear status filter</Text>
            </TouchableOpacity>
          )}
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

      <FilterSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        rangeKey={rangeKey}
        onRange={setRangeKey}
        statusFilter={statusFilter}
        onStatus={setStatusFilter}
        layout={layout}
        onLayout={setLayout}
      />
    </View>
  );
}

// ── Filter sheet — everything that used to be a row of chips now lives here,
// one tap away instead of permanently on screen ─────────────────────────────
function FilterSheet({
  visible, onClose,
  rangeKey, onRange,
  statusFilter, onStatus,
  layout, onLayout,
}: {
  visible: boolean;
  onClose: () => void;
  rangeKey: RangeKey;
  onRange: (r: RangeKey) => void;
  statusFilter: StatusKey;
  onStatus: (s: StatusKey) => void;
  layout: LayoutMode;
  onLayout: (l: LayoutMode) => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sheetStyles.backdrop}>
        <View style={sheetStyles.sheet}>
          <View style={sheetStyles.head}>
            <Text style={sheetStyles.title}>Filters</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={sheetStyles.label}>Date range</Text>
          {RANGES.map((r) => (
            <FilterRow
              key={r.key}
              label={r.label}
              selected={rangeKey === r.key}
              onPress={() => onRange(r.key)}
            />
          ))}

          <Text style={sheetStyles.label}>Status</Text>
          {STATUSES.map((s) => (
            <FilterRow
              key={s.key}
              label={s.label}
              selected={statusFilter === s.key}
              onPress={() => onStatus(s.key)}
            />
          ))}

          <Text style={sheetStyles.label}>Layout</Text>
          <View style={sheetStyles.layoutRow}>
            <TouchableOpacity
              style={[sheetStyles.layoutBtn, layout === 'list' && sheetStyles.layoutBtnActive]}
              onPress={() => onLayout('list')}
              activeOpacity={0.7}
            >
              <Ionicons name="list" size={16} color={layout === 'list' ? colors.textOnPrimary : colors.text} />
              <Text style={[sheetStyles.layoutText, layout === 'list' && sheetStyles.layoutTextActive]}>List</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[sheetStyles.layoutBtn, layout === 'grid' && sheetStyles.layoutBtnActive]}
              onPress={() => onLayout('grid')}
              activeOpacity={0.7}
            >
              <Ionicons name="grid" size={16} color={layout === 'grid' ? colors.textOnPrimary : colors.text} />
              <Text style={[sheetStyles.layoutText, layout === 'grid' && sheetStyles.layoutTextActive]}>Grid</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={sheetStyles.doneBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={sheetStyles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function FilterRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={sheetStyles.row} onPress={onPress} activeOpacity={0.7}>
      <Text style={[sheetStyles.rowText, selected && sheetStyles.rowTextActive]}>{label}</Text>
      {selected && <Ionicons name="checkmark" size={18} color={colors.primary} />}
    </TouchableOpacity>
  );
}

// ── List card (full row, primary visual) ─────────────────────────────────
function ListCard({ opl, disabled, onSelect }: {
  opl: PackableOpl;
  disabled?: boolean;
  onSelect: (o: PackableOpl) => void;
}) {
  const age = ageBadge(opl.date_created);
  const status = statusMeta(opl.status, opl.current_sequence);
  const progress = packingProgress(opl);
  const [showMix, setShowMix] = useState(false);

  return (
    <View style={[listCardStyles.card, disabled && listCardStyles.disabled]}>
      <TouchableOpacity
        onPress={() => !disabled && onSelect(opl)}
        activeOpacity={0.75}
        disabled={disabled}
      >
        <View style={listCardStyles.headerRow}>
          <Text style={listCardStyles.customer} numberOfLines={1}>
            {opl.customer_name || opl.customer || '—'}
          </Text>
          {opl.is_mix && (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); setShowMix((v) => !v); }}
              hitSlop={8}
              style={listCardStyles.mixIcon}
            >
              <Ionicons name="git-merge-outline" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </View>

        <View style={listCardStyles.metaRow}>
          <Text style={listCardStyles.opl}>{opl.opl}</Text>
          {!!age && (
            <>
              <View style={listCardStyles.bullet} />
              <Text style={listCardStyles.metaMuted}>{age}</Text>
            </>
          )}
          {/* Two orders for the same customer otherwise look identical here -
              line code / drop-off point tell them apart by route, not variety. */}
          {!!opl.line_code && (
            <>
              <View style={listCardStyles.bullet} />
              <Text style={listCardStyles.metaMuted} numberOfLines={1}>{opl.line_code}</Text>
            </>
          )}
          {!!opl.delivery_point && (
            <>
              <View style={listCardStyles.bullet} />
              <Text style={listCardStyles.metaMuted} numberOfLines={1}>{opl.delivery_point}</Text>
            </>
          )}
          <View style={listCardStyles.bullet} />
          <View style={[listCardStyles.statusDot, { backgroundColor: status.color }]} />
          <Text style={[listCardStyles.metaMuted, { color: status.color }]}>{status.label}</Text>
        </View>

        <View style={listCardStyles.progressWrap}>
          <View style={listCardStyles.progressBarWrap}>
            <View style={[listCardStyles.progressBarFill, { width: `${progress.pct}%` }]} />
          </View>
          <Text style={listCardStyles.progressLabel}>{progress.label}</Text>
        </View>

        <Text style={listCardStyles.statsCaption}>
          {opl.total_stems.toLocaleString()} stems total · {opl.pack_rate}/box
        </Text>
      </TouchableOpacity>

      {showMix && (
        <View style={listCardStyles.mixDetail}>
          <Ionicons name="git-merge-outline" size={13} color={colors.textMuted} />
          <Text style={listCardStyles.mixDetailText} numberOfLines={2}>
            Mixed: {opl.varieties || 'variety breakdown not available'}
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Grid card (2-column compact) ──────────────────────────────────────────
function GridCard({ opl, disabled, onSelect }: {
  opl: PackableOpl;
  disabled?: boolean;
  onSelect: (o: PackableOpl) => void;
}) {
  const status = statusMeta(opl.status, opl.current_sequence);
  const progress = packingProgress(opl);
  const [showMix, setShowMix] = useState(false);

  return (
    <View style={[gridCardStyles.card, disabled && gridCardStyles.disabled]}>
      <TouchableOpacity onPress={() => !disabled && onSelect(opl)} activeOpacity={0.75} disabled={disabled}>
        <View style={gridCardStyles.topRow}>
          <View style={[gridCardStyles.statusDot, { backgroundColor: status.color }]} />
          <Text style={[gridCardStyles.statusText, { color: status.color }]} numberOfLines={1}>
            {status.label}
          </Text>
          {opl.is_mix && (
            <TouchableOpacity onPress={(e) => { e.stopPropagation(); setShowMix((v) => !v); }} hitSlop={8}>
              <Ionicons name="git-merge-outline" size={15} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        <Text style={gridCardStyles.customer} numberOfLines={2}>
          {opl.customer_name || opl.customer || '—'}
        </Text>
        <Text style={gridCardStyles.opl} numberOfLines={1}>{opl.opl}</Text>
        {/* Same customer, two orders — line code / drop-off point are what
            actually tell them apart on this compact card. */}
        {(!!opl.line_code || !!opl.delivery_point) && (
          <Text style={gridCardStyles.progressLabel} numberOfLines={1}>
            {[opl.line_code, opl.delivery_point].filter(Boolean).join(' · ')}
          </Text>
        )}

        <View style={gridCardStyles.progressBarWrap}>
          <View style={[gridCardStyles.progressBarFill, { width: `${progress.pct}%` }]} />
        </View>
        <Text style={gridCardStyles.progressLabel} numberOfLines={1}>{progress.label}</Text>
      </TouchableOpacity>

      {showMix && (
        <Text style={gridCardStyles.mixDetailText} numberOfLines={2}>
          Mixed: {opl.varieties || 'n/a'}
        </Text>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },

  toolRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.text,
    padding: 0,
  },
  filterBtn: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: borderRadius.md,
  },
  filterDot: {
    position: 'absolute', top: 7, right: 7,
    width: 7, height: 7, borderRadius: 3.5,
    backgroundColor: colors.primary,
  },
  filterSummary: {
    fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textMuted,
    marginBottom: spacing.sm,
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
    borderRadius: borderRadius.md,
  },
  retryText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: colors.textOnPrimary,
  },
});

const listCardStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    // Pure white card, no border — a soft shadow gives it edges instead of
    // a grey outline (the page background is a hair off-white, so this
    // reads clearly without needing a hard line around every card).
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  disabled: { opacity: 0.5 },
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
  mixIcon: { padding: 2 },
  metaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 4,
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
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  progressWrap: { marginTop: spacing.sm, gap: 4 },
  progressBarWrap: { height: 6, backgroundColor: colors.surfaceAlt, borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 3 },
  progressLabel: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: colors.text,
  },
  statsCaption: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted,
    marginTop: 4,
  },
  mixDetail: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    marginTop: spacing.sm, paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  mixDetailText: {
    flex: 1,
    fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textSecondary,
  },
});

const gridCardStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: 6,
    minHeight: scale(152),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  disabled: { opacity: 0.5 },
  topRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 4,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { flex: 1, fontFamily: fontFamily.semiBold, fontSize: 10, letterSpacing: 0.2 },
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
  progressBarWrap: {
    height: 6, backgroundColor: colors.surfaceAlt, borderRadius: 3, overflow: 'hidden',
    marginTop: 'auto',
  },
  progressBarFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 3 },
  progressLabel: {
    fontFamily: fontFamily.semiBold, fontSize: 10, color: colors.text,
  },
  mixDetailText: {
    fontFamily: fontFamily.regular, fontSize: 10, color: colors.textSecondary,
    marginTop: 2,
  },
});

const sheetStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  title: { flex: 1, fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: colors.text, letterSpacing: -0.4 },
  label: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginTop: spacing.lg, marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  rowText: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.text },
  rowTextActive: { fontFamily: fontFamily.semiBold, color: colors.primary },
  layoutRow: { flexDirection: 'row', gap: spacing.sm },
  layoutBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    paddingVertical: spacing.sm + 2,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
  },
  layoutBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  layoutText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text },
  layoutTextActive: { color: colors.textOnPrimary },
  doneBtn: {
    marginTop: spacing.xl,
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
  },
  doneBtnText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.textOnPrimary },
});
