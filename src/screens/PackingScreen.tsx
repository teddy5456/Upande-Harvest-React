import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import {
  closePackBox,
  getPackBoxRecipe,
  packBunchToOpl,
  MixRecipeItem,
} from '../services/api';
import ScanInput from '../components/ScanInput';
import ScanConfirmation from '../components/ScanConfirmation';
import OplPicker from '../components/OplPicker';
import FixStickerSheet from '../components/FixStickerSheet';
import PackingDashboardModal from '../components/PackingDashboardModal';
import { PackingListEntry, PackableOpl, PackLineChoice, PackBunchToOplResponse } from '../types';
import { extractGradingQRValue } from '../utils/grading-utils';
import { onScanSuccess, onScanError } from '../utils/feedback';
import { useCompact } from '../hooks/useCompact';
import { pauseScanFocus } from '../utils/scan-focus';
import { colors, fontFamily, fontSize, spacing, borderRadius, shadow } from '../theme';

/**
 * Packing — pack-by-OPL only. Scanning a box label used to be a second mode
 * here (add_bunch_to_box), but it had none of pack_bunch_to_opl's variety /
 * mix-group / per-variety-cap guards, so a mis-scan could land in the wrong
 * box uncontested. Removed rather than kept as a fallback: no offline queue,
 * no box-label scan — always go through the OPL flow, which is online-only.
 */

interface ActiveOplSession {
  opl: PackableOpl;
  current_box_id: string | null;
  current_box_sequence: number;
  pack_box_name: string | null;
  stems_in_box: number;
  is_mix_box: boolean;
  recipe: MixRecipeItem[] | null;
}

export default function PackingScreen() {
  const { isConnected } = useApp();
  const compact = useCompact();
  // Style pair helper — `s(styles.x, c.x)` picks up the compact override.
  const s = (base: any, small?: any) => (compact && small ? [base, small] : base);
  const icon = compact ? 14 : 20;
  // On a wrist screen the scan list is scroll-away noise; keep the tail only.
  const tail = <T,>(list: T[]) => (compact ? list.slice(0, 3) : list);

  // Packing is where a wrong sticker actually surfaces — the packer scans a
  // bunch for an order and the label does not match — so the repair lives here.
  const [fixOpen, setFixOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [oplSession, setOplSession] = useState<ActiveOplSession | null>(null);
  const [oplBunches, setOplBunches] = useState<PackingListEntry[]>([]);
  // Mix composition is one tap away, not printed on the card by default.
  const [showMixInfo, setShowMixInfo] = useState(false);
  const [oplScanning, setOplScanning] = useState(false);
  const [boxFullDialog, setBoxFullDialog] = useState(false);
  // Scanned variety sits on >1 line of the OPL (straight + mix, or two mix
  // groups) — ask the packer which one instead of guessing.
  const [choicePrompt, setChoicePrompt] = useState<{
    visible: boolean;
    bunchId: string;
    scannedVariety: string;
    choices: PackLineChoice[];
  } | null>(null);

  const [confirmation, setConfirmation] = useState<{
    visible: boolean;
    type: 'success' | 'error';
    message: string;
  }>({ visible: false, type: 'success', message: '' });

  const show = (type: 'success' | 'error', message: string) =>
    setConfirmation({ visible: true, type, message });

  // ── OPL mode handlers ─────────────────────────────────────────────────────

  const handleOplPicked = useCallback((opl: PackableOpl) => {
    setOplSession({
      opl,
      current_box_id: null,
      current_box_sequence: 0,
      pack_box_name: null,
      stems_in_box: 0,
      is_mix_box: opl.is_mix,
      recipe: null,
    });
    setOplBunches([]);
    setShowMixInfo(false);
    show('success', `${opl.customer_name} — ready to scan`);
  }, []);

  const resetOplSession = () => {
    Alert.alert('Reset', 'Return to the OPL picker?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => {
          setOplSession(null);
          setOplBunches([]);
          setBoxFullDialog(false);
          setShowMixInfo(false);
        },
      },
    ]);
  };

  const refreshOplRecipe = useCallback(async (packBoxName: string) => {
    try {
      const r = await getPackBoxRecipe(packBoxName);
      setOplSession((prev) => prev ? {
        ...prev,
        is_mix_box: !!r.is_mix_box,
        recipe: r.is_mix_box ? r.recipe : null,
      } : prev);
    } catch {
      setOplSession((prev) => prev ? { ...prev, recipe: null } : prev);
    }
  }, []);

  // Shared by a plain scan and a scan resolved through the "choose which
  // one" prompt — same box-state update either way.
  const applyPackResult = useCallback((bunchId: string, resp: PackBunchToOplResponse) => {
    const previousBoxId = oplSession?.current_box_id ?? null;
    const switchedBox = !!previousBoxId && previousBoxId !== resp.box_id;

    setOplSession((prev) => prev ? {
      ...prev,
      current_box_id: resp.box_id,
      current_box_sequence: resp.box_sequence,
      pack_box_name: resp.pack_box_name,
      stems_in_box: resp.stems_count,
      // If we switched boxes, clear the local bunch list — it only tracked
      // the previous box's session and would otherwise look wrong.
    } : prev);

    if (switchedBox) {
      setOplBunches([]);
    }

    setOplBunches((prev) => [{
      bunch_id: bunchId,
      time: new Date().toLocaleTimeString(),
      status: 'success',
      stems: resp.bunch.stems,
      variety: resp.bunch.variety,
      message: `${resp.bunch.stems} stems · Box ${resp.box_sequence}`,
    }, ...prev]);

    if (oplSession?.opl.is_mix && resp.pack_box_name) {
      refreshOplRecipe(resp.pack_box_name);
    }

    onScanSuccess();
    if (switchedBox) {
      show(
        'success',
        `New variety detected — opened Box ${resp.box_sequence} for ${resp.bunch.variety}.`
      );
    } else if (resp.full) {
      setBoxFullDialog(true);
      show('success', `Box ${resp.box_sequence} full — ${resp.stems_count}/${resp.pack_rate}`);
    } else {
      show('success', `+${resp.bunch.stems} → ${resp.stems_count}/${resp.pack_rate}`);
    }
  }, [oplSession, refreshOplRecipe]);

  const handleOplBunchScanned = useCallback(async (data: string) => {
    if (!oplSession || boxFullDialog || choicePrompt?.visible) return;
    if (!isConnected) {
      onScanError();
      show('error', 'Pack by OPL requires online — no offline queue for packing');
      return;
    }
    const bunchId = extractGradingQRValue(data);
    if (!bunchId) return;
    if (oplBunches.some((b) => b.bunch_id === bunchId)) {
      onScanError();
      show('error', `${bunchId} already scanned`);
      return;
    }

    setOplScanning(true);
    try {
      const resp = await packBunchToOpl({
        opl: oplSession.opl.opl,
        bunch_id: bunchId,
      });

      if (resp.needs_choice) {
        setChoicePrompt({
          visible: true,
          bunchId,
          scannedVariety: resp.scanned_variety || '',
          choices: resp.choices || [],
        });
        return;
      }

      applyPackResult(bunchId, resp);
    } catch (error: any) {
      onScanError();
      show('error', error.message || 'Could not add bunch');
    } finally {
      setOplScanning(false);
    }
  }, [oplSession, oplBunches, isConnected, boxFullDialog, choicePrompt, applyPackResult]);

  const handleChoiceSelected = useCallback(async (choice: PackLineChoice) => {
    const prompt = choicePrompt;
    if (!prompt || !oplSession) return;
    setChoicePrompt(null);
    setOplScanning(true);
    try {
      const resp = await packBunchToOpl({
        opl: oplSession.opl.opl,
        bunch_id: prompt.bunchId,
        choice: choice.key,
      });
      applyPackResult(prompt.bunchId, resp);
    } catch (error: any) {
      onScanError();
      show('error', error.message || 'Could not add bunch');
    } finally {
      setOplScanning(false);
    }
  }, [choicePrompt, oplSession, applyPackResult]);

  // Manual close — operator can wrap a box at any point (not just at packrate)
  const handleManualCloseOplBox = useCallback(async () => {
    if (!oplSession?.pack_box_name) return;
    Alert.alert(
      'Close box',
      `Close Box ${oplSession.current_box_sequence} with ${oplSession.stems_in_box}/${oplSession.opl.pack_rate} stems? Once closed, no more bunches can be added.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close',
          onPress: async () => {
            try {
              await closePackBox(oplSession.pack_box_name!);
              show('success', `Box ${oplSession.current_box_sequence} closed`);
              setOplSession((prev) => prev ? {
                ...prev,
                current_box_id: null,
                pack_box_name: null,
                stems_in_box: 0,
                recipe: null,
              } : prev);
              setOplBunches([]);
              setBoxFullDialog(false);
            } catch (e: any) {
              show('error', e?.message || 'Could not close box');
            }
          },
        },
      ],
    );
  }, [oplSession]);

  const handleStartNextBox = useCallback(() => {
    setOplSession((prev) => prev ? {
      ...prev,
      current_box_id: null,
      pack_box_name: null,
      stems_in_box: 0,
      recipe: null,
    } : prev);
    setOplBunches([]);
    setBoxFullDialog(false);
    show('success', 'Ready for next box');
  }, []);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const oplCapPct = oplSession
    ? Math.min(100, Math.round((oplSession.stems_in_box / oplSession.opl.pack_rate) * 100))
    : 0;

  /**
   * One pill per variety, answering "what's packed, what's left, what am I on".
   *
   * A mix box carries real per-variety targets from the recipe, so its pills
   * show packed/target and tick over when a variety is complete. A plain box
   * holds a single variety, so the OPL's variety list is shown instead with
   * the one currently in the box marked active — that is the only per-variety
   * fact available client-side without another round-trip.
   */
  const varietyPills = useMemo(() => {
    if (!oplSession) return [];

    const recipe = oplSession.recipe;
    if (recipe && recipe.length > 0) {
      return recipe.map((r) => {
        const target = r.target_stems || 0;
        const packed = r.packed_stems || 0;
        return {
          name: r.item_name || r.item_code,
          packed,
          target,
          pct: target > 0 ? Math.min(100, Math.round((packed / target) * 100)) : 0,
          done: !!r.done,
          active: !r.done && packed > 0,
        };
      });
    }

    // The Packing tab: what the customer bought, with a stem target per
    // variety. On a downgrade this is the 50cm line, not the 60cm bunch the
    // picker carried — measuring packing against the issuing rows would ask
    // the packer to fill a length the order never had.
    const lines = oplSession.opl.pack_lines;
    if (lines && lines.length > 0) {
      // What the server already counted across every box, plus what has been
      // scanned since this OPL was opened. The two never overlap: picking an
      // OPL clears the session list, and the server figure is from that same
      // moment.
      const packedBy: Record<string, number> = {};
      oplBunches.forEach((b) => {
        if (!b.variety) return;
        packedBy[b.variety] = (packedBy[b.variety] || 0) + (b.stems || 0);
      });
      return lines.map((l) => {
        const target = l.target_stems || 0;
        // A scan carries the bunch's physical code, so a line is also filled
        // by whatever was downgraded into it.
        const sources = l.counts_as && l.counts_as.length ? l.counts_as : [l.item_code];
        const thisSession = sources.reduce((n, code) => n + (packedBy[code] || 0), 0);
        const packed = (l.packed_stems || 0) + thisSession;
        return {
          name: l.item_name || l.item_code,
          packed,
          target,
          pct: target > 0 ? Math.min(100, Math.round((packed / target) * 100)) : 0,
          done: target > 0 && packed >= target,
          active: packed > 0 && !(target > 0 && packed >= target),
        };
      });
    }

    const list = (oplSession.opl.varieties || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (list.length === 0) return [];

    // Whatever went into the current box tells us which variety is in hand.
    const current = oplBunches.find((b) => b.variety)?.variety || '';
    const norm = (v: string) => v.toLowerCase().replace(/[\s-]+/g, '');
    return list.map((name) => ({
      name,
      packed: 0,
      target: 0,
      pct: 0,
      done: false,
      active: !!current && norm(current).startsWith(norm(name).slice(0, 6)),
    }));
  }, [oplSession, oplBunches]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={s(styles.scrollContent, c.scrollContent)}
        keyboardShouldPersistTaps="handled"
        // Dragging means the operator wants to read something further up; the
        // scan field must stop pulling the view back to itself while they do.
        onScrollBeginDrag={() => pauseScanFocus()}
        onMomentumScrollBegin={() => pauseScanFocus()}
        scrollEventThrottle={16}
      >

        {!oplSession ? (
          <View style={s(styles.oplPickerWrap, c.oplPickerWrap)}>
            <View style={s(styles.pickerHost, c.pickerHost)}>
              <OplPicker onSelect={handleOplPicked} onMenuPress={() => setMenuOpen(true)} />
            </View>
          </View>
        ) : (
          <>
            <View style={s(styles.sessionCard, c.sessionCard)}>
              <View style={s(styles.sessionHeaderRow, c.sessionHeaderRow)}>
                <View style={{ flex: 1 }}>
                  <View style={styles.oplHeaderTitleRow}>
                    <Text style={s(styles.sessionCustomer, c.sessionCustomer)} numberOfLines={1}>
                      {oplSession.opl.customer_name || oplSession.opl.customer || '—'}
                    </Text>
                    {oplSession.opl.is_mix && (
                      <TouchableOpacity
                        onPress={() => setShowMixInfo((v) => !v)}
                        hitSlop={8}
                        style={styles.mixIconBtn}
                      >
                        <Ionicons
                          name="git-merge-outline"
                          size={16}
                          color={showMixInfo ? colors.primary : colors.textSecondary}
                        />
                      </TouchableOpacity>
                    )}
                  </View>
                  {!compact && (
                    <Text style={styles.sessionOpl} numberOfLines={1}>
                      {oplSession.opl.opl}
                      {/* Same customer, two orders — line code / drop-off point
                          are what actually tell them apart while packing. */}
                      {[oplSession.opl.line_code, oplSession.opl.delivery_point].filter(Boolean).length > 0
                        ? '  ·  ' + [oplSession.opl.line_code, oplSession.opl.delivery_point].filter(Boolean).join(' · ')
                        : ''}
                    </Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => setMenuOpen(true)} style={styles.resetBtn} hitSlop={8}>
                  <Ionicons name="ellipsis-vertical" size={18} color={colors.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity onPress={resetOplSession} style={styles.resetBtn}>
                  <Ionicons name="close-outline" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Single-variety orders: a quiet caption, always visible. Mix
                  orders: the same info sits behind the icon above instead —
                  tapping it reveals per-variety progress below. */}
              {oplSession.opl.varieties && !compact && !oplSession.opl.is_mix ? (
                <Text style={styles.sessionVarieties} numberOfLines={3}>
                  {oplSession.opl.varieties}
                </Text>
              ) : null}

              {/* Per-variety progress, as plain rows — no pill chrome. A real
                  mix box knows its recipe counts; anything else can at least
                  say which variety this box is on. */}
              {varietyPills.length > 0 && (!oplSession.opl.is_mix || showMixInfo) && (
                <View style={s(styles.varietyList, c.varietyList)}>
                  {varietyPills.map((p) => (
                    <View key={p.name} style={s(styles.varietyRow, c.varietyRow)}>
                      <Ionicons
                        name={p.done ? 'checkmark-circle' : p.active ? 'ellipse' : 'ellipse-outline'}
                        size={compact ? 12 : 14}
                        color={p.done ? colors.success : p.active ? colors.primary : colors.textMuted}
                      />
                      <Text style={s(styles.varietyName, c.varietyName)} numberOfLines={1}>{p.name}</Text>
                      {p.target > 0 && (
                        <View style={styles.varietyBarWrap}>
                          <View style={[styles.varietyBarFill, { width: `${p.pct}%` }]} />
                        </View>
                      )}
                      {p.target > 0 ? (
                        <Text style={styles.varietyCount}>{p.done ? '100%' : `${p.packed}/${p.target}`}</Text>
                      ) : p.active ? (
                        <Text style={styles.varietyCount}>current</Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}

              <View style={s(styles.boxSequenceRow, c.boxSequenceRow)}>
                <Ionicons name="cube" size={14} color={colors.primary} />
                <Text style={s(styles.boxSequenceText, c.boxSequenceText)} numberOfLines={1}>
                  {compact
                    ? `${oplSession.opl.opl} · ${oplSession.current_box_id ? `Box ${oplSession.current_box_sequence}` : 'new box'}`
                    : oplSession.current_box_id
                      ? `Box ${oplSession.current_box_sequence}`
                      : 'Next scan opens a new box'}
                </Text>
              </View>

              <View style={s(styles.progressCard, c.progressCard)}>
                <View style={styles.progressRow}>
                  <View style={styles.progressCount}>
                    <Text style={[
                      s(styles.progressBig, c.progressBig),
                      boxFullDialog && styles.progressValueFull,
                    ]}>
                      {oplSession.stems_in_box}
                    </Text>
                    <Text style={styles.progressOf}>/ {oplSession.opl.pack_rate} stems</Text>
                  </View>
                  <Text style={[styles.progressPct, boxFullDialog && styles.progressValueFull]}>
                    {oplCapPct}%
                  </Text>
                </View>
                <View style={styles.progressBarWrap}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${oplCapPct}%` },
                      boxFullDialog && styles.progressBarFillFull,
                    ]}
                  />
                </View>
              </View>
            </View>

            {/* Mix recipe counts now live in the variety pills above. */}

            <View style={s(styles.section, c.section)}>
              {/* Compact: the input placeholder already reads "Bunch ID" and
                  the stem counter is one row up — this header is pure cost. */}
              <View style={[s(styles.sectionHeader, c.sectionHeader), compact && styles.hidden]}>
                <Ionicons name="leaf-outline" size={icon} color={colors.text} />
                <Text style={s(styles.sectionTitle, c.sectionTitle)}>Scan Bunch</Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{oplBunches.length}</Text>
                </View>
              </View>
              <ScanInput
                placeholder="Bunch ID"
                scannerTitle="Scan Bunch QR Code"
                onScan={handleOplBunchScanned}
                disabled={oplScanning || boxFullDialog}
                keepFocused
              />

              {/* Close-box button — always visible once a box is open, so the
                  operator can wrap a partial box without waiting for packrate.
                  Hidden while the auto-close dialog is up (it has its own CTA). */}
              {oplSession.pack_box_name && !boxFullDialog && (
                <TouchableOpacity
                  style={s(styles.closeBoxInlineBtn, c.closeBoxInlineBtn)}
                  onPress={handleManualCloseOplBox}
                  activeOpacity={0.8}
                  disabled={oplScanning}
                >
                  <Ionicons name="checkmark-done" size={16} color={colors.text} />
                  <Text style={styles.closeBoxInlineText} numberOfLines={1}>
                    {compact ? 'Close' : 'Close Box'} {oplSession.current_box_sequence}
                    {oplSession.stems_in_box > 0
                      ? compact ? ` (${oplSession.stems_in_box})` : ` (${oplSession.stems_in_box} stems)`
                      : ''}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {boxFullDialog && (
              <View style={s(styles.boxFullCard, c.boxFullCard)}>
                <View style={styles.boxFullHeader}>
                  <Ionicons name="checkmark-circle" size={compact ? 16 : 20} color={colors.success} />
                  <Text style={s(styles.boxFullTitle, c.boxFullTitle)}>
                    Box {oplSession.current_box_sequence} full
                  </Text>
                </View>
                <Text style={styles.boxFullBody}>
                  {oplSession.stems_in_box}/{oplSession.opl.pack_rate} stems.{compact ? '' : ' Closed and synced to FPL.'}
                </Text>
                <TouchableOpacity
                  style={s(styles.boxFullBtn, c.boxFullBtn)}
                  onPress={handleStartNextBox}
                  activeOpacity={0.8}
                >
                  <Ionicons name="add-circle-outline" size={compact ? 14 : 18} color={colors.textOnPrimary} />
                  <Text style={styles.boxFullBtnText}>{compact ? 'Next Box' : 'Start Next Box'}</Text>
                </TouchableOpacity>
              </View>
            )}

            {oplBunches.length > 0 && (
              <View style={s(styles.listSection, c.listSection)}>
                {!compact && <Text style={styles.listHeader}>Scanned this box</Text>}
                {tail(oplBunches).map((item) => (
                  <View key={item.bunch_id} style={s(styles.listItem, c.listItem)}>
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
          </>
        )}

      </ScrollView>

      <FixStickerSheet visible={fixOpen} onClose={() => setFixOpen(false)} />
      <PackingDashboardModal visible={dashboardOpen} onClose={() => setDashboardOpen(false)} />

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuCard}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setMenuOpen(false); setFixOpen(true); }}
              activeOpacity={0.7}
            >
              <Ionicons name="construct-outline" size={18} color={colors.text} />
              <Text style={styles.menuItemText}>Fix a wrong sticker</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setMenuOpen(false); setDashboardOpen(true); }}
              activeOpacity={0.7}
            >
              <Ionicons name="stats-chart" size={18} color={colors.text} />
              <Text style={styles.menuItemText}>Packing dashboard</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={!!choicePrompt?.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setChoicePrompt(null)}
      >
        <View style={styles.choiceBackdrop}>
          <View style={styles.choiceCard}>
            <Ionicons name="help-circle" size={32} color={colors.warning} />
            <Text style={styles.choiceTitle}>
              {choicePrompt?.scannedVariety || 'This variety'} is on more than one line
            </Text>
            <Text style={styles.choiceHint}>Choose which one this bunch belongs to.</Text>
            {(choicePrompt?.choices || []).map((c) => (
              <TouchableOpacity
                key={c.key}
                style={styles.choiceOption}
                onPress={() => handleChoiceSelected(c)}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.choiceOptionTitle}>
                    {c.mix_group ? `Mix: ${c.mix_group}` : 'Straight line'}
                  </Text>
                  <Text style={styles.choiceOptionSub}>
                    {[c.line_code, c.delivery_point].filter(Boolean).join(' · ') || c.item_code}
                    {typeof c.total_stems === 'number' ? ` · ${c.total_stems} stems` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.choiceCancel}
              onPress={() => setChoicePrompt(null)}
              activeOpacity={0.8}
            >
              <Text style={styles.choiceCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
  hidden: { display: 'none' },
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.15)', alignItems: 'flex-end' },
  menuCard: {
    marginTop: spacing.xl + spacing.lg,
    marginRight: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 200,
    paddingVertical: spacing.xs,
    ...shadow.md,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md },
  menuItemText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  menuDivider: { height: 1, backgroundColor: colors.border },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },

  section: { marginBottom: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  sectionTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.text, flex: 1 },

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
  // flexShrink so a long customer name actually truncates against
  // numberOfLines={1} instead of overflowing past its row and rendering on
  // top of the mix icon / reset (✕) button next to it.
  sessionCustomer: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: colors.text, flexShrink: 1 },
  sessionOpl: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  sessionVarieties: { fontFamily: fontFamily.regular, fontSize: 11, color: colors.textMuted, marginTop: 3, fontStyle: 'italic' },
  resetBtn: { padding: spacing.xs },

  oplHeaderTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },

  boxSequenceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md },
  boxSequenceText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text, flex: 1 },

  progressCard: { backgroundColor: colors.surfaceAlt, borderRadius: borderRadius.md, padding: spacing.md },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: spacing.sm },
  // Count reads number-first: the stem total is what the packer tracks.
  progressCount: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  progressBig: { fontFamily: fontFamily.bold, fontSize: fontSize.xxl, color: colors.text, letterSpacing: -0.5 },
  progressOf: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },
  progressPct: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.textMuted },
  progressValueFull: { color: colors.warning },

  // Per-variety progress — plain rows, each with its own thin bar. No pill
  // chrome: a mix box's composition is opt-in (behind the header icon), so
  // once it's open it reads like any other list, not a wall of chips.
  varietyList: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  varietyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  varietyName: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.text,
    flex: 1,
  },
  varietyBarWrap: {
    width: 60,
    height: 5,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 3,
    overflow: 'hidden',
  },
  varietyBarFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 3 },
  varietyCount: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    minWidth: 50,
    textAlign: 'right',
  },
  progressBarWrap: { height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 3 },
  progressBarFillFull: { backgroundColor: colors.warning },

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

  // OPL picker host
  oplPickerWrap: { flex: 1, minHeight: 500 },
  pickerHost: { flex: 1, minHeight: 400 },

  // OPL mode — mix indicator: a plain icon button, not a pill. Tapping it
  // reveals the per-variety breakdown below instead of shouting it in color.
  mixIconBtn: { padding: 2 },

  // Box-full confirmation card
  boxFullCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  boxFullHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  boxFullTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.text },
  boxFullBody: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textSecondary },
  boxFullBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
  },
  boxFullBtnText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.textOnPrimary },

  closeBoxInlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    marginTop: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
  },
  closeBoxInlineText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.text,
  },

  // "Choose which one" prompt — scanned variety is on >1 OPL line.
  choiceBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  choiceCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  choiceTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
    textAlign: 'center',
  },
  choiceHint: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  choiceOption: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  choiceOptionTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text },
  choiceOptionSub: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  choiceCancel: { marginTop: spacing.sm, padding: spacing.sm },
  choiceCancelText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.textMuted },
});

/**
 * Wrist-scanner overrides (Zebra WS50 & co, ~240–320dp wide). Applied on top
 * of `styles` via the `s()` helper — padding and type shrink, nothing moves.
 */
const c = StyleSheet.create({
  topBar: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  topBarTitle: { fontSize: fontSize.md },
  scrollContent: { padding: spacing.sm, paddingBottom: spacing.md },

  boxSequenceText: { fontSize: fontSize.xs },

  progressBig: { fontSize: fontSize.xl },
  varietyList: { marginTop: spacing.xs, marginBottom: spacing.sm, gap: 4 },
  varietyRow: { gap: spacing.xs },
  varietyName: { fontSize: fontSize.xs },

  section: { marginBottom: spacing.sm },
  sectionHeader: { gap: spacing.xs, marginBottom: spacing.xs },
  sectionTitle: { fontSize: fontSize.sm },

  sessionCard: { padding: spacing.sm, marginBottom: spacing.sm },
  sessionHeaderRow: { marginBottom: spacing.xs },
  sessionCustomer: { fontSize: fontSize.md },

  boxSequenceRow: { marginBottom: spacing.xs },
  progressCard: { padding: spacing.xs },

  listSection: { marginBottom: spacing.sm },
  listItem: { padding: spacing.sm, gap: spacing.xs },

  closeBoxInlineBtn: { marginTop: spacing.sm, paddingVertical: spacing.sm },

  boxFullCard: { padding: spacing.sm, marginBottom: spacing.sm, gap: spacing.xs },
  boxFullTitle: { fontSize: fontSize.sm },
  boxFullBtn: { paddingVertical: spacing.sm },

  // The picker owns the remaining height instead of forcing a 500dp scroll.
  // ~320dp tall minus header/tab bar leaves ~230dp of viewport to share.
  oplPickerWrap: { minHeight: 0 },
  pickerHost: { minHeight: 150 },
});
