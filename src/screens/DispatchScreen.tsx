import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import {
  getFplPreview,
  createDeliveryNoteFromFpl,
  FplPreview,
} from '../services/api';
import ScanInput from '../components/ScanInput';
import ScanConfirmation from '../components/ScanConfirmation';
import { onScanSuccess, onScanError } from '../utils/feedback';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

function deriveFplFromScan(input: string): string {
  let cleaned = (input || '').trim();
  if (!cleaned) return '';
  try {
    const parsed = JSON.parse(cleaned);
    cleaned = String(parsed.fpl ?? parsed.name ?? cleaned).trim();
  } catch {
    /* raw string */
  }
  return cleaned;
}

export default function DispatchScreen() {
  const { isConnected } = useApp();

  const [preview, setPreview] = useState<FplPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [driverName, setDriverName] = useState('');
  const [truckReg, setTruckReg] = useState('');

  const [confirmation, setConfirmation] = useState<{
    visible: boolean;
    type: 'success' | 'error';
    message: string;
  }>({ visible: false, type: 'success', message: '' });

  const show = (type: 'success' | 'error', message: string) =>
    setConfirmation({ visible: true, type, message });

  const loadPreview = useCallback(async (fpl: string) => {
    if (!isConnected) {
      show('error', 'Go online — dispatch requires server access');
      onScanError();
      return;
    }
    setLoading(true);
    try {
      const p = await getFplPreview(fpl);
      setPreview(p);
      if (p.already_dispatched) {
        show('error', `Already dispatched on DN ${p.existing_dn}`);
      } else {
        show('success', `${p.total_boxes} boxes · ${p.total_stems} stems`);
        onScanSuccess();
      }
    } catch (e: any) {
      onScanError();
      show('error', e.message || 'Could not load FPL');
    } finally {
      setLoading(false);
    }
  }, [isConnected]);

  const handleScan = useCallback(async (raw: string) => {
    const fpl = deriveFplFromScan(raw);
    if (!fpl) return;
    await loadPreview(fpl);
  }, [loadPreview]);

  const handleSubmit = useCallback(async () => {
    if (!preview) return;
    if (preview.already_dispatched) {
      show('error', 'This FPL is already dispatched');
      return;
    }
    if (!driverName.trim() || !truckReg.trim()) {
      show('error', 'Driver name and truck reg are required');
      return;
    }
    Alert.alert(
      'Create Delivery Note',
      `Dispatch ${preview.total_boxes} boxes (${preview.total_stems} stems) for ${preview.customer}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setSubmitting(true);
            try {
              const res = await createDeliveryNoteFromFpl({
                fpl: preview.fpl,
                driver_name: driverName.trim(),
                truck_reg: truckReg.trim(),
              });
              show('success', `DN ${res.delivery_note} created`);
              onScanSuccess();
              setPreview(null);
              setDriverName('');
              setTruckReg('');
            } catch (e: any) {
              show('error', e.message || 'Dispatch failed');
              onScanError();
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  }, [preview, driverName, truckReg]);

  const reset = () => {
    Alert.alert('Reset', 'Scan a different FPL?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset', style: 'destructive',
        onPress: () => { setPreview(null); setDriverName(''); setTruckReg(''); },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {!preview ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="qr-code-outline" size={20} color={colors.text} />
              <Text style={styles.sectionTitle}>Scan Farm Pack List</Text>
            </View>
            <Text style={styles.hint}>
              Scan an <Text style={styles.bold}>FPL</Text> to load its boxes and create a Delivery Note.
            </Text>
            <ScanInput
              placeholder="FPL number"
              scannerTitle="Scan FPL"
              onScan={handleScan}
              disabled={loading}
            />
            {loading && (
              <View style={styles.loading}>
                <ActivityIndicator size="small" color={colors.textMuted} />
                <Text style={styles.loadingText}>Loading FPL…</Text>
              </View>
            )}
          </View>
        ) : (
          <>
            <View style={styles.headerCard}>
              <View style={styles.headerRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.customer} numberOfLines={1}>{preview.customer || '—'}</Text>
                  <Text style={styles.fpl}>{preview.fpl}</Text>
                  {preview.sales_order && (
                    <Text style={styles.so}>{preview.sales_order}</Text>
                  )}
                </View>
                <TouchableOpacity onPress={reset} style={styles.resetBtn}>
                  <Ionicons name="close-outline" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <View style={styles.totalsRow}>
                <View style={styles.totalCell}>
                  <Text style={styles.totalLabel}>Boxes</Text>
                  <Text style={styles.totalValue}>{preview.total_boxes}</Text>
                </View>
                <View style={styles.totalCell}>
                  <Text style={styles.totalLabel}>Stems</Text>
                  <Text style={styles.totalValue}>{preview.total_stems}</Text>
                </View>
                <View style={styles.totalCell}>
                  <Text style={styles.totalLabel}>Lines</Text>
                  <Text style={styles.totalValue}>{preview.items.length}</Text>
                </View>
              </View>

              {preview.delivery_point ? (
                <View style={styles.addrRow}>
                  <Ionicons name="location-outline" size={14} color={colors.textMuted} />
                  <Text style={styles.addrText}>Drop-off: {preview.delivery_point}</Text>
                </View>
              ) : null}
              {!!preview.shipping_address_display && (
                <View style={styles.addrBox}>
                  <Text style={styles.addrTitle}>Shipping Address</Text>
                  <Text style={styles.addrBody}>
                    {preview.shipping_address_display.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim()}
                  </Text>
                </View>
              )}
            </View>

            {preview.already_dispatched ? (
              <View style={styles.warn}>
                <Ionicons name="warning" size={18} color={colors.warning} />
                <Text style={styles.warnText}>
                  Already dispatched on Delivery Note {preview.existing_dn}.
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.section}>
                  <Text style={styles.label}>Driver Name</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. James K."
                    placeholderTextColor={colors.textMuted}
                    value={driverName}
                    onChangeText={setDriverName}
                    editable={!submitting}
                  />

                  <Text style={[styles.label, { marginTop: spacing.md }]}>Truck Reg</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. KCV 123A"
                    placeholderTextColor={colors.textMuted}
                    value={truckReg}
                    onChangeText={(v) => setTruckReg(v.toUpperCase())}
                    autoCapitalize="characters"
                    editable={!submitting}
                  />
                </View>

                <TouchableOpacity
                  style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
                  onPress={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color={colors.textOnPrimary} />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={20} color={colors.textOnPrimary} />
                      <Text style={styles.submitBtnText}>Create Delivery Note</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Items</Text>
              {preview.items.map((it) => (
                <View key={it.item_code} style={styles.itemRow}>
                  <Text style={styles.itemCode} numberOfLines={1}>{it.item_code}</Text>
                  <Text style={styles.itemQty}>{it.qty}</Text>
                  <Text style={styles.itemBoxes}>{it.boxes} box{it.boxes === 1 ? '' : 'es'}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <ScanConfirmation
        visible={confirmation.visible}
        type={confirmation.type}
        message={confirmation.message}
        onDismiss={() => setConfirmation({ ...confirmation, visible: false })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, gap: spacing.md },
  section: { backgroundColor: colors.surface, borderRadius: borderRadius.md, padding: spacing.md, gap: spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.text },
  hint: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 18 },
  bold: { fontFamily: fontFamily.semiBold },
  loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  loadingText: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  headerCard: { backgroundColor: colors.surface, borderRadius: borderRadius.md, padding: spacing.md, gap: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  customer: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: colors.text },
  fpl: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  so: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },
  resetBtn: { padding: spacing.xs },
  totalsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  totalCell: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, backgroundColor: colors.background, borderRadius: borderRadius.sm },
  totalLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, textTransform: 'uppercase' },
  totalValue: { fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: colors.text, marginTop: 2 },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  addrText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  addrBox: { backgroundColor: colors.background, borderRadius: borderRadius.sm, padding: spacing.sm, marginTop: spacing.xs },
  addrTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: colors.textMuted, textTransform: 'uppercase' },
  addrBody: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.text, marginTop: spacing.xs, lineHeight: 18 },
  warn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: '#fff7e6', borderRadius: borderRadius.sm },
  warnText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text, flex: 1 },
  label: { fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.sm, padding: spacing.sm, fontFamily: fontFamily.medium, fontSize: fontSize.md, color: colors.text, marginTop: spacing.xs, backgroundColor: colors.background },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primary, padding: spacing.lg, borderRadius: borderRadius.md },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.textOnPrimary },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  itemCode: { flex: 1, fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  itemQty: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: colors.text, minWidth: 50, textAlign: 'right' },
  itemBoxes: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, minWidth: 60, textAlign: 'right' },
});
