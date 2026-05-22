import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useApp } from '../../context/AppContext';
import Dropdown, { DropdownOption } from '../../components/Dropdown';
import {
  listActiveCropCycles,
  createCropCycleUproot,
  createCropCycleReplant,
} from '../../services/api';
import { CropCycleSummary } from '../../types';
import {
  colors,
  fontFamily,
  fontSize,
  spacing,
  borderRadius,
  shadow,
} from '../../theme';

type Mode = 'uproot' | 'replant';

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function UprootReplantScreen() {
  const { isConnected } = useApp();
  const [mode, setMode] = useState<Mode>('uproot');

  const [cycles, setCycles] = useState<CropCycleSummary[]>([]);
  const [loadingCycles, setLoadingCycles] = useState(false);

  const [cropCycle, setCropCycle] = useState('');
  const [bedNumber, setBedNumber] = useState('');
  const [qty, setQty] = useState('');
  const [eventDate] = useState(todayISO());
  const [reason, setReason] = useState('');
  const [source, setSource] = useState('');
  const [costPerPlant, setCostPerPlant] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<
    { type: 'success' | 'error'; text: string } | null
  >(null);

  const load = useCallback(async () => {
    if (!isConnected) return;
    setLoadingCycles(true);
    try {
      setCycles(await listActiveCropCycles(undefined, 200));
    } catch {
      setCycles([]);
    }
    setLoadingCycles(false);
  }, [isConnected]);
  useEffect(() => { load(); }, [load]);

  const cycleOptions: DropdownOption[] = cycles.map((c) => ({
    label: `${c.greenhouse}${c.variety ? ` · ${c.variety}` : ''} (${c.cycle_status})`,
    value: c.name,
  }));

  const canSubmit =
    !!cropCycle &&
    parseInt(bedNumber, 10) > 0 &&
    parseInt(qty, 10) > 0 &&
    !submitting &&
    isConnected;

  const reset = () => {
    setCropCycle(''); setBedNumber(''); setQty('');
    setReason(''); setSource(''); setCostPerPlant(''); setNotes('');
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      if (mode === 'uproot') {
        await createCropCycleUproot({
          crop_cycle: cropCycle,
          bed_number: parseInt(bedNumber, 10),
          qty: parseInt(qty, 10),
          uproot_date: eventDate,
          reason: reason.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        setFeedback({ type: 'success', text: `Uprooted ${qty} plants from bed ${bedNumber}` });
      } else {
        await createCropCycleReplant({
          crop_cycle: cropCycle,
          bed_number: parseInt(bedNumber, 10),
          qty: parseInt(qty, 10),
          replanting_date: eventDate,
          source: source.trim() || undefined,
          cost_per_plant: costPerPlant ? parseFloat(costPerPlant) : undefined,
          notes: notes.trim() || undefined,
        });
        setFeedback({ type: 'success', text: `Replanted ${qty} plants on bed ${bedNumber}` });
      }
      reset();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message ?? 'Failed to submit' });
    }
    setSubmitting(false);
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.segmented}>
        {(['uproot', 'replant'] as Mode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[s.segItem, mode === m && s.segItemActive]}
            onPress={() => { setMode(m); setFeedback(null); }}
            activeOpacity={0.7}
          >
            <Text style={[s.segText, mode === m && s.segTextActive]}>
              {m === 'uproot' ? 'Uproot' : 'Replant'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.heading}>
        {mode === 'uproot' ? 'Uproot Record' : 'Replant Record'}
      </Text>
      <Text style={s.sub}>{eventDate}</Text>

      <View style={s.field}>
        <Text style={s.label}>Crop Cycle</Text>
        {loadingCycles ? (
          <ActivityIndicator color={colors.textMuted} />
        ) : (
          <Dropdown
            value={cropCycle}
            options={cycleOptions}
            placeholder="Select active crop cycle"
            onSelect={setCropCycle}
            searchable
          />
        )}
      </View>

      <View style={s.rowGrid}>
        <View style={[s.field, { flex: 1 }]}>
          <Text style={s.label}>Bed #</Text>
          <TextInput
            style={s.input}
            value={bedNumber}
            onChangeText={(t) => setBedNumber(t.replace(/[^0-9]/g, ''))}
            placeholder="e.g. 12"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
          />
        </View>
        <View style={[s.field, { flex: 1 }]}>
          <Text style={s.label}>Qty plants</Text>
          <TextInput
            style={s.input}
            value={qty}
            onChangeText={(t) => setQty(t.replace(/[^0-9]/g, ''))}
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
          />
        </View>
      </View>

      {mode === 'uproot' ? (
        <View style={s.field}>
          <Text style={s.label}>Reason</Text>
          <TextInput
            style={s.input}
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. Disease, age, mortality"
            placeholderTextColor={colors.textMuted}
          />
        </View>
      ) : (
        <View style={s.rowGrid}>
          <View style={[s.field, { flex: 2 }]}>
            <Text style={s.label}>Source</Text>
            <TextInput
              style={s.input}
              value={source}
              onChangeText={setSource}
              placeholder="e.g. Nursery batch / supplier"
              placeholderTextColor={colors.textMuted}
            />
          </View>
          <View style={[s.field, { flex: 1 }]}>
            <Text style={s.label}>Cost / plant</Text>
            <TextInput
              style={s.input}
              value={costPerPlant}
              onChangeText={(t) => setCostPerPlant(t.replace(/[^0-9.]/g, ''))}
              placeholder="0.00"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
      )}

      <View style={s.field}>
        <Text style={s.label}>Notes (optional)</Text>
        <TextInput
          style={[s.input, s.textarea]}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          placeholderTextColor={colors.textMuted}
        />
      </View>

      {feedback && (
        <View style={[s.feedback, feedback.type === 'success' ? s.feedbackOk : s.feedbackErr]}>
          <Text style={s.feedbackText}>{feedback.text}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[s.submitBtn, !canSubmit && s.submitBtnDisabled]}
        disabled={!canSubmit}
        onPress={handleSubmit}
        activeOpacity={0.8}
      >
        {submitting ? (
          <ActivityIndicator color={colors.textOnPrimary} />
        ) : (
          <Text style={s.submitBtnText}>
            {mode === 'uproot' ? 'Save Uproot' : 'Save Replant'}
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  segmented: {
    flexDirection: 'row', backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.full, padding: 2, alignSelf: 'center', marginBottom: spacing.lg,
  },
  segItem: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderRadius: borderRadius.full,
  },
  segItemActive: { backgroundColor: colors.primary },
  segText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.textSecondary },
  segTextActive: { color: colors.textOnPrimary },
  heading: { fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: colors.text },
  sub: {
    fontFamily: fontFamily.regular, fontSize: fontSize.sm,
    color: colors.textSecondary, marginBottom: spacing.lg,
  },
  field: { marginBottom: spacing.md },
  rowGrid: { flexDirection: 'row', gap: spacing.md },
  label: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.sm,
    color: colors.text, marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surfaceAlt, borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.text,
  },
  textarea: { minHeight: 70 },
  feedback: { padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.md },
  feedbackOk: { backgroundColor: 'rgba(34, 197, 94, 0.12)' },
  feedbackErr: { backgroundColor: 'rgba(239, 68, 68, 0.12)' },
  feedbackText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  submitBtn: {
    backgroundColor: colors.primary, paddingVertical: spacing.md,
    borderRadius: borderRadius.md, alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.textOnPrimary,
  },
});
