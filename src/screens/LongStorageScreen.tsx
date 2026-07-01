import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { getFarm } from '../database/settings';
import {
  scanBucketIntoStorageBox,
  getLongStorageData,
} from '../services/api';
import ScanInput from '../components/ScanInput';
import ScanConfirmation from '../components/ScanConfirmation';
import {
  StorageBoxSealResponse,
  LongStorageData,
} from '../types';
import { onScanSuccess, onScanError } from '../utils/feedback';
import {
  colors,
  fontFamily,
  fontSize,
  spacing,
  borderRadius,
} from '../theme';

interface SessionState {
  storage_box: string;
  box_id: string;
  variety: string;
  stem_length: string;
  stems_count: number;
  original_stems: number;
  source_bucket?: string;   // 1-to-1: bucket sealed into this box
  sealed: boolean;          // true once a bucket has been bound
  shelves_cleared?: number;
}

function unwrapQR(input: string): string {
  const cleaned = (input || '').trim();
  if (!cleaned) return '';
  if (cleaned.startsWith('{')) {
    try {
      const j = JSON.parse(cleaned);
      return String(j.box_id ?? j.bucket_id ?? j.name ?? cleaned).trim();
    } catch { /* fall through */ }
  }
  return cleaned;
}

export default function LongStorageScreen() {
  const { isConnected } = useApp();

  const [session, setSession] = useState<SessionState | null>(null);
  const [scanning, setScanning] = useState(false);
  const [data, setData] = useState<LongStorageData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [farm, setFarmState] = useState<string>('');

  const [confirmation, setConfirmation] = useState<{
    visible: boolean;
    type: 'success' | 'error';
    message: string;
    title?: string;
  }>({ visible: false, type: 'success', message: '' });

  const show = (type: 'success' | 'error', message: string, title?: string) =>
    setConfirmation({ visible: true, type, message, title });

  useEffect(() => {
    (async () => {
      try {
        const f = await getFarm();
        if (f) setFarmState(f);
      } catch { /* defaults */ }
    })();
  }, []);

  const refreshData = useCallback(async () => {
    if (!isConnected) return;
    setLoadingData(true);
    try {
      const resp = await getLongStorageData(farm || undefined);
      setData(resp);
    } catch {
      // ignore — keep stale data
    } finally {
      setLoadingData(false);
    }
  }, [isConnected, farm]);

  useEffect(() => { refreshData(); }, [refreshData]);

  const handleBoxScan = useCallback((raw: string) => {
    const v = unwrapQR(raw);
    if (!v) return;
    setSession({
      storage_box: v,
      box_id: v,
      variety: '',
      stem_length: '',
      stems_count: 0,
      original_stems: 0,
      sealed: false,
    });
    show('success', `Now scan the bucket to seal into ${v}`, 'Box ready');
  }, []);

  const handleBucketScan = useCallback(async (raw: string) => {
    if (!session) {
      onScanError();
      show('error', 'Scan a storage box first, then the bucket.', 'No box selected');
      return;
    }
    if (session.sealed) return; // 1-to-1: refuse further scans

    const bucketId = unwrapQR(raw);
    if (!bucketId) return;

    if (!isConnected) {
      onScanError();
      show('error', 'Long Storage requires online — stock movement must commit.');
      return;
    }

    setScanning(true);
    try {
      const resp: StorageBoxSealResponse = await scanBucketIntoStorageBox({
        box_id: session.storage_box,
        bucket_id: bucketId,
        farm: farm || undefined,
      });
      setSession({
        storage_box: resp.storage_box,
        box_id: resp.box_id,
        variety: resp.variety,
        stem_length: resp.stem_length,
        stems_count: resp.stems_count,
        original_stems: resp.original_stems,
        source_bucket: (resp as any).source_bucket || bucketId,
        shelves_cleared: (resp as any).shelves_cleared || 0,
        sealed: true,
      });
      onScanSuccess();
      show('success', `${resp.stems_added} stems sealed`, `${bucketId} → ${resp.box_id}`);
      refreshData();
    } catch (e: any) {
      onScanError();
      show('error', e?.message || 'Could not seal bucket', 'Cannot store');
    } finally {
      setScanning(false);
    }
  }, [session, isConnected, farm, refreshData]);

  const startNextBox = () => {
    setSession(null);
    refreshData();
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >

        {!session ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="archive-outline" size={22} color={colors.text} />
              <Text style={styles.sectionTitle}>Scan Storage Box</Text>
            </View>
            <Text style={styles.sectionHint}>
              Each Long-Storage sticker is <Text style={styles.bold}>1-to-1</Text> with a single bucket.
              Scan a fresh <Text style={styles.bold}>STG-*</Text> sticker, then scan the bucket it should wrap.
              Stems transfer to the box, the bucket is deshelved (if it was shelved), and the
              bucket is freed back to <Text style={styles.bold}>Available</Text>.
            </Text>
            <ScanInput
              placeholder="Storage box ID (e.g. STG-2026-0001)"
              scannerTitle="Scan Storage Box"
              onScan={handleBoxScan}
              disabled={false}
            />
          </View>
        ) : session.sealed ? (
          /* ── Sealed state — show the bound bucket + provenance + Next CTA ── */
          <>
            <View style={[styles.sessionCard, styles.sessionCardSealed]}>
              <View style={styles.sealedBanner}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={styles.sealedBannerText}>Sealed</Text>
              </View>

              <Text style={styles.sessionEyebrow}>Storage Box</Text>
              <Text style={styles.sessionBoxId} numberOfLines={1}>
                {session.box_id}
              </Text>

              <View style={styles.boundRow}>
                <Ionicons name="link" size={14} color={colors.textMuted} />
                <Text style={styles.boundLabel}>Bound to bucket</Text>
                <Text style={styles.boundValue} numberOfLines={1}>
                  {session.source_bucket || '—'}
                </Text>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Variety</Text>
                  <Text style={styles.statValue} numberOfLines={1}>
                    {session.variety || '—'}
                  </Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Length</Text>
                  <Text style={styles.statValue}>{session.stem_length || '—'}</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Stems</Text>
                  <Text style={[styles.statValue, styles.statValueAccent]}>
                    {session.stems_count}
                  </Text>
                </View>
              </View>

              {(session.shelves_cleared ?? 0) > 0 && (
                <View style={styles.metaNote}>
                  <Ionicons name="layers-outline" size={13} color={colors.textMuted} />
                  <Text style={styles.metaNoteText}>
                    Deshelved from {session.shelves_cleared} shelf
                    {(session.shelves_cleared ?? 0) === 1 ? '' : 'ves'}
                  </Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={styles.nextBoxBtn}
              onPress={startNextBox}
              activeOpacity={0.85}
            >
              <Ionicons name="add-circle" size={18} color={colors.textOnPrimary} />
              <Text style={styles.nextBoxBtnText}>Next storage box</Text>
            </TouchableOpacity>
          </>
        ) : (
          /* ── Box scanned, waiting for the single bucket scan ── */
          <>
            <View style={styles.sessionCard}>
              <View style={styles.sessionTopRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sessionEyebrow}>Storage Box</Text>
                  <Text style={styles.sessionBoxId} numberOfLines={1}>
                    {session.box_id}
                  </Text>
                </View>
                <TouchableOpacity onPress={startNextBox} style={styles.closeBtn}>
                  <Ionicons name="close" size={16} color={colors.textMuted} />
                  <Text style={styles.closeBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.sectionHint}>
                Scan the bucket to seal into this box. One bucket only — the sticker locks to it.
              </Text>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="cube-outline" size={20} color={colors.text} />
                <Text style={styles.sectionTitle}>Scan Bucket</Text>
              </View>
              <ScanInput
                placeholder="Bucket ID"
                scannerTitle="Scan Bucket QR"
                onScan={handleBucketScan}
                disabled={scanning}
              />
              {scanning && (
                <View style={styles.loading}>
                  <ActivityIndicator size="small" color={colors.textMuted} />
                  <Text style={styles.loadingText}>Sealing…</Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* ─── On-hand summary ───────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="snow-outline" size={20} color={colors.text} />
            <Text style={styles.sectionTitle}>On Hand</Text>
            <TouchableOpacity
              onPress={refreshData}
              style={styles.refreshBtn}
              disabled={loadingData}
            >
              <Ionicons
                name="refresh-outline"
                size={16}
                color={loadingData ? colors.textMuted : colors.primary}
              />
            </TouchableOpacity>
          </View>

          {!data ? (
            <View style={styles.loading}>
              <ActivityIndicator size="small" color={colors.textMuted} />
              <Text style={styles.loadingText}>Loading…</Text>
            </View>
          ) : (
            <>
              <View style={styles.totalsRow}>
                <View style={styles.totalCard}>
                  <Text style={styles.totalLabel}>Active boxes</Text>
                  <Text style={styles.totalValue}>{data.totals.boxes}</Text>
                </View>
                <View style={styles.totalCard}>
                  <Text style={styles.totalLabel}>Total stems</Text>
                  <Text style={styles.totalValue}>
                    {data.totals.stems.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.totalCard}>
                  <Text style={styles.totalLabel}>Varieties</Text>
                  <Text style={styles.totalValue}>{data.totals.varieties}</Text>
                </View>
                <View style={styles.totalCard}>
                  <Text style={styles.totalLabel}>Oldest</Text>
                  <Text style={styles.totalValue}>{data.totals.oldest_days}d</Text>
                </View>
              </View>

              {data.per_variety.length === 0 ? (
                <Text style={styles.emptyState}>
                  No active storage boxes — seal a bucket to start.
                </Text>
              ) : (
                <View style={styles.tableWrap}>
                  {data.per_variety.map((row, i) => (
                    <View
                      key={`${row.variety}-${row.stem_length}-${i}`}
                      style={styles.tableRow}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.varietyName} numberOfLines={1}>
                          {row.variety_name}
                        </Text>
                        <Text style={styles.varietyMeta}>
                          {row.stem_length} · {row.boxes} box{row.boxes === 1 ? '' : 'es'}
                        </Text>
                      </View>
                      <Text style={styles.varietyStems}>
                        {row.stems.toLocaleString()}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>

      <ScanConfirmation
        visible={confirmation.visible}
        type={confirmation.type}
        message={confirmation.message}
        title={confirmation.title}
        onDismiss={() => setConfirmation(prev => ({ ...prev, visible: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },

  section: { marginBottom: spacing.lg },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.md,
    color: colors.text, flex: 1,
  },
  sectionHint: {
    fontFamily: fontFamily.regular, fontSize: fontSize.sm,
    color: colors.textMuted, marginBottom: spacing.md,
  },
  bold: { fontFamily: fontFamily.semiBold, color: colors.text },

  countBadge: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm, paddingVertical: 2,
    minWidth: 24, alignItems: 'center',
  },
  countBadgeText: {
    fontFamily: fontFamily.bold, fontSize: fontSize.xs,
    color: colors.textOnPrimary,
  },
  refreshBtn: {
    width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
    borderRadius: borderRadius.full,
  },

  loading: {
    flexDirection: 'row', alignItems: 'center',
    gap: spacing.sm, marginTop: spacing.sm,
  },
  loadingText: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs,
    color: colors.textMuted,
  },

  // ── Session card ──
  sessionCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  sessionTopRow: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: spacing.md,
  },
  sessionEyebrow: {
    fontFamily: fontFamily.medium, fontSize: 10,
    color: colors.textMuted, letterSpacing: 1.4,
    textTransform: 'uppercase', marginBottom: 2,
  },
  sessionBoxId: {
    fontFamily: fontFamily.bold, fontSize: fontSize.lg,
    color: colors.text, letterSpacing: -0.3,
  },
  closeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  closeBtnText: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.xs,
    color: colors.primary,
  },

  statsRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { width: 1, backgroundColor: colors.border },
  statLabel: {
    fontFamily: fontFamily.regular, fontSize: 10,
    color: colors.textMuted, letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  statValue: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.md,
    color: colors.text,
  },
  statValueAccent: { color: colors.success },

  // ── Sealed state ──
  sessionCardSealed: {
    borderColor: colors.success,
    borderWidth: 1.5,
  },
  sealedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  sealedBannerText: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.xs,
    color: colors.success, textTransform: 'uppercase', letterSpacing: 1,
  },
  boundRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    marginTop: spacing.sm, marginBottom: spacing.sm,
  },
  boundLabel: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  boundValue: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.sm,
    color: colors.text, flex: 1,
  },
  metaNote: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginTop: spacing.sm,
  },
  metaNoteText: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  nextBoxBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    marginBottom: spacing.lg,
  },
  nextBoxBtnText: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.sm,
    color: colors.textOnPrimary,
  },

  // ── On-hand summary ──
  totalsRow: {
    flexDirection: 'row', gap: spacing.sm,
    marginBottom: spacing.md, flexWrap: 'wrap',
  },
  totalCard: {
    flex: 1, minWidth: 80,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.sm, alignItems: 'flex-start',
    borderWidth: 1, borderColor: colors.border,
  },
  totalLabel: {
    fontFamily: fontFamily.regular, fontSize: 10,
    color: colors.textMuted, letterSpacing: 0.5,
    textTransform: 'uppercase', marginBottom: 2,
  },
  totalValue: {
    fontFamily: fontFamily.bold, fontSize: fontSize.lg,
    color: colors.text, letterSpacing: -0.3,
  },
  tableWrap: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  varietyName: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.sm,
    color: colors.text,
  },
  varietyMeta: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs,
    color: colors.textMuted, marginTop: 2,
  },
  varietyStems: {
    fontFamily: fontFamily.bold, fontSize: fontSize.md,
    color: colors.text,
  },

  emptyState: {
    fontFamily: fontFamily.regular, fontSize: fontSize.sm,
    color: colors.textMuted, padding: spacing.lg,
    textAlign: 'center',
  },
});
