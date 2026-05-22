import React, { useCallback, useEffect, useMemo, useReducer } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import {
  getXfloraOplHeader,
  getBunchInfo,
  listXfloraOpls,
  submitXfloraPackList,
} from '../services/api';
import ScanInput from '../components/ScanInput';
import ScanConfirmation from '../components/ScanConfirmation';
import Dropdown, { DropdownOption } from '../components/Dropdown';
import { XfloraOplHeader, XfloraPackItem } from '../types';
import { extractGradingQRValue } from '../utils/grading-utils';
import { onScanSuccess, onScanError } from '../utils/feedback';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

type Phase = 'scan_opl' | 'packing';

interface ScanRow {
  bunch_id: string;
  item_code: string;
  bunch_uom: string;
  custom_stem_length: string;
  time: string;
}

interface State {
  phase: Phase;
  loading: boolean;
  submitting: boolean;
  header: XfloraOplHeader | null;
  boxNumber: number;
  scans: ScanRow[];
  toast: { visible: boolean; type: 'success' | 'error'; message: string };
}

type Action =
  | { type: 'set_loading'; loading: boolean }
  | { type: 'set_submitting'; submitting: boolean }
  | { type: 'session_loaded'; header: XfloraOplHeader }
  | { type: 'reset_session' }
  | { type: 'set_box'; box: number }
  | { type: 'add_scan'; scan: ScanRow }
  | { type: 'box_closed' }
  | { type: 'toast_show'; toastType: 'success' | 'error'; message: string }
  | { type: 'toast_hide' };

const INITIAL: State = {
  phase: 'scan_opl',
  loading: false,
  submitting: false,
  header: null,
  boxNumber: 1,
  scans: [],
  toast: { visible: false, type: 'success', message: '' },
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'set_loading':
      return { ...state, loading: action.loading };
    case 'set_submitting':
      return { ...state, submitting: action.submitting };
    case 'session_loaded':
      return { ...state, header: action.header, phase: 'packing', boxNumber: 1, scans: [] };
    case 'reset_session':
      return INITIAL;
    case 'set_box':
      return { ...state, boxNumber: action.box, scans: [] };
    case 'add_scan':
      return { ...state, scans: [action.scan, ...state.scans] };
    case 'box_closed':
      return { ...state, boxNumber: state.boxNumber + 1, scans: [] };
    case 'toast_show':
      return { ...state, toast: { visible: true, type: action.toastType, message: action.message } };
    case 'toast_hide':
      return { ...state, toast: { ...state.toast, visible: false } };
    default:
      return state;
  }
}

function deriveOpl(input: string): string {
  let cleaned = (input || '').trim();
  if (!cleaned) return '';
  try {
    const parsed = JSON.parse(cleaned);
    cleaned = String(parsed.opl ?? parsed.name ?? parsed.box_id ?? cleaned).trim();
  } catch {
    // raw string
  }
  // Xflora QR encodes the full desk URL, e.g.
  //   https://xflora.fsn.frappe.cloud/app/order-pick-list/OPL-2026-00114
  // or .../desk/order-pick-list/OPL-2026-00114 — pull the trailing segment.
  const urlMatch = cleaned.match(/(?:order[-_ ]?pick[-_ ]?l?ist)\/([^/?#]+)/i);
  if (urlMatch) cleaned = decodeURIComponent(urlMatch[1]);
  // Box label suffix "OPL-2026-0003-B1" → strip it
  const m = cleaned.match(/^(.+)-B\d+$/);
  return m ? m[1] : cleaned;
}

const ScanRowItem = React.memo(function ScanRowItem({ row }: { row: ScanRow }) {
  return (
    <View style={styles.listItem}>
      <View style={[styles.statusDot, styles.dotOk]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.listItemId} numberOfLines={1}>{row.bunch_id}</Text>
        <Text style={styles.listItemSub} numberOfLines={1}>
          {row.item_code}
          {row.custom_stem_length ? ` · ${row.custom_stem_length}cm` : ''}
          {row.bunch_uom ? ` · ${row.bunch_uom}` : ''}
        </Text>
      </View>
      <Text style={styles.listItemTime}>{row.time}</Text>
    </View>
  );
});

export default function XfloraPackingScreen() {
  const { isConnected } = useApp();
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const [oplOptions, setOplOptions] = React.useState<DropdownOption[]>([]);
  const [oplListLoading, setOplListLoading] = React.useState(false);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    dispatch({ type: 'toast_show', toastType: type, message });
  }, []);

  // Load the OPL list when the user lands on the scan-OPL phase and is online.
  // Cheap fetch (one call, one dropdown's worth of rows) — no per-keystroke calls.
  useEffect(() => {
    if (state.phase !== 'scan_opl' || !isConnected) return;
    let cancelled = false;
    setOplListLoading(true);
    listXfloraOpls(150)
      .then((rows) => {
        if (cancelled) return;
        setOplOptions(rows.map((r) => ({
          value: r.name,
          label: r.customer ? `${r.name}  ·  ${r.customer}` : r.name,
        })));
      })
      .catch(() => { /* dropdown stays empty; scan still works */ })
      .finally(() => { if (!cancelled) setOplListLoading(false); });
    return () => { cancelled = true; };
  }, [state.phase, isConnected]);

  const handleScanOpl = useCallback(async (data: string) => {
    const opl = deriveOpl(data);
    if (!opl) return;
    if (!isConnected) {
      showToast('error', 'Go online — packing requires a live connection');
      onScanError();
      return;
    }
    dispatch({ type: 'set_loading', loading: true });
    try {
      const header = await getXfloraOplHeader(opl);
      if (!header.sales_order) {
        showToast('error', `${opl} has no Sales Order linked`);
        onScanError();
        return;
      }
      dispatch({ type: 'session_loaded', header });
      onScanSuccess();
      showToast('success', `${header.customer} — Box 1`);
    } catch (e: any) {
      onScanError();
      showToast('error', e?.message || 'Could not load OPL');
    } finally {
      dispatch({ type: 'set_loading', loading: false });
    }
  }, [isConnected, showToast]);

  const handleScanBunch = useCallback(async (data: string) => {
    const bunchId = extractGradingQRValue(data);
    if (!bunchId) return;
    if (state.scans.some((s) => s.bunch_id === bunchId)) {
      onScanError();
      showToast('error', `${bunchId} already scanned in this box`);
      return;
    }
    if (!isConnected) {
      onScanError();
      showToast('error', 'Go online to scan bunches');
      return;
    }
    try {
      const info = await getBunchInfo(bunchId);
      if (!info.item_code || !info.stem_length || !info.bunch_size) {
        onScanError();
        showToast('error', `${bunchId} is missing variety/length/UOM`);
        return;
      }
      dispatch({
        type: 'add_scan',
        scan: {
          bunch_id: bunchId,
          item_code: info.item_code,
          bunch_uom: info.bunch_size,
          custom_stem_length: info.stem_length,
          time: new Date().toLocaleTimeString(),
        },
      });
      onScanSuccess();
      showToast('success', `+ ${bunchId}`);
    } catch (e: any) {
      onScanError();
      showToast('error', e?.message || 'Could not read bunch');
    }
  }, [state.scans, isConnected, showToast]);

  const submitClose = useCallback(async () => {
    if (!state.header || state.scans.length === 0 || state.submitting) return;
    dispatch({ type: 'set_submitting', submitting: true });
    try {
      const items: XfloraPackItem[] = state.scans.map((s) => ({
        item_code: s.item_code,
        bunch_uom: s.bunch_uom,
        bunch_id: s.bunch_id,
        custom_stem_length: s.custom_stem_length,
        box_id: String(state.boxNumber),
        bunch_qty: 1,
      }));
      const resp = await submitXfloraPackList({
        custom_sales_order: state.header.sales_order,
        custom_customer: state.header.customer,
        custom_farm: state.header.farm,
        custom_order_pick_list: state.header.opl,
        items,
      });
      const data = resp.data || (resp as any).message?.data || (resp as any);
      const skipped: any[] = data?.already_packed || [];
      const closedBox = state.boxNumber;
      dispatch({ type: 'box_closed' });
      onScanSuccess();
      const skippedTxt = skipped.length
        ? ` · skipped ${skipped.length} already-packed`
        : '';
      showToast('success', `Box ${closedBox} closed — ${items.length - skipped.length} bunches${skippedTxt}`);
    } catch (e: any) {
      onScanError();
      showToast('error', e?.message || 'Could not close box');
    } finally {
      dispatch({ type: 'set_submitting', submitting: false });
    }
  }, [state.header, state.scans, state.boxNumber, state.submitting, showToast]);

  const confirmClose = useCallback(() => {
    if (state.scans.length === 0) return;
    Alert.alert(
      `Close Box ${state.boxNumber}`,
      `Submit ${state.scans.length} bunch${state.scans.length === 1 ? '' : 'es'} to Farm Pack List?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Close', onPress: submitClose },
      ]
    );
  }, [state.boxNumber, state.scans.length, submitClose]);

  const resetSession = useCallback(() => {
    Alert.alert('Reset', 'Discard the current OPL session?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => dispatch({ type: 'reset_session' }) },
    ]);
  }, []);

  const skipBox = useCallback(() => {
    if (state.scans.length > 0) {
      Alert.alert('Switch box', 'Close the current box before switching — there are unsubmitted scans.');
      return;
    }
    dispatch({ type: 'set_box', box: state.boxNumber + 1 });
  }, [state.boxNumber, state.scans.length]);

  const keyExtractor = useCallback((row: ScanRow) => row.bunch_id, []);
  const renderItem = useCallback(({ item }: { item: ScanRow }) => <ScanRowItem row={item} />, []);

  const headerNode = useMemo(() => {
    if (state.phase !== 'packing' || !state.header) return null;
    return (
      <View>
        <View style={styles.sessionCard}>
          <View style={styles.sessionHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sessionCustomer} numberOfLines={1}>{state.header.customer || 'Customer'}</Text>
              <Text style={styles.sessionOpl}>{state.header.opl}</Text>
              <Text style={styles.sessionMeta} numberOfLines={1}>
                SO {state.header.sales_order}
                {state.header.farm ? ` · ${state.header.farm}` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={resetSession} style={styles.resetBtn}>
              <Ionicons name="close-outline" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={styles.boxRow}>
            <Ionicons name="cube" size={16} color={colors.primary} />
            <Text style={styles.boxText}>Box {state.boxNumber}</Text>
            {state.scans.length === 0 && (
              <TouchableOpacity onPress={skipBox} style={styles.skipBtn} activeOpacity={0.7}>
                <Text style={styles.skipBtnText}>Skip</Text>
                <Ionicons name="chevron-forward" size={12} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="leaf-outline" size={20} color={colors.text} />
            <Text style={styles.sectionTitle}>Scan Bunch</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{state.scans.length}</Text>
            </View>
          </View>
          <ScanInput
            placeholder="Bunch ID"
            scannerTitle="Scan Bunch QR Code"
            onScan={handleScanBunch}
            disabled={state.submitting}
          />
        </View>

        {state.scans.length > 0 && (
          <Text style={styles.listHeader}>Scanned for box {state.boxNumber}</Text>
        )}
      </View>
    );
  }, [state.phase, state.header, state.boxNumber, state.scans.length, state.submitting, resetSession, skipBox, handleScanBunch]);

  const footerNode = useMemo(() => {
    if (state.phase !== 'packing') return null;
    return (
      <TouchableOpacity
        style={[styles.closeBtn, (state.submitting || state.scans.length === 0) && styles.closeBtnDisabled]}
        onPress={confirmClose}
        disabled={state.submitting || state.scans.length === 0}
        activeOpacity={0.8}
      >
        {state.submitting ? (
          <ActivityIndicator size="small" color={colors.textOnPrimary} />
        ) : (
          <Ionicons name="checkmark-circle-outline" size={20} color={colors.textOnPrimary} />
        )}
        <Text style={styles.closeBtnText}>
          {state.submitting ? 'Submitting…' : `Close Box ${state.boxNumber} (${state.scans.length})`}
        </Text>
      </TouchableOpacity>
    );
  }, [state.phase, state.submitting, state.scans.length, state.boxNumber, confirmClose]);

  return (
    <View style={styles.container}>

      {state.phase === 'scan_opl' ? (
        <View style={styles.scanOplWrap}>
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="qr-code-outline" size={20} color={colors.text} />
              <Text style={styles.sectionTitle}>Start Packing</Text>
            </View>
            <Text style={styles.sectionHint}>
              Scan the <Text style={styles.bold}>OPL QR</Text> or pick from the list.
              Bunches will be packed into numbered boxes and submitted to the Farm Pack List on close.
            </Text>
            <ScanInput
              placeholder="OPL number"
              scannerTitle="Scan OPL"
              onScan={handleScanOpl}
              disabled={state.loading}
            />

            <Text style={styles.orLabel}>or pick an OPL</Text>
            <Dropdown
              value=""
              options={oplOptions}
              placeholder={
                oplListLoading
                  ? 'Loading OPLs…'
                  : oplOptions.length
                    ? `${oplOptions.length} open OPL${oplOptions.length === 1 ? '' : 's'}`
                    : (isConnected ? 'No OPLs available' : 'Go online to load OPLs')
              }
              searchable
              disabled={state.loading || oplListLoading || oplOptions.length === 0}
              onSelect={(v) => v && handleScanOpl(v)}
            />

            {state.loading && (
              <View style={styles.loading}>
                <ActivityIndicator size="small" color={colors.textMuted} />
                <Text style={styles.loadingText}>Loading OPL…</Text>
              </View>
            )}
          </View>
        </View>
      ) : (
        <FlatList
          data={state.scans}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          ListHeaderComponent={headerNode}
          ListFooterComponent={footerNode}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          windowSize={5}
          removeClippedSubviews
        />
      )}

      <ScanConfirmation
        visible={state.toast.visible}
        type={state.toast.type}
        message={state.toast.message}
        onDismiss={() => dispatch({ type: 'toast_hide' })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scanOplWrap: { padding: spacing.lg },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xxl },

  section: { marginBottom: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  sectionTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.text, flex: 1 },
  sectionHint: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted, marginBottom: spacing.md },
  bold: { fontFamily: fontFamily.semiBold, color: colors.text },

  loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  loadingText: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },
  orLabel: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },

  countBadge: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  countBadgeText: { fontFamily: fontFamily.bold, fontSize: fontSize.xs, color: colors.textOnPrimary },

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
  sessionMeta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  resetBtn: { padding: spacing.xs },

  boxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
  },
  boxText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text, flex: 1 },
  skipBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  skipBtnText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.primary },

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
  listItemId: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  listItemSub: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  listItemTime: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },

  closeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  closeBtnDisabled: { opacity: 0.4 },
  closeBtnText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.textOnPrimary },
});
