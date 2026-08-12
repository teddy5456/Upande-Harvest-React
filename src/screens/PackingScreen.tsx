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
  getPackBoxRecipe,
  packBunchToOpl,
  MixRecipeItem,
} from '../services/api';
import ScanInput from '../components/ScanInput';
import ScanConfirmation from '../components/ScanConfirmation';
import OplPicker from '../components/OplPicker';
import { PackingListEntry, PackBoxSummary, PackableOpl } from '../types';
import { extractGradingQRValue } from '../utils/grading-utils';
import { onScanSuccess, onScanError } from '../utils/feedback';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

type Mode = 'box' | 'opl';

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

interface ActiveBoxSession {
  opl: string;
  customer: string;
  farm: string;
  pack_rate: number;
  active_box: PackBoxSummary;
  all_boxes: PackBoxSummary[];
}

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

  const [mode, setMode] = useState<Mode>('box');

  // Box-label mode (existing flow)
  const [session, setSession] = useState<ActiveBoxSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [bunches, setBunches] = useState<PackingListEntry[]>([]);
  const [stemsInBox, setStemsInBox] = useState(0);
  const [closing, setClosing] = useState(false);
  const [recipe, setRecipe] = useState<MixRecipeItem[] | null>(null);
  const [isMixBox, setIsMixBox] = useState(false);

  // OPL mode (new direct-to-FPL flow)
  const [oplSession, setOplSession] = useState<ActiveOplSession | null>(null);
  const [oplBunches, setOplBunches] = useState<PackingListEntry[]>([]);
  const [oplScanning, setOplScanning] = useState(false);
  const [boxFullDialog, setBoxFullDialog] = useState(false);

  const [confirmation, setConfirmation] = useState<{
    visible: boolean;
    type: 'success' | 'error';
    message: string;
  }>({ visible: false, type: 'success', message: '' });

  const show = (type: 'success' | 'error', message: string) =>
    setConfirmation({ visible: true, type, message });

  // ── Box-label mode handlers ───────────────────────────────────────────────

  const refreshRecipe = useCallback(async (packBoxName: string) => {
    try {
      const r = await getPackBoxRecipe(packBoxName);
      setIsMixBox(!!r.is_mix_box);
      setRecipe(r.is_mix_box ? r.recipe : null);
    } catch {
      setIsMixBox(false);
      setRecipe(null);
    }
  }, []);

  useEffect(() => {
    if (session?.active_box) {
      setStemsInBox(session.active_box.stems_count);
      refreshRecipe(session.active_box.name);
    } else {
      setRecipe(null);
      setIsMixBox(false);
    }
  }, [session?.active_box.name, refreshRecipe]);

  const loadSessionForOpl = useCallback(async (opl: string, preferredBoxId: string | null) => {
    if (!isConnected) {
      show('error', 'Go online to start — OPL details must be fetched');
      onScanError();
      return;
    }
    setLoadingSession(true);
    try {
      const resp = await getOpenBoxForOpl(opl);
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
    const bunchId = extractGradingQRValue(data);
    if (!bunchId) return;

    if (bunches.some((b) => b.bunch_id === bunchId)) {
      onScanError();
      show('error', `${bunchId} already scanned`);
      return;
    }

    if (!isConnected) {
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

      if (isMixBox && session.active_box.name) {
        refreshRecipe(session.active_box.name);
      }

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
  }, [session, bunches, isConnected, stemsInBox, isMixBox, refreshRecipe]);

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

  const handleOplBunchScanned = useCallback(async (data: string) => {
    if (!oplSession || boxFullDialog) return;
    if (!isConnected) {
      onScanError();
      show('error', 'Pack-by-OPL requires online — switch to Scan Box Label to queue offline');
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

      const previousBoxId = oplSession.current_box_id;
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

      if (oplSession.opl.is_mix && resp.pack_box_name) {
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
    } catch (error: any) {
      onScanError();
      show('error', error.message || 'Could not add bunch');
    } finally {
      setOplScanning(false);
    }
  }, [oplSession, oplBunches, isConnected, boxFullDialog, refreshOplRecipe]);

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

  const capPct = session ? Math.min(100, Math.round((stemsInBox / session.pack_rate) * 100)) : 0;
  const atCap = session ? stemsInBox >= session.pack_rate : false;

  const oplCapPct = oplSession
    ? Math.min(100, Math.round((oplSession.stems_in_box / oplSession.opl.pack_rate) * 100))
    : 0;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >

        {/* Mode toggle — only shown when no active session in either mode */}
        {!session && !oplSession && (
          <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[styles.modeOption, mode === 'box' && styles.modeOptionActive]}
              onPress={() => setMode('box')}
              activeOpacity={0.7}
            >
              <Ionicons
                name="qr-code-outline"
                size={14}
                color={mode === 'box' ? colors.textOnPrimary : colors.textMuted}
              />
              <Text style={[
                styles.modeOptionText,
                mode === 'box' && styles.modeOptionTextActive,
              ]}>Scan Box Label</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeOption, mode === 'opl' && styles.modeOptionActive]}
              onPress={() => setMode('opl')}
              activeOpacity={0.7}
            >
              <Ionicons
                name="list-outline"
                size={14}
                color={mode === 'opl' ? colors.textOnPrimary : colors.textMuted}
              />
              <Text style={[
                styles.modeOptionText,
                mode === 'opl' && styles.modeOptionTextActive,
              ]}>Pack by OPL</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ─── Box-label mode ──────────────────────────────────────── */}
        {mode === 'box' && (!session ? (
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
              keepFocused
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

            {isMixBox && recipe && recipe.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="list-outline" size={20} color={colors.text} />
                  <Text style={styles.sectionTitle}>Mix Recipe</Text>
                </View>
                {recipe.map((r) => (
                  <View key={r.item_code} style={styles.recipeRow}>
                    <Ionicons
                      name={r.done ? 'checkmark-circle' : 'ellipse-outline'}
                      size={18}
                      color={r.done ? colors.success || '#10b981' : colors.textMuted}
                    />
                    <Text style={styles.recipeName} numberOfLines={1}>
                      {r.item_name}
                    </Text>
                    <Text style={[styles.recipeCount, r.done && styles.recipeCountDone]}>
                      {r.packed_stems}/{r.target_stems}
                    </Text>
                  </View>
                ))}
              </View>
            )}

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
                keepFocused
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
        ))}

        {/* ─── OPL mode ────────────────────────────────────────────── */}
        {mode === 'opl' && (!oplSession ? (
          <View style={styles.oplPickerWrap}>
            <View style={styles.sectionHeader}>
              <Ionicons name="list-outline" size={20} color={colors.text} />
              <Text style={styles.sectionTitle}>Pick an OPL</Text>
            </View>
            <Text style={styles.sectionHint}>
              Choose by <Text style={styles.bold}>customer</Text>. The first scanned bunch
              opens a new box automatically — no need to print labels first.
            </Text>
            <View style={styles.pickerHost}>
              <OplPicker onSelect={handleOplPicked} />
            </View>
          </View>
        ) : (
          <>
            <View style={styles.sessionCard}>
              <View style={styles.sessionHeaderRow}>
                <View style={{ flex: 1 }}>
                  <View style={styles.oplHeaderTitleRow}>
                    <Text style={styles.sessionCustomer} numberOfLines={1}>
                      {oplSession.opl.customer_name || oplSession.opl.customer || '—'}
                    </Text>
                    {oplSession.opl.is_mix && (
                      <View style={styles.mixPillSmall}>
                        <Text style={styles.mixPillSmallText}>MIX</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.sessionOpl}>{oplSession.opl.opl}</Text>
                  {oplSession.opl.varieties ? (
                    <Text style={styles.sessionVarieties} numberOfLines={2}>
                      {oplSession.opl.varieties}
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity onPress={resetOplSession} style={styles.resetBtn}>
                  <Ionicons name="close-outline" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <View style={styles.boxSequenceRow}>
                <Ionicons name="cube" size={16} color={colors.primary} />
                <Text style={styles.boxSequenceText}>
                  {oplSession.current_box_id
                    ? `Box ${oplSession.current_box_sequence}`
                    : 'Next scan opens a new box'}
                </Text>
              </View>

              <View style={styles.progressCard}>
                <View style={styles.progressRow}>
                  <Text style={styles.progressLabel}>Stems</Text>
                  <Text style={[
                    styles.progressValue,
                    boxFullDialog && styles.progressValueFull,
                  ]}>
                    {oplSession.stems_in_box} / {oplSession.opl.pack_rate}
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

            {oplSession.is_mix_box && oplSession.recipe && oplSession.recipe.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="list-outline" size={20} color={colors.text} />
                  <Text style={styles.sectionTitle}>Mix Recipe</Text>
                </View>
                {oplSession.recipe.map((r) => (
                  <View key={r.item_code} style={styles.recipeRow}>
                    <Ionicons
                      name={r.done ? 'checkmark-circle' : 'ellipse-outline'}
                      size={18}
                      color={r.done ? colors.success || '#10b981' : colors.textMuted}
                    />
                    <Text style={styles.recipeName} numberOfLines={1}>
                      {r.item_name}
                    </Text>
                    <Text style={[styles.recipeCount, r.done && styles.recipeCountDone]}>
                      {r.packed_stems}/{r.target_stems}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="leaf-outline" size={20} color={colors.text} />
                <Text style={styles.sectionTitle}>Scan Bunch</Text>
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
                  style={styles.closeBoxInlineBtn}
                  onPress={handleManualCloseOplBox}
                  activeOpacity={0.8}
                  disabled={oplScanning}
                >
                  <Ionicons name="checkmark-done" size={16} color={colors.text} />
                  <Text style={styles.closeBoxInlineText}>
                    Close Box {oplSession.current_box_sequence}
                    {oplSession.stems_in_box > 0
                      ? ` (${oplSession.stems_in_box} stems)`
                      : ''}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {boxFullDialog && (
              <View style={styles.boxFullCard}>
                <View style={styles.boxFullHeader}>
                  <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                  <Text style={styles.boxFullTitle}>
                    Box {oplSession.current_box_sequence} full
                  </Text>
                </View>
                <Text style={styles.boxFullBody}>
                  {oplSession.stems_in_box}/{oplSession.opl.pack_rate} stems. Closed and synced to FPL.
                </Text>
                <TouchableOpacity
                  style={styles.boxFullBtn}
                  onPress={handleStartNextBox}
                  activeOpacity={0.8}
                >
                  <Ionicons name="add-circle-outline" size={18} color={colors.textOnPrimary} />
                  <Text style={styles.boxFullBtnText}>Start Next Box</Text>
                </TouchableOpacity>
              </View>
            )}

            {oplBunches.length > 0 && (
              <View style={styles.listSection}>
                <Text style={styles.listHeader}>Scanned this box</Text>
                {oplBunches.map((item) => (
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
          </>
        ))}

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

  // Mode toggle (segmented control)
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.full,
    padding: 3,
    marginBottom: spacing.lg,
  },
  modeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
  },
  modeOptionActive: {
    backgroundColor: colors.primary,
  },
  modeOptionText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    letterSpacing: 0.2,
  },
  modeOptionTextActive: {
    color: colors.textOnPrimary,
  },

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
  sessionVarieties: { fontFamily: fontFamily.regular, fontSize: 11, color: colors.textMuted, marginTop: 3, fontStyle: 'italic' },
  resetBtn: { padding: spacing.xs },

  oplHeaderTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

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

  recipeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  recipeName: { flex: 1, fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  recipeCount: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.textMuted },
  recipeCountDone: { color: colors.success || '#10b981' },

  // OPL picker host
  oplPickerWrap: { flex: 1, minHeight: 500 },
  pickerHost: { flex: 1, minHeight: 400 },

  // OPL mode — MIX pill (small variant, inside session card)
  mixPillSmall: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: borderRadius.full,
  },
  mixPillSmallText: {
    fontFamily: fontFamily.bold,
    fontSize: 9,
    color: colors.textOnPrimary,
    letterSpacing: 0.5,
  },

  // Box-full confirmation card (OPL mode)
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
});
