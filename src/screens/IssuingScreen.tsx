import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import {
  getIssuingVarieties,
  getIssuingOpls,
  getIssuingBuckets,
  issueBucket,
  skipBucket,
  IssuingVariety,
  IssuingOpl,
  IssuingBucket,
} from '../services/api';
import ScanInput, { ScanInputHandle } from '../components/ScanInput';
import ScanConfirmation from '../components/ScanConfirmation';
import { onScanSuccess, onScanError } from '../utils/feedback';
import { parseScannedGradingBucketQR } from '../utils/grading-utils';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

/**
 * Issuing — pickers pull buckets off cold-store shelves against today's OPLs.
 *
 * Two views toggle in one screen:
 *   1. Variety list:  today's open OPL demand grouped by variety.
 *   2. Bucket list:   the pre-assigned buckets for a chosen variety, with
 *                     a scan input. Scanning a bucket clears its Shelf Item
 *                     row(s) and marks the matching Pick List Item picked.
 *
 * Server side: upande_harvest.api.{get_issuing_varieties, get_issuing_buckets,
 * issue_bucket}. Reachable from the side drawer (not in the bottom nav).
 */

type ScannedLogEntry = {
  bucket: string;
  variety: string;
  customer: string | null;
  qty: number;
  time: string;
  status: 'success' | 'error';
  message?: string;
};

export default function IssuingScreen() {
  const { isConnected } = useApp();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [varieties, setVarieties] = useState<IssuingVariety[]>([]);
  const [selectedVariety, setSelectedVariety] = useState<string | null>(null);
  const [opls, setOpls] = useState<IssuingOpl[]>([]);
  // We pick by CUSTOMER (one card per customer aggregating their OPLs)
  // because seeing the same customer twice on two adjacent cards looked
  // like duplicates. selectedCustomer is the Customer.name (e.g. CUS00059);
  // the API filters across all of that customer's today-OPLs.
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<IssuingBucket[]>([]);
  const [scanLog, setScanLog] = useState<ScannedLogEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    visible: boolean;
    type: 'success' | 'error' | 'queued';
    message: string;
    title?: string;
  }>({ visible: false, type: 'success', message: '' });
  const scanRef = useRef<ScanInputHandle>(null);

  const showConfirmation = (type: 'success' | 'error' | 'queued', message: string, title?: string) =>
    setConfirmation({ visible: true, type, message, title });

  // ── data loaders ─────────────────────────────────────────────────────────
  const loadVarieties = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getIssuingVarieties();
      setVarieties(res.varieties || []);
    } catch (e: any) {
      showConfirmation('error', e?.message || 'Could not load varieties');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadOpls = useCallback(async (variety: string) => {
    setLoading(true);
    try {
      const res = await getIssuingOpls(variety);
      setOpls(res.opls || []);
      return res.opls || [];
    } catch (e: any) {
      showConfirmation('error', e?.message || 'Could not load OPLs');
      return [];
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadBuckets = useCallback(async (variety: string, customer?: string) => {
    setLoading(true);
    try {
      const res = await getIssuingBuckets(variety, undefined, customer);
      setBuckets(res.buckets || []);
    } catch (e: any) {
      showConfirmation('error', e?.message || 'Could not load buckets');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadVarieties(); }, [loadVarieties]);

  // Realtime-ish collaboration: while looking at a bucket list, refetch
  // every 5 seconds so buckets another operator scans/skips disappear (or
  // replacements appear) without manual pull-to-refresh. Skipped when no
  // variety is selected (variety list refreshes via pull-to-refresh only).
  useEffect(() => {
    if (!selectedVariety) return;
    const t = setInterval(() => {
      // Don't poll while a scan is in flight — would race the state update
      // and could blank the just-scanned bucket back into the list.
      if (submitting) return;
      loadBuckets(selectedVariety, selectedCustomer || undefined);
    }, 5000);
    return () => clearInterval(t);
  }, [selectedVariety, selectedCustomer, submitting, loadBuckets]);

  // ── handlers ─────────────────────────────────────────────────────────────
  // Variety tap: if there's only ONE OPL for the variety, skip the OPL
  // picker and jump straight to its buckets. Otherwise show the OPL list.
  const handleVarietyPress = async (v: IssuingVariety) => {
    setSelectedVariety(v.variety);
    setSelectedCustomer(null);
    setBuckets([]);
    setScanLog([]);
    // Always check how many distinct CUSTOMERS share this variety. If just
    // one (or none — the v.opl_count fallback), jump straight to scanning.
    const customerOpls = await loadOpls(v.variety);
    if (customerOpls.length <= 1) {
      loadBuckets(v.variety);
    }
  };

  const handleCustomerPress = (customer: string | null) => {
    setSelectedCustomer(customer);
    setBuckets([]);
    setScanLog([]);
    loadBuckets(selectedVariety!, customer || undefined);
  };

  const handleBack = () => {
    // If we drilled customer → buckets, back goes to customer picker
    // (when variety had multiple customers). Otherwise back to varieties.
    if (selectedCustomer !== null && opls.length > 1) {
      setSelectedCustomer(null);
      setBuckets([]);
      setScanLog([]);
      return;
    }
    setSelectedVariety(null);
    setSelectedCustomer(null);
    setOpls([]);
    setBuckets([]);
    setScanLog([]);
    loadVarieties();
  };

  // Skip: the bucket on the shelf doesn't match what's assigned (wrong
  // variety, missing, damaged). Deshelve it server-side, look up a FIFO
  // replacement of the same variety, swap it on the PLI, and append the
  // replacement to the bottom of the visible list.
  const handleSkip = useCallback(async (b: IssuingBucket) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await skipBucket(b.bucket_id, 'inaccurate');
      // Drop the skipped bucket from the list either way.
      setBuckets(prev => prev.filter(x => x.bucket_id !== b.bucket_id));
      if (res.status === 'no_replacement') {
        onScanError();
        showConfirmation(
          'error',
          res.message || `No replacement found for ${b.bucket_id}.`,
          'Skipped — no replacement',
        );
      } else if (res.replacement) {
        onScanSuccess();
        // Append the replacement to the bottom so it's the next thing to pull.
        setBuckets(prev => [...prev, res.replacement!]);
        showConfirmation(
          'success',
          `New bucket: ${res.replacement.bucket_id} (shelf ${res.replacement.shelf_id || '—'})`,
          `Replaced ${b.bucket_id}`,
        );
      }
    } catch (e: any) {
      onScanError();
      showConfirmation('error', e?.message || 'Skip failed', 'Could not skip bucket');
    } finally {
      setSubmitting(false);
      setTimeout(() => scanRef.current?.focus(), 80);
    }
  }, [submitting]);

  const confirmSkip = useCallback((b: IssuingBucket) => {
    Alert.alert(
      'Skip this bucket?',
      `Bucket ${b.bucket_id} will be removed from the shelf and a fresh bucket of the same variety will be assigned to this order.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Skip', style: 'destructive', onPress: () => handleSkip(b) },
      ],
    );
  }, [handleSkip]);

  const handleScan = useCallback(async (raw: string) => {
    // Bucket QR codes arrive as either:
    //   - JSON: {"bucket":"BKT-001"} or {"bucket_id":"BKT-001"} or {"id":"BKT-001"}
    //   - raw string: "BKT-001"
    // Use the shared parser so we accept the same shapes Receiving Out / Grade do.
    const bucketId = parseScannedGradingBucketQR(raw || '') || (raw || '').trim();
    if (!bucketId || submitting) return;
    setSubmitting(true);
    try {
      const res = await issueBucket(bucketId);
      onScanSuccess();
      const ok: ScannedLogEntry = {
        bucket:   res.bucket_id,
        variety:  res.variety,
        customer: res.customer,
        qty:      res.qty,
        time:     new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status:   'success',
      };
      setScanLog(prev => [ok, ...prev].slice(0, 50));
      // Drop the scanned bucket from the visible list — picker sees progress.
      // No auto-return: the picker stays on the variety screen and presses
      // back manually when they're ready to move on. (Earlier behaviour
      // popped back as soon as the last bucket was scanned, which felt like
      // the screen "closing" for small varieties.)
      setBuckets(prev => prev.filter(b => b.bucket_id !== res.bucket_id));
      showConfirmation('success', `${res.variety} · ${res.qty} stems`, `Issued ${res.bucket_id}`);
    } catch (e: any) {
      onScanError();
      const message = e?.message || 'Issuing failed';
      const err: ScannedLogEntry = {
        bucket:   bucketId,
        variety:  selectedVariety || '?',
        customer: null,
        qty:      0,
        time:     new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status:   'error',
        message,
      };
      setScanLog(prev => [err, ...prev].slice(0, 50));
      showConfirmation('error', message, 'Could not issue bucket');
    } finally {
      setSubmitting(false);
      // Re-focus scan input for the next bucket.
      setTimeout(() => scanRef.current?.focus(), 80);
    }
  }, [submitting, selectedVariety]);

  // ── derived ──────────────────────────────────────────────────────────────
  const totalStemsOwed = useMemo(
    () => varieties.reduce((s, v) => s + (v.stems_owed || 0), 0),
    [varieties],
  );

  // ── render: variety list ─────────────────────────────────────────────────
  if (!selectedVariety) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Issuing</Text>
          <Text style={styles.subtitle}>
            Today's open Order Pick Lists · {varieties.length} varieties · {totalStemsOwed} stems owed
          </Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadVarieties(); }} />
          }
        >
          {loading && varieties.length === 0 ? (
            <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
          ) : varieties.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-done-circle-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>Nothing to issue right now.</Text>
              <Text style={styles.emptyHint}>Pull to refresh.</Text>
            </View>
          ) : (
            varieties.map(v => (
              <TouchableOpacity
                key={v.variety}
                style={styles.card}
                activeOpacity={0.7}
                onPress={() => handleVarietyPress(v)}
              >
                <View style={styles.cardLeft}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{v.variety}</Text>
                  <Text style={styles.cardMeta}>
                    {v.bucket_count} bucket{v.bucket_count === 1 ? '' : 's'} · {v.opl_count} OPL{v.opl_count === 1 ? '' : 's'}
                  </Text>
                </View>
                <View style={styles.cardRight}>
                  <Text style={styles.cardStems}>{v.stems_owed}</Text>
                  <Text style={styles.cardStemsLabel}>stems</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            ))
          )}
        </ScrollView>

        <ScanConfirmation
          visible={confirmation.visible}
          type={confirmation.type}
          message={confirmation.message}
          title={confirmation.title}
          onDismiss={() => setConfirmation(s => ({ ...s, visible: false }))}
        />
      </View>
    );
  }

  // ── render: customer picker for a variety (when multiple customers share it) ─
  if (selectedCustomer === null && opls.length > 1) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backRow}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
            <Text style={styles.backText}>Varieties</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>{selectedVariety}</Text>
          <Text style={styles.subtitle}>
            Pick which customer to issue for ({opls.length} customers)
          </Text>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <TouchableOpacity
            style={[styles.card, styles.cardAll]}
            activeOpacity={0.7}
            onPress={() => handleCustomerPress(null)}
          >
            <View style={styles.cardLeft}>
              <Text style={styles.cardTitle}>All customers</Text>
              <Text style={styles.cardMeta}>
                Scan any bucket; the system routes it to whichever order it belongs to
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          {opls.map(o => (
            <TouchableOpacity
              key={o.customer || o.customer_name || 'unknown'}
              style={styles.card}
              activeOpacity={0.7}
              onPress={() => handleCustomerPress(o.customer)}
            >
              <View style={styles.cardLeft}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {o.customer_name || o.customer || '—'}
                </Text>
                <Text style={styles.cardMeta} numberOfLines={1}>
                  {o.bucket_count} bucket{o.bucket_count === 1 ? '' : 's'}
                  {o.opl_count > 1 ? ` · ${o.opl_count} orders` : (o.opl_name ? ` · ${o.opl_name}` : '')}
                </Text>
              </View>
              <View style={styles.cardRight}>
                <Text style={styles.cardStems}>{o.stems_owed}</Text>
                <Text style={styles.cardStemsLabel}>stems</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ── render: bucket list for a variety (optionally narrowed to a customer) ─
  const selectedCustomerObj = opls.find(o => o.customer === selectedCustomer);
  const headerSubtitle =
    selectedCustomer
      ? `${selectedCustomerObj?.customer_name || selectedCustomerObj?.customer || selectedCustomer} · ${buckets.length} bucket${buckets.length === 1 ? '' : 's'} · ${scanLog.filter(l => l.status === 'success').length} issued`
      : `${buckets.length} bucket${buckets.length === 1 ? '' : 's'} to pull · ${scanLog.filter(l => l.status === 'success').length} issued`;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backRow}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
          <Text style={styles.backText}>
            {selectedCustomer && opls.length > 1 ? 'Customers' : 'Varieties'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{selectedVariety}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{headerSubtitle}</Text>
      </View>

      {buckets.length > 0 && (
        <View style={styles.nextBanner}>
          <Text style={styles.nextBannerLabel}>NEXT — SHELF</Text>
          <Text style={styles.nextBannerShelf} numberOfLines={1}>
            {buckets[0].shelf_id || '—'}
          </Text>
          <Text style={styles.nextBannerBucket} numberOfLines={1}>
            bucket {buckets[0].bucket_id} · {buckets[0].qty} stems
          </Text>
        </View>
      )}

      <View style={styles.scanWrap}>
        <ScanInput
          ref={scanRef}
          placeholder={submitting ? 'Issuing…' : 'Press scan button or scan QR'}
          scannerTitle={`Scan a bucket for ${selectedVariety}`}
          onScan={handleScan}
          disabled={submitting || !isConnected}
          keepFocused
        />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadBuckets(selectedVariety); }} />
        }
      >
        {loading && buckets.length === 0 ? (
          <View style={styles.empty}><ActivityIndicator color={colors.primary} /></View>
        ) : buckets.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={48} color={colors.success || '#10b981'} />
            <Text style={styles.emptyText}>All buckets for {selectedVariety} are issued.</Text>
          </View>
        ) : (
          buckets.map(b => (
            <View key={b.pli_name} style={styles.bucketRow}>
              <View style={styles.bucketShelfBox}>
                <Text style={styles.bucketShelfText} numberOfLines={1}>
                  {b.shelf_id || '—'}
                </Text>
              </View>
              <View style={styles.bucketRowLeft}>
                <Text style={styles.bucketId} numberOfLines={1}>{b.bucket_id}</Text>
                <Text style={styles.bucketMeta} numberOfLines={1}>
                  {(b.stem_length || '?')} · {b.qty} stems
                </Text>
                {(b.customer_name || b.customer) ? (
                  <Text style={styles.bucketMeta} numberOfLines={1}>
                    {b.customer_name || b.customer}
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity
                onPress={() => confirmSkip(b)}
                style={styles.skipBtn}
                disabled={submitting}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close-circle-outline" size={20} color={colors.error || '#dc2626'} />
                <Text style={styles.skipBtnText}>Skip</Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        {scanLog.length > 0 && (
          <View style={styles.logBlock}>
            <Text style={styles.logTitle}>This session</Text>
            {scanLog.map((l, i) => (
              <View key={`${l.bucket}-${i}`} style={[
                styles.logRow,
                l.status === 'success' ? styles.logRowOk : styles.logRowErr,
              ]}>
                <Ionicons
                  name={l.status === 'success' ? 'checkmark-circle' : 'close-circle'}
                  size={16}
                  color={l.status === 'success' ? (colors.success || '#10b981') : colors.error}
                />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.logBucket} numberOfLines={1}>{l.bucket}</Text>
                  <Text style={styles.logMeta} numberOfLines={1}>
                    {l.status === 'success'
                      ? `${l.qty} stems · ${l.customer || 'no customer'}`
                      : (l.message || 'error')}
                  </Text>
                </View>
                <Text style={styles.logTime}>{l.time}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <ScanConfirmation
        visible={confirmation.visible}
        type={confirmation.type}
        message={confirmation.message}
        title={confirmation.title}
        onDismiss={() => setConfirmation(s => ({ ...s, visible: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  backText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },

  title: { fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: colors.text },
  subtitle: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },

  nextBanner: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  nextBannerLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.textOnPrimary,
    opacity: 0.85,
  },
  nextBannerBucket: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.textOnPrimary,
    opacity: 0.9,
    marginTop: 4,
  },
  nextBannerShelf: {
    fontFamily: fontFamily.bold,
    fontSize: 44,
    lineHeight: 50,
    color: colors.textOnPrimary,
    letterSpacing: 1,
    marginTop: 4,
  },

  scanWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.surface,
  },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl },

  empty: { alignItems: 'center', paddingVertical: spacing.xl * 2, gap: spacing.sm },
  emptyText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.textSecondary },
  emptyHint: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },

  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing.md,
  },
  cardLeft: { flex: 1 },
  cardTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.text },
  cardMeta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  cardRight: { alignItems: 'flex-end', minWidth: 64 },
  cardStems: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: colors.text },
  cardStemsLabel: { fontFamily: fontFamily.regular, fontSize: 10, color: colors.textMuted, marginTop: -2 },

  bucketRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
    marginBottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing.md,
  },
  bucketShelfBox: {
    minWidth: 70,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bucketShelfText: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.textOnPrimary,
    letterSpacing: 0.5,
  },
  cardAll: {
    backgroundColor: '#F4F6F8',
    borderStyle: 'dashed',
  },
  bucketRowLeft: { flex: 1 },
  skipBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.sm, paddingVertical: 6,
    borderRadius: borderRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.error || '#dc2626',
    gap: 4,
  },
  skipBtnText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: colors.error || '#dc2626',
  },
  bucketId: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text },
  bucketMeta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },

  logBlock: { marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  logTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: colors.textSecondary, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  logRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: borderRadius.sm, marginBottom: 4 },
  logRowOk: { backgroundColor: '#ECFDF5' },
  logRowErr: { backgroundColor: '#FEF2F2' },
  logBucket: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  logMeta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  logTime: { fontFamily: fontFamily.regular, fontSize: 10, color: colors.textMuted },
});
