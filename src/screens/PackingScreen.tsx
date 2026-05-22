import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { getFarm } from '../database/settings';
import {
  upsertPackingBox,
  addBunchToBox as addBunchLocal,
  markBoxClosed,
} from '../database/packing';
import { addToSyncQueue } from '../database/sync-queue';
import {
  addBunchToBoxApi,
  closePackBox,
  getOpenBoxForOpl,
} from '../services/api';
import ScanInput from '../components/ScanInput';
import ScanConfirmation from '../components/ScanConfirmation';
import { PackingListEntry, PackBoxSummary } from '../types';
import { extractGradingQRValue } from '../utils/grading-utils';
import { onScanSuccess, onScanError } from '../utils/feedback';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

/**
 * Derive OPL name from either an OPL scan ("OPL-2026-0003")
 * or a box scan ("OPL-2026-0003-B1"). The Pack Box naming rule is
 * "{opl}-B{sequence}" — so anything after the last "-B" is the box suffix.
 * Accepts JSON-wrapped QR payloads like {"opl":"..."} or {"box_id":"..."}.
 */
function deriveOplFromScan(input: string): { opl: string; box_id: string | null } {
  let cleaned = (input || '').trim();
  if (!cleaned) return { opl: '', box_id: null };
  try {
    const parsed = JSON.parse(cleaned);
    cleaned = String(parsed.box_id ?? parsed.opl ?? parsed.name ?? cleaned).trim();
  } catch {
    // raw string — use as-is
  }
  const match = cleaned.match(/^(.+)-B\d+$/);
  if (match) return { opl: match[1], box_id: cleaned };
  return { opl: cleaned, box_id: null };
}

interface ActiveSession {
  opl: string;
  customer: string;
  farm: string;
  pack_rate: number;
  active_box: PackBoxSummary;
  all_boxes: PackBoxSummary[];
}

export default function PackingScreen() {
  const { isConnected } = useApp();

  const [session, setSession] = useState<ActiveSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [bunches, setBunches] = useState<PackingListEntry[]>([]);
  const [stemsInBox, setStemsInBox] = useState(0);
  const [closing, setClosing] = useState(false);

  const [confirmation, setConfirmation] = useState<{
    visible: boolean;
    type: 'success' | 'error';
    message: string;
  }>({ visible: false, type: 'success', message: '' });

  const show = (type: 'success' | 'error', message: string) =>
    setConfirmation({ visible: true, type, message });

  // When the active box's stems_count changes on the server, reflect it locally
  useEffect(() => {
    if (session?.active_box) {
      setStemsInBox(session.active_box.stems_count);
    }
  }, [session?.active_box.name]);

  const loadSessionForOpl = useCallback(async (opl: string, preferredBoxId: string | null) => {
    if (!isConnected) {
      show('error', 'Go online to start — OPL details must be fetched');
      onScanError();
      return;
    }
    setLoadingSession(true);
    try {
      const resp = await getOpenBoxForOpl(opl);
      // Pick the requested box if the user scanned a specific label,
      // otherwise fall back to the server-selected open box.
      const chosen = preferredBoxId
        ? resp.boxes.find((b) => b.box_id === preferredBoxId) ?? resp.open_box
        : resp.open_box;

      if (!chosen) {
        show('error', `No open boxes for ${opl} — all ${resp.boxes.length} boxes closed`);
        onScanError();
        return;
      }

      await upsertPackingBox(chosen.box_id, resp.farm, {
        opl: resp.opl,
        customer: resp.customer,
        pack_rate: resp.pack_rate,
        status: chosen.status,
        box_sequence: chosen.box_sequence,
        total_boxes: resp.boxes.length,
      });

      setSession({
        opl: resp.opl,
        customer: resp.customer,
        farm: resp.farm,
        pack_rate: resp.pack_rate,
        active_box: chosen,
        all_boxes: resp.boxes,
      });
      setBunches([]);
      setStemsInBox(chosen.stems_count);
      onScanSuccess();
      show('success', `Box ${chosen.box_sequence}/${resp.boxes.length} — ${resp.customer}`);
    } catch (error: any) {
      onScanError();
      show('error', error.message || 'Could not load OPL');
    } finally {
      setLoadingSession(false);
    }
  }, [isConnected]);

  const handleScanEntry = useCallback(async (data: string) => {
    const { opl, box_id } = deriveOplFromScan(data);
    if (!opl) return;
    await loadSessionForOpl(opl, box_id);
  }, [loadSessionForOpl]);

  const switchToNextOpenBox = useCallback(async () => {
    if (!session) return;
    await loadSessionForOpl(session.opl, null);
  }, [session, loadSessionForOpl]);

  const handleBunchScanned = useCallback(async (data: string) => {
    if (!session) return;
    // Bunch QR codes can arrive as JSON like {"bunch_id":"BN-123"} or as raw
    // strings. extractGradingQRValue handles both.
    const bunchId = extractGradingQRValue(data);
    if (!bunchId) return;

    if (bunches.some((b) => b.bunch_id === bunchId)) {
      onScanError();
      show('error', `${bunchId} already scanned`);
      return;
    }

    if (!isConnected) {
      // Offline: queue the scan. We can't know stems yet, so block the scan
      // if we've clearly already hit the cap locally.
      if (stemsInBox >= session.pack_rate) {
        onScanError();
        show('error', `Box full — ${stemsInBox}/${session.pack_rate} stems`);
        return;
      }
      await addBunchLocal(session.active_box.box_id, bunchId, { stems: 0 });
      await addToSyncQueue('add_bunch_to_box', {
        bunch_id: bunchId,
        box_id: session.active_box.box_id,
        opl: session.opl,
        farm: session.farm,
      });
      setBunches((prev) => [{
        bunch_id: bunchId,
        time: new Date().toLocaleTimeString(),
        status: 'queued',
        message: 'Queued',
      }, ...prev]);
      onScanSuccess();
      show('success', `${bunchId} queued`);
      return;
    }

    try {
      const resp = await addBunchToBoxApi({
        bunch_id: bunchId,
        box_id: session.active_box.box_id,
        opl: session.opl,
        farm: session.farm,
      });

      await addBunchLocal(resp.box_id, bunchId, { stems: resp.stems });
      setStemsInBox(resp.stems_count);
      setBunches((prev) => [{
        bunch_id: bunchId,
        time: new Date().toLocaleTimeString(),
        status: 'success',
        stems: resp.stems,
        message: `${resp.stems} stems`,
      }, ...prev]);

      onScanSuccess();
      if (resp.full) {
        show('success', `Box full — ${resp.stems_count}/${resp.pack_rate}. Close it to continue.`);
      } else {
        show('success', `+${resp.stems} → ${resp.stems_count}/${resp.pack_rate}`);
      }
    } catch (error: any) {
      onScanError();
      show('error', error.message || 'Could not add bunch');
    }
  }, [session, bunches, isConnected, stemsInBox]);

  const handleCloseBox = useCallback(async () => {
    if (!session) return;
    Alert.alert(
      'Close Box',
      `Close box ${session.active_box.box_sequence}/${session.all_boxes.length} with ${stemsInBox}/${session.pack_rate} stems?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close',
          onPress: async () => {
            setClosing(true);
            try {
              if (isConnected) {
                await closePackBox(session.active_box.name);
              } else {
                await addToSyncQueue('close_pack_box', { box_name: session.active_box.name });
              }
              await markBoxClosed(session.active_box.box_id);
              show('success', `Box ${session.active_box.box_sequence} closed`);

              // Move to next open box if any remaining
              const remaining = session.all_boxes.filter(
                (b) => b.name !== session.active_box.name && b.status === 'Open'
              );
              if (remaining.length > 0 && isConnected) {
                await loadSessionForOpl(session.opl, null);
              } else {
                setSession(null);
                setBunches([]);
                setStemsInBox(0);
              }
            } catch (error: any) {
              show('error', error.message || 'Could not close box');
            } finally {
              setClosing(false);
            }
          },
        },
      ]
    );
  }, [session, stemsInBox, isConnected, loadSessionForOpl]);

  const resetSession = () => {
    Alert.alert('Reset', 'Return to the OPL scan screen?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => { setSession(null); setBunches([]); setStemsInBox(0); } },
    ]);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const capPct = session ? Math.min(100, Math.round((stemsInBox / session.pack_rate) * 100)) : 0;
  const atCap = session ? stemsInBox >= session.pack_rate : false;

  return (
    <View style={styles.container}>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Phase 1: Scan OPL or Box Label */}
        {!session ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="qr-code-outline" size={20} color={colors.text} />
              <Text style={styles.sectionTitle}>Start Packing</Text>
            </View>
            <Text style={styles.sectionHint}>
              Scan an <Text style={styles.bold}>OPL</Text> to pack into the next open box,
              or scan a <Text style={styles.bold}>box label</Text> to open that specific box.
            </Text>
            <ScanInput
              placeholder="OPL number or box ID"
              scannerTitle="Scan OPL / Box Label"
              onScan={handleScanEntry}
              disabled={loadingSession}
            />
            {loadingSession && (
              <View style={styles.loading}>
                <ActivityIndicator size="small" color={colors.textMuted} />
                <Text style={styles.loadingText}>Loading OPL…</Text>
              </View>
            )}
          </View>
        ) : (
          <>
            {/* Session header */}
            <View style={styles.sessionCard}>
              <View style={styles.sessionHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sessionCustomer} numberOfLines={1}>{session.customer}</Text>
                  <Text style={styles.sessionOpl}>{session.opl}</Text>
                </View>
                <TouchableOpacity onPress={resetSession} style={styles.resetBtn}>
                  <Ionicons name="close-outline" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <View style={styles.boxSequenceRow}>
                <Ionicons name="cube" size={16} color={colors.primary} />
                <Text style={styles.boxSequenceText}>
                  Box {session.active_box.box_sequence} of {session.all_boxes.length}
                </Text>
                {session.all_boxes.length > 1 && (
                  <TouchableOpacity onPress={switchToNextOpenBox} style={styles.switchBtn}>
                    <Text style={styles.switchBtnText}>Next open</Text>
                    <Ionicons name="chevron-forward" size={12} color={colors.primary} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Pack rate progress */}
              <View style={styles.progressCard}>
                <View style={styles.progressRow}>
                  <Text style={styles.progressLabel}>Stems</Text>
                  <Text style={[styles.progressValue, atCap && styles.progressValueFull]}>
                    {stemsInBox} / {session.pack_rate}
                  </Text>
                </View>
                <View style={styles.progressBarWrap}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${capPct}%` },
                      atCap && styles.progressBarFillFull,
                    ]}
                  />
                </View>
              </View>
            </View>

            {/* Scan bunch */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="leaf-outline" size={20} color={colors.text} />
                <Text style={styles.sectionTitle}>Scan Bunch</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{bunches.length}</Text>
                </View>
              </View>
              <ScanInput
                placeholder="Bunch ID"
                scannerTitle="Scan Bunch QR Code"
                onScan={handleBunchScanned}
                disabled={closing || atCap}
              />
              {atCap && (
                <View style={styles.capWarning}>
                  <Ionicons name="warning-outline" size={14} color="#92400E" />
                  <Text style={styles.capWarningText}>
                    Pack rate reached — close this box to start the next.
                  </Text>
                </View>
              )}
            </View>

            {/* Bunches list */}
            {bunches.length > 0 && (
              <View style={styles.listSection}>
                <Text style={styles.listHeader}>Scanned this session</Text>
                {bunches.map((item) => (
                  <View key={item.bunch_id} style={styles.listItem}>
                    <View style={[
                      styles.statusDot,
                      item.status === 'success' ? styles.dotOk
                        : item.status === 'error' ? styles.dotErr : styles.dotQ,
                    ]} />
                    <Text style={styles.listItemId} numberOfLines={1}>{item.bunch_id}</Text>
                    {typeof item.stems === 'number' && item.stems > 0 && (
                      <Text style={styles.listItemStems}>{item.stems} st</Text>
                    )}
                    <Text style={styles.listItemTime}>{item.time}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Close box button */}
            <TouchableOpacity
              style={[styles.closeBoxBtn, (closing || stemsInBox === 0) && styles.closeBoxBtnDisabled]}
              onPress={handleCloseBox}
              disabled={closing || stemsInBox === 0}
              activeOpacity={0.8}
            >
              <Ionicons name="checkmark-circle-outline" size={20} color={colors.textOnPrimary} />
              <Text style={styles.closeBoxBtnText}>
                {closing ? 'Closing…' : `Close Box (${stemsInBox} stems)`}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <ScanConfirmation
        visible={confirmation.visible}
        type={confirmation.type}
        message={confirmation.message}
        onDismiss={() => setConfirmation((prev) => ({ ...prev, visible: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },

  section: { marginBottom: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  sectionTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.text, flex: 1 },
  sectionHint: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted, marginBottom: spacing.md },
  bold: { fontFamily: fontFamily.semiBold, color: colors.text },

  loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  loadingText: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },

  countBadge: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  countBadgeText: { fontFamily: fontFamily.bold, fontSize: fontSize.xs, color: colors.textOnPrimary },

  // Session card
  sessionCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  sessionHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  sessionCustomer: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: colors.text },
  sessionOpl: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  resetBtn: { padding: spacing.xs },

  boxSequenceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md },
  boxSequenceText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text, flex: 1 },
  switchBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  switchBtnText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.primary },

  progressCard: { backgroundColor: colors.surfaceAlt, borderRadius: borderRadius.sm, padding: spacing.sm },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  progressLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  progressValue: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: colors.text },
  progressValueFull: { color: colors.warning },
  progressBarWrap: { height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 3 },
  progressBarFillFull: { backgroundColor: colors.warning },

  capWarning: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    marginTop: spacing.sm, backgroundColor: '#FEF3C7', borderRadius: borderRadius.sm, padding: spacing.sm,
  },
  capWarningText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: '#92400E', flex: 1 },

  listSection: { marginBottom: spacing.lg },
  listHeader: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text, marginBottom: spacing.sm },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  dotOk: { backgroundColor: colors.success },
  dotErr: { backgroundColor: colors.error },
  dotQ: { backgroundColor: colors.warning },
  listItemId: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text, flex: 1 },
  listItemStems: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: colors.textMuted },
  listItemTime: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },

  closeBoxBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
  },
  closeBoxBtnDisabled: { opacity: 0.4 },
  closeBoxBtnText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.textOnPrimary },
});
