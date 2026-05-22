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
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useApp } from '../../context/AppContext';
import Dropdown, { DropdownOption } from '../../components/Dropdown';
import { getCachedGreenhouses } from '../../utils/greenhouse-cache';
import {
  createBedSamplingForm,
  listBedSamplingForms,
} from '../../services/api';
import {
  Greenhouse,
  SamplingStageRow,
  BedSamplingListEntry,
  stripStemLength,
  resolveVarietyToItemCode,
} from '../../types';
import {
  colors,
  fontFamily,
  fontSize,
  spacing,
  borderRadius,
  shadow,
} from '../../theme';

const COMMON_STAGES = [
  'Pinching',
  'Bud',
  'Color Show',
  'Open',
  'Harvestable',
];

function todayISODate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function formatDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
}

interface StageDraft {
  id: string;
  growth_stage: string;
  count: string;
  days_to_harvest: string;
}

function newStage(stage = ''): StageDraft {
  return {
    id: `${Date.now()}-${Math.random()}`,
    growth_stage: stage,
    count: '',
    days_to_harvest: '',
  };
}

export default function BedSamplingScreen() {
  const { isConnected } = useApp();

  const [greenhouses, setGreenhouses] = useState<Greenhouse[]>([]);
  const [loadingGH, setLoadingGH] = useState(false);

  const [greenhouse, setGreenhouse] = useState('');
  const [variety, setVariety] = useState('');
  const [bedNumber, setBedNumber] = useState('');
  const [samplingDate] = useState(todayISODate());
  const [notes, setNotes] = useState('');
  const [stages, setStages] = useState<StageDraft[]>([newStage()]);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<
    { type: 'success' | 'error'; text: string } | null
  >(null);

  const [recent, setRecent] = useState<BedSamplingListEntry[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  useEffect(() => {
    setLoadingGH(true);
    getCachedGreenhouses()
      .then(setGreenhouses)
      .catch(() => {})
      .finally(() => setLoadingGH(false));
  }, []);

  const loadRecent = useCallback(async () => {
    if (!isConnected) return;
    setLoadingRecent(true);
    try {
      setRecent(await listBedSamplingForms(greenhouse || undefined, 10));
    } catch {
      setRecent([]);
    }
    setLoadingRecent(false);
  }, [greenhouse, isConnected]);

  useFocusEffect(useCallback(() => { loadRecent(); }, [loadRecent]));

  const greenhouseOptions: DropdownOption[] = greenhouses.map((gh) => ({
    label: gh.warehouse_name || gh.name,
    value: gh.name,
  }));

  const selectedGH = greenhouses.find((gh) => gh.name === greenhouse);
  const varietyOptions: DropdownOption[] = (() => {
    if (!selectedGH) return [];
    const seen = new Set<string>();
    const list: DropdownOption[] = [];
    for (const v of selectedGH.custom_varieties_grown ?? []) {
      const base = stripStemLength(v.variety);
      if (seen.has(base)) continue;
      seen.add(base);
      list.push({ label: base, value: base });
    }
    return list;
  })();

  const updateStage = (id: string, patch: Partial<StageDraft>) => {
    setStages((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
    );
  };
  const addStage = (stage = '') =>
    setStages((prev) => [...prev, newStage(stage)]);
  const removeStage = (id: string) =>
    setStages((prev) => (prev.length === 1 ? prev : prev.filter((s) => s.id !== id)));

  const usedStages = new Set(stages.map((s) => s.growth_stage.trim().toLowerCase()).filter(Boolean));
  const availableCommonStages = COMMON_STAGES.filter(
    (s) => !usedStages.has(s.toLowerCase())
  );

  const totalCount = stages.reduce(
    (s, r) => s + (parseInt(r.count, 10) || 0),
    0
  );

  const canSubmit =
    !!greenhouse &&
    stages.some((s) => s.growth_stage.trim() && parseInt(s.count, 10) > 0) &&
    !submitting &&
    isConnected;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setFeedback(null);

    const rows: SamplingStageRow[] = stages
      .filter((s) => s.growth_stage.trim() && parseInt(s.count, 10) > 0)
      .map((s) => ({
        growth_stage: s.growth_stage.trim(),
        count: parseInt(s.count, 10) || 0,
        days_to_harvest: s.days_to_harvest
          ? parseInt(s.days_to_harvest, 10) || 0
          : undefined,
      }));

    try {
      await createBedSamplingForm({
        greenhouse,
        variety: variety
          ? resolveVarietyToItemCode(variety) || variety
          : undefined,
        bed_number: bedNumber ? parseInt(bedNumber, 10) || 0 : undefined,
        sampling_date: samplingDate,
        notes: notes.trim() || undefined,
        stages: rows,
      });

      setFeedback({
        type: 'success',
        text: `Sampled ${totalCount} stems across ${rows.length} stage${rows.length === 1 ? '' : 's'}`,
      });
      setStages([newStage()]);
      setBedNumber('');
      setVariety('');
      setNotes('');
      loadRecent();
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message ?? 'Failed to submit sample',
      });
    }
    setSubmitting(false);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.heading}>Bed Sampling</Text>
      <Text style={styles.subheading}>{formatDate(samplingDate)}</Text>

      <View style={styles.field}>
        <Text style={styles.label}>Greenhouse</Text>
        {loadingGH ? (
          <ActivityIndicator color={colors.textMuted} />
        ) : (
          <Dropdown
            value={greenhouse}
            options={greenhouseOptions}
            placeholder="Select greenhouse"
            onSelect={setGreenhouse}
            searchable
          />
        )}
      </View>

      <View style={styles.rowGrid}>
        <View style={[styles.field, { flex: 1 }]}>
          <Text style={styles.label}>Bed #</Text>
          <TextInput
            style={styles.input}
            value={bedNumber}
            onChangeText={(t) => setBedNumber(t.replace(/[^0-9]/g, ''))}
            placeholder="e.g. 12"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
          />
        </View>
        <View style={[styles.field, { flex: 2 }]}>
          <Text style={styles.label}>Variety (optional)</Text>
          <Dropdown
            value={variety}
            options={varietyOptions}
            placeholder={selectedGH ? 'Select variety' : 'Pick greenhouse first'}
            onSelect={setVariety}
            searchable
            disabled={!selectedGH}
          />
        </View>
      </View>

      <View style={styles.stagesHeader}>
        <Text style={styles.sectionTitle}>Growth stages</Text>
        <Text style={styles.totalsText}>{totalCount} stems</Text>
      </View>

      {availableCommonStages.length > 0 && (
        <View style={styles.chipRow}>
          {availableCommonStages.map((stage) => (
            <TouchableOpacity
              key={stage}
              style={styles.chip}
              onPress={() => {
                const empty = stages.find((s) => !s.growth_stage.trim());
                if (empty) {
                  updateStage(empty.id, { growth_stage: stage });
                } else {
                  addStage(stage);
                }
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={12} color={colors.text} />
              <Text style={styles.chipText}>{stage}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {stages.map((s, idx) => (
        <View key={s.id} style={styles.stageCard}>
          <View style={styles.stageHeader}>
            <Text style={styles.stageIndex}>#{idx + 1}</Text>
            {stages.length > 1 && (
              <TouchableOpacity onPress={() => removeStage(s.id)} hitSlop={8}>
                <Ionicons name="trash-outline" size={16} color={colors.error} />
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.smallLabel}>Growth stage</Text>
          <TextInput
            style={styles.input}
            value={s.growth_stage}
            onChangeText={(t) => updateStage(s.id, { growth_stage: t })}
            placeholder="e.g. Bud, Color Show, Open"
            placeholderTextColor={colors.textMuted}
          />

          <View style={styles.stageGrid}>
            <View style={styles.stageGridCell}>
              <Text style={styles.smallLabel}>Count</Text>
              <TextInput
                style={styles.input}
                value={s.count}
                onChangeText={(t) =>
                  updateStage(s.id, { count: t.replace(/[^0-9]/g, '') })
                }
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
              />
            </View>
            <View style={styles.stageGridCell}>
              <Text style={styles.smallLabel}>Days to harvest</Text>
              <TextInput
                style={styles.input}
                value={s.days_to_harvest}
                onChangeText={(t) =>
                  updateStage(s.id, { days_to_harvest: t.replace(/[^0-9]/g, '') })
                }
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
              />
            </View>
          </View>
        </View>
      ))}

      <TouchableOpacity
        style={styles.addBtn}
        onPress={() => addStage('')}
        activeOpacity={0.7}
      >
        <Ionicons name="add" size={18} color={colors.text} />
        <Text style={styles.addBtnText}>Add stage</Text>
      </TouchableOpacity>

      <View style={styles.field}>
        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Anything worth noting…"
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />
      </View>

      {feedback && (
        <View
          style={[
            styles.feedback,
            feedback.type === 'success' ? styles.feedbackOk : styles.feedbackErr,
          ]}
        >
          <Text style={styles.feedbackText}>{feedback.text}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
        disabled={!canSubmit}
        onPress={handleSubmit}
        activeOpacity={0.8}
      >
        {submitting ? (
          <ActivityIndicator color={colors.textOnPrimary} />
        ) : (
          <Text style={styles.submitBtnText}>Save Sample</Text>
        )}
      </TouchableOpacity>

      <View style={styles.recentSection}>
        <Text style={styles.sectionTitle}>Recent samples</Text>
        {loadingRecent ? (
          <ActivityIndicator color={colors.textMuted} />
        ) : recent.length === 0 ? (
          <Text style={styles.emptyText}>No samples yet</Text>
        ) : (
          recent.map((r) => (
            <View key={r.name} style={styles.recentRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.recentTitle}>
                  {r.greenhouse}{r.bed_number ? ` · Bed ${r.bed_number}` : ''}
                </Text>
                <Text style={styles.recentMeta}>
                  {formatDate(r.sampling_date)}
                  {r.variety ? ` · ${stripStemLength(r.variety)}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.recentStems}>{r.total_stems_sampled}</Text>
                <Text style={styles.recentMeta}>
                  ~{r.total_expected_harvest} expected
                </Text>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },

  heading: {
    fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: colors.text,
  },
  subheading: {
    fontFamily: fontFamily.regular, fontSize: fontSize.sm,
    color: colors.textSecondary, marginBottom: spacing.lg,
  },

  field: { marginBottom: spacing.md },
  rowGrid: { flexDirection: 'row', gap: spacing.md },
  label: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.sm,
    color: colors.text, marginBottom: spacing.xs,
  },
  smallLabel: {
    fontFamily: fontFamily.medium, fontSize: fontSize.xs,
    color: colors.textSecondary, marginBottom: spacing.xs, marginTop: spacing.xs,
  },
  input: {
    backgroundColor: colors.surfaceAlt, borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.text,
  },
  textarea: { minHeight: 70 },

  stagesHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: spacing.md, marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.text,
  },
  totalsText: {
    fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.textSecondary,
  },

  chipRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: spacing.xs, marginBottom: spacing.md,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    borderRadius: borderRadius.full, backgroundColor: colors.surfaceAlt,
  },
  chipText: {
    fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.text,
  },

  stageCard: {
    backgroundColor: colors.surface, borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    marginBottom: spacing.md, ...shadow.sm,
  },
  stageHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: spacing.xs,
  },
  stageIndex: {
    fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textMuted,
  },
  stageGrid: { flexDirection: 'row', gap: spacing.md },
  stageGridCell: { flex: 1 },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    borderStyle: 'dashed', marginBottom: spacing.lg,
  },
  addBtnText: {
    fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text,
  },

  feedback: {
    padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.md,
  },
  feedbackOk: { backgroundColor: 'rgba(34, 197, 94, 0.12)' },
  feedbackErr: { backgroundColor: 'rgba(239, 68, 68, 0.12)' },
  feedbackText: {
    fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text,
  },

  submitBtn: {
    backgroundColor: colors.primary, paddingVertical: spacing.md,
    borderRadius: borderRadius.md, alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.textOnPrimary,
  },

  recentSection: { marginTop: spacing.xl },
  emptyText: {
    fontFamily: fontFamily.regular, fontSize: fontSize.sm,
    color: colors.textMuted, paddingVertical: spacing.md,
  },
  recentRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  recentTitle: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text,
  },
  recentMeta: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs,
    color: colors.textMuted, marginTop: 2,
  },
  recentStems: {
    fontFamily: fontFamily.bold, fontSize: fontSize.md, color: colors.text,
  },
});
