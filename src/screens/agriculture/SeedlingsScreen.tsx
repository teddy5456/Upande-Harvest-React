import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useApp } from '../../context/AppContext';
import Dropdown, { DropdownOption } from '../../components/Dropdown';
import {
  createSeedlingRequest,
  createSeedlingDispatch,
  listSeedlingRequests,
  listPropagationBatches,
  listActiveCropCycles,
} from '../../services/api';
import {
  SeedlingRequestListEntry,
  PropagationBatchSummary,
  CropCycleSummary,
  stripStemLength,
} from '../../types';
import {
  colors,
  fontFamily,
  fontSize,
  spacing,
  borderRadius,
  shadow,
} from '../../theme';

type Mode = 'request' | 'dispatch';

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function SeedlingsScreen() {
  const { isConnected } = useApp();
  const [mode, setMode] = useState<Mode>('request');

  // Request fields
  const [reqVariety, setReqVariety] = useState('');
  const [reqQty, setReqQty] = useState('');
  const [reqDate, setReqDate] = useState('');

  // Dispatch fields
  const [batches, setBatches] = useState<PropagationBatchSummary[]>([]);
  const [cycles, setCycles] = useState<CropCycleSummary[]>([]);
  const [requests, setRequests] = useState<SeedlingRequestListEntry[]>([]);
  const [batch, setBatch] = useState('');
  const [destCycle, setDestCycle] = useState('');
  const [linkedRequest, setLinkedRequest] = useState('');
  const [dispatchQty, setDispatchQty] = useState('');

  // Shared
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<
    { type: 'success' | 'error'; text: string } | null
  >(null);

  const today = todayISO();

  const loadAll = useCallback(async () => {
    if (!isConnected) return;
    try {
      const [r, b, c] = await Promise.all([
        listSeedlingRequests(20),
        listPropagationBatches(100),
        listActiveCropCycles(undefined, 100),
      ]);
      setRequests(r);
      setBatches(b);
      setCycles(c);
    } catch {}
  }, [isConnected]);

  useFocusEffect(useCallback(() => { loadAll(); }, [loadAll]));

  const openRequests = requests.filter((r) =>
    ['Open', 'Partially Fulfilled'].includes(r.status)
  );

  const batchOptions: DropdownOption[] = batches.map((b) => ({
    label: `${b.name}${b.variety ? ` · ${stripStemLength(b.variety)}` : ''}${b.available_qty != null ? ` (${b.available_qty} avail)` : ''}`,
    value: b.name,
  }));
  const cycleOptions: DropdownOption[] = cycles.map((c) => ({
    label: `${c.greenhouse}${c.variety ? ` · ${c.variety}` : ''}`,
    value: c.name,
  }));
  const requestOptions: DropdownOption[] = openRequests.map((r) => ({
    label: `${r.name} · ${stripStemLength(r.variety)} (${r.qty_requested - r.total_dispatched} left)`,
    value: r.name,
  }));

  const canSubmit = mode === 'request'
    ? !!reqVariety && parseInt(reqQty, 10) > 0 && !submitting && isConnected
    : !!batch && parseInt(dispatchQty, 10) > 0 && !submitting && isConnected;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      if (mode === 'request') {
        await createSeedlingRequest({
          variety: reqVariety,
          qty_requested: parseInt(reqQty, 10),
          required_by_date: reqDate || undefined,
          notes: notes.trim() || undefined,
        });
        setFeedback({ type: 'success', text: `Requested ${reqQty} ${stripStemLength(reqVariety)} seedlings` });
        setReqVariety(''); setReqQty(''); setReqDate('');
      } else {
        await createSeedlingDispatch({
          batch,
          seedling_request: linkedRequest || undefined,
          destination_crop_cycle: destCycle || undefined,
          dispatch_date: today,
          qty_dispatched: parseInt(dispatchQty, 10),
          notes: notes.trim() || undefined,
        });
        setFeedback({ type: 'success', text: `Dispatched ${dispatchQty} seedlings` });
        setBatch(''); setDestCycle(''); setLinkedRequest(''); setDispatchQty('');
      }
      setNotes('');
      loadAll();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message ?? 'Failed to submit' });
    }
    setSubmitting(false);
  };

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={false} onRefresh={loadAll} />}
    >
      <View style={s.segmented}>
        {(['request', 'dispatch'] as Mode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[s.segItem, mode === m && s.segItemActive]}
            onPress={() => { setMode(m); setFeedback(null); }}
            activeOpacity={0.7}
          >
            <Text style={[s.segText, mode === m && s.segTextActive]}>
              {m === 'request' ? 'Request' : 'Dispatch'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.heading}>
        {mode === 'request' ? 'Seedling Request' : 'Seedling Dispatch'}
      </Text>
      <Text style={s.sub}>{today}</Text>

      {mode === 'request' ? (
        <>
          <View style={s.field}>
            <Text style={s.label}>Variety (Item code)</Text>
            <TextInput
              style={s.input}
              value={reqVariety}
              onChangeText={setReqVariety}
              placeholder="e.g. Athena 50cm"
              placeholderTextColor={colors.textMuted}
            />
          </View>
          <View style={s.rowGrid}>
            <View style={[s.field, { flex: 1 }]}>
              <Text style={s.label}>Qty needed</Text>
              <TextInput
                style={s.input}
                value={reqQty}
                onChangeText={(t) => setReqQty(t.replace(/[^0-9]/g, ''))}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
              />
            </View>
            <View style={[s.field, { flex: 1 }]}>
              <Text style={s.label}>Needed by (YYYY-MM-DD)</Text>
              <TextInput
                style={s.input}
                value={reqDate}
                onChangeText={setReqDate}
                placeholder="optional"
                placeholderTextColor={colors.textMuted}
              />
            </View>
          </View>
        </>
      ) : (
        <>
          <View style={s.field}>
            <Text style={s.label}>From propagation batch</Text>
            <Dropdown
              value={batch}
              options={batchOptions}
              placeholder="Select batch"
              onSelect={setBatch}
              searchable
            />
          </View>
          <View style={s.field}>
            <Text style={s.label}>Fulfills request (optional)</Text>
            <Dropdown
              value={linkedRequest}
              options={requestOptions}
              placeholder={openRequests.length ? 'Open requests' : 'No open requests'}
              onSelect={setLinkedRequest}
              searchable
              disabled={openRequests.length === 0}
            />
          </View>
          <View style={s.field}>
            <Text style={s.label}>Destination crop cycle (optional)</Text>
            <Dropdown
              value={destCycle}
              options={cycleOptions}
              placeholder="Select crop cycle"
              onSelect={setDestCycle}
              searchable
            />
          </View>
          <View style={s.field}>
            <Text style={s.label}>Qty dispatched</Text>
            <TextInput
              style={s.input}
              value={dispatchQty}
              onChangeText={(t) => setDispatchQty(t.replace(/[^0-9]/g, ''))}
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
            />
          </View>
        </>
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
            {mode === 'request' ? 'Submit Request' : 'Submit Dispatch'}
          </Text>
        )}
      </TouchableOpacity>

      {mode === 'request' && (
        <View style={s.recentSection}>
          <Text style={s.sectionTitle}>Recent requests</Text>
          {requests.length === 0 ? (
            <Text style={s.emptyText}>No requests yet</Text>
          ) : (
            requests.slice(0, 8).map((r) => (
              <View key={r.name} style={s.recentRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.recentTitle}>{stripStemLength(r.variety)}</Text>
                  <Text style={s.recentMeta}>
                    {r.name} · {r.status}
                    {r.required_by_date ? ` · by ${r.required_by_date}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.recentQty}>
                    {r.total_dispatched}/{r.qty_requested}
                  </Text>
                  <Text style={s.recentMeta}>dispatched</Text>
                </View>
              </View>
            ))
          )}
        </View>
      )}
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
  recentSection: { marginTop: spacing.xl },
  sectionTitle: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontFamily: fontFamily.regular, fontSize: fontSize.sm,
    color: colors.textMuted, paddingVertical: spacing.md,
  },
  recentRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  recentTitle: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text,
  },
  recentMeta: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs,
    color: colors.textMuted, marginTop: 2,
  },
  recentQty: { fontFamily: fontFamily.bold, fontSize: fontSize.md, color: colors.text },
});
