/**
 * DiscardSection — Quality > Discard
 *
 * Two tabs (Intake / Dispatch) — one per coldstore. Operator:
 *   1. picks an Approved Discard Request from the list,
 *   2. scans buckets (Intake) or bunches (Dispatch) against it,
 *   3. each scan deshelves the unit and posts a Material Issue server-side.
 *
 * Reason / quantity live on the Discard Request itself — there are no
 * per-scan prompts here. The server hard-blocks scans whose variety isn't
 * approved or whose stems would exceed the cap, so speed is the priority.
 *
 * Implementation note: this is a presentational shell that lives inside
 * QualityScreen. It receives nothing from the parent except a "show" toast
 * callback so confirmations route through the same ScanConfirmation used by
 * other quality flows.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import {
  getOpenDiscardRequests,
  consumeDiscardRequest,
} from '../../services/api';
import {
  DiscardColdstore,
  DiscardRequestSummary,
  stripStemLength,
} from '../../types';
import ScanInput from '../../components/ScanInput';
import { onScanSuccess, onScanError } from '../../utils/feedback';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../../theme';

type Toast = (type: 'success' | 'error', message: string) => void;

interface Props {
  show: Toast;
}

const TABS: { key: DiscardColdstore; label: string; sub: string; icon: string }[] = [
  { key: 'Intake',   label: 'Intake',   sub: 'Scan buckets', icon: 'archive-outline' },
  { key: 'Dispatch', label: 'Dispatch', sub: 'Scan bunches', icon: 'send-outline' },
];

export default function DiscardSection({ show }: Props) {
  const { isConnected } = useApp();
  const [coldstore, setColdstore] = useState<DiscardColdstore>('Intake');
  const [requests, setRequests] = useState<DiscardRequestSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<DiscardRequestSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recent, setRecent] = useState<{ scan: string; stems: number; variety: string; t: string }[]>([]);

  const loadRequests = useCallback(async (silent = false) => {
    if (!isConnected) {
      setRequests([]);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const res = await getOpenDiscardRequests(coldstore);
      setRequests(res.requests || []);
      // If the previously selected request just completed (or was cancelled
      // by another user), bail back to the picker.
      if (selected && !(res.requests || []).find((r) => r.name === selected.name)) {
        setSelected(null);
      } else if (selected) {
        const fresh = (res.requests || []).find((r) => r.name === selected.name);
        if (fresh) setSelected(fresh);
      }
    } catch (e: any) {
      show('error', e?.message || 'Failed to load Discard Requests');
    } finally {
      if (!silent) setLoading(false);
      setRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coldstore, isConnected, selected?.name]);

  useEffect(() => {
    setSelected(null);
    setRecent([]);
    loadRequests();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coldstore]);

  const handleScan = useCallback(async (raw: string) => {
    if (!selected) return;
    const scanId = (raw || '').trim();
    if (!scanId) return;
    if (!isConnected) {
      onScanError();
      show('error', 'Go online — Discard scans need server access');
      return;
    }
    setSubmitting(true);
    try {
      const res = await consumeDiscardRequest(selected.name, scanId);
      onScanSuccess();
      const displayVariety = stripStemLength(res.variety) || res.variety;
      show('success', `${res.stems} stems · ${displayVariety}`);
      setRecent((prev) => [
        { scan: scanId, stems: res.stems, variety: displayVariety, t: new Date().toLocaleTimeString() },
        ...prev,
      ].slice(0, 20));

      // Patch local state in place — avoids a full reload between every scan.
      setSelected((prev) => {
        if (!prev) return prev;
        const items = prev.items.map((it) =>
          it.variety === res.row.variety
            ? { ...it, qty_discarded: res.row.qty_discarded, qty_remaining: res.row.qty_remaining }
            : it,
        );
        const total_discarded = items.reduce((s, it) => s + it.qty_discarded, 0);
        const total_remaining = items.reduce((s, it) => s + it.qty_remaining, 0);
        return { ...prev, items, total_discarded, total_remaining };
      });

      // Auto-completed → kick the operator back to the picker.
      if (res.request_status === 'Completed') {
        show('success', `Request ${selected.name} fully discarded`);
        setSelected(null);
        await loadRequests(true);
      }
    } catch (e: any) {
      onScanError();
      show('error', e?.message || 'Scan refused');
    } finally {
      setSubmitting(false);
    }
  }, [selected, isConnected, show, loadRequests]);

  // ── Renders ─────────────────────────────────────────────────────────────

  const renderTabBar = () => (
    <View style={styles.tabBar}>
      {TABS.map((t) => {
        const active = coldstore === t.key;
        return (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, active && styles.tabActive]}
            onPress={() => setColdstore(t.key)}
            activeOpacity={0.7}
          >
            <Ionicons name={t.icon as any} size={14} color={active ? colors.textOnPrimary : colors.textMuted} />
            <View>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
              <Text style={[styles.tabSub, active && styles.tabSubActive]}>{t.sub}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderPicker = () => (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); loadRequests(); }}
        />
      }
    >
      {loading ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={styles.loadingText}>Loading requests…</Text>
        </View>
      ) : requests.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Ionicons name="checkmark-done-circle-outline" size={32} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No open requests</Text>
          <Text style={styles.emptyBody}>
            {coldstore === 'Intake'
              ? 'Once a Packhouse Manager raises an Intake discard and Sales approves it, it appears here.'
              : 'Once a Packhouse Manager raises a Dispatch discard and Sales approves it, it appears here.'}
          </Text>
        </View>
      ) : (
        requests.map((req) => (
          <TouchableOpacity
            key={req.name}
            style={styles.requestCard}
            onPress={() => setSelected(req)}
            activeOpacity={0.85}
          >
            <View style={styles.requestHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.requestId}>{req.name}</Text>
                <Text style={styles.requestReason}>{req.reason}</Text>
              </View>
              <View style={styles.requestTotals}>
                <Text style={styles.requestTotalValue}>{req.total_remaining}</Text>
                <Text style={styles.requestTotalLabel}>stems left</Text>
              </View>
            </View>
            <View style={styles.requestMeta}>
              <Text style={styles.requestMetaLine} numberOfLines={1}>
                {req.items.length} variet{req.items.length === 1 ? 'y' : 'ies'}
                {req.approved_at ? ` · approved ${req.approved_at.slice(0, 10)}` : ''}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );

  const progressRows = useMemo(() => selected?.items ?? [], [selected]);

  const renderScanMode = () => (
    <View style={{ flex: 1 }}>
      <View style={styles.scanHeader}>
        <TouchableOpacity onPress={() => setSelected(null)} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={18} color={colors.text} />
          <Text style={styles.backText}>Requests</Text>
        </TouchableOpacity>
        <Text style={styles.scanTitle} numberOfLines={1}>{selected!.name}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryReason}>{selected!.reason}</Text>
          <View style={styles.summaryTotals}>
            <View style={styles.summaryCell}>
              <Text style={styles.summaryValue}>{selected!.total_requested}</Text>
              <Text style={styles.summaryLabel}>Requested</Text>
            </View>
            <View style={styles.summaryCell}>
              <Text style={styles.summaryValue}>{selected!.total_discarded}</Text>
              <Text style={styles.summaryLabel}>Discarded</Text>
            </View>
            <View style={[styles.summaryCell, styles.summaryCellHi]}>
              <Text style={[styles.summaryValue, styles.summaryValueHi]}>{selected!.total_remaining}</Text>
              <Text style={[styles.summaryLabel, styles.summaryLabelHi]}>Remaining</Text>
            </View>
          </View>
        </View>

        <ScanInput
          placeholder={coldstore === 'Intake' ? 'Scan bucket' : 'Scan bunch'}
          scannerTitle={coldstore === 'Intake' ? 'Scan Bucket' : 'Scan Bunch'}
          onScan={handleScan}
          disabled={submitting}
          keepFocused
        />

        {submitting && (
          <View style={styles.loadingBlock}>
            <ActivityIndicator size="small" color={colors.textMuted} />
            <Text style={styles.loadingText}>Posting discard…</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Varieties</Text>
        {progressRows.map((row) => {
          const pct = row.qty_requested > 0
            ? Math.min(100, Math.round((row.qty_discarded / row.qty_requested) * 100))
            : 0;
          const done = row.qty_remaining <= 0;
          return (
            <View key={row.variety} style={styles.progressRow}>
              <View style={styles.progressHeader}>
                <Text style={styles.progressVariety} numberOfLines={1}>
                  {stripStemLength(row.variety_name || row.variety) || row.variety}
                </Text>
                <Text style={[styles.progressCount, done && styles.progressCountDone]}>
                  {row.qty_discarded}/{row.qty_requested}
                </Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${pct}%` }, done && styles.progressFillDone]} />
              </View>
            </View>
          );
        })}

        {recent.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Recent scans</Text>
            {recent.map((r, i) => (
              <View key={`${r.scan}-${i}`} style={styles.recentRow}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                <Text style={styles.recentScan} numberOfLines={1}>{r.scan}</Text>
                <Text style={styles.recentVariety} numberOfLines={1}>{r.variety}</Text>
                <Text style={styles.recentStems}>{r.stems}</Text>
                <Text style={styles.recentTime}>{r.t}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.container}>
      {renderTabBar()}
      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color="#92400E" />
          <Text style={styles.offlineText}>Offline — Discard requires server access</Text>
        </View>
      )}
      {selected ? renderScanMode() : renderPicker()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  tabBar: {
    flexDirection: 'row', gap: spacing.sm, padding: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md, backgroundColor: colors.surfaceAlt,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.text },
  tabTextActive: { color: colors.textOnPrimary },
  tabSub: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  tabSubActive: { color: colors.textOnPrimary, opacity: 0.85 },

  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.sm, backgroundColor: '#FEF3C7',
  },
  offlineText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: '#92400E' },

  scrollContent: { padding: spacing.md, gap: spacing.md },

  loadingBlock: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, justifyContent: 'center' },
  loadingText: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },

  emptyBlock: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.text },
  emptyBody: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },

  requestCard: {
    backgroundColor: colors.surface, borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm,
  },
  requestHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  requestId: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.text },
  requestReason: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  requestTotals: { alignItems: 'flex-end' },
  requestTotalValue: { fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: colors.text },
  requestTotalLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  requestMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  requestMetaLine: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, flex: 1, marginRight: spacing.sm },

  scanHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  scanTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.text, flex: 1, textAlign: 'center' },

  summaryCard: { backgroundColor: colors.surface, borderRadius: borderRadius.md, padding: spacing.md, gap: spacing.sm },
  summaryReason: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.text },
  summaryTotals: { flexDirection: 'row', gap: spacing.sm },
  summaryCell: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, backgroundColor: colors.background, borderRadius: borderRadius.sm },
  summaryCellHi: { backgroundColor: colors.primary },
  summaryValue: { fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: colors.text },
  summaryValueHi: { color: colors.textOnPrimary },
  summaryLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  summaryLabelHi: { color: colors.textOnPrimary, opacity: 0.85 },

  sectionTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.sm },

  progressRow: { backgroundColor: colors.surface, borderRadius: borderRadius.sm, padding: spacing.sm, gap: spacing.xs, borderWidth: 1, borderColor: colors.border },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressVariety: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text, flex: 1, marginRight: spacing.sm },
  progressCount: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text },
  progressCountDone: { color: colors.success },
  progressTrack: { height: 6, backgroundColor: colors.surfaceAlt, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary },
  progressFillDone: { backgroundColor: colors.success },

  recentRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  recentScan: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text, flex: 1 },
  recentVariety: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, flex: 1, textAlign: 'right' },
  recentStems: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text, minWidth: 40, textAlign: 'right' },
  recentTime: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, minWidth: 60, textAlign: 'right' },
});
