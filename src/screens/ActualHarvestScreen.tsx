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
import { useApp } from '../context/AppContext';
import { getFarm } from '../database/settings';
import { addActualHarvest, getTodayActualHarvest } from '../database/actual_harvest';
import { submitActualHarvest } from '../services/api';
import SyncBanner from '../components/SyncBanner';
import Dropdown, { DropdownOption } from '../components/Dropdown';
import { getCachedGreenhouses } from '../utils/greenhouse-cache';
import { colors, fontFamily, fontSize, spacing, borderRadius, shadow } from '../theme';
import { Greenhouse } from '../types';

function todayISODate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
}

export default function ActualHarvestScreen() {
  const { isConnected } = useApp();

  // Greenhouses
  const [greenhouses, setGreenhouses] = useState<Greenhouse[]>([]);
  const [loadingGreenhouses, setLoadingGreenhouses] = useState(false);

  // Form
  const [greenhouse, setGreenhouse] = useState('');
  const [variety, setVariety] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Success / error feedback
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Recent entries
  const [recentEntries, setRecentEntries] = useState<
    { greenhouse: string; variety: string; quantity: number }[]
  >([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  const today = todayISODate();

  // Load greenhouses
  useEffect(() => {
    setLoadingGreenhouses(true);
    getCachedGreenhouses()
      .then(setGreenhouses)
      .catch(() => {})
      .finally(() => setLoadingGreenhouses(false));
  }, []);

  // Load today's entries on focus
  const loadRecent = useCallback(async () => {
    setLoadingRecent(true);
    try {
      const entries = await getTodayActualHarvest();
      setRecentEntries(entries);
    } catch {}
    setLoadingRecent(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRecent();
    }, [loadRecent])
  );

  // Derived dropdown options
  const greenhouseOptions: DropdownOption[] = greenhouses.map((gh) => ({
    label: gh.warehouse_name || gh.name,
    value: gh.name,
  }));

  const selectedGH = greenhouses.find((gh) => gh.name === greenhouse);
  const varietyOptions: DropdownOption[] = selectedGH
    ? (selectedGH.custom_varieties_grown ?? []).map((v) => ({
        label: v.variety,
        value: v.variety,
      }))
    : [];

  const handleGreenhouseSelect = (val: string) => {
    setGreenhouse(val);
    setVariety(''); // reset variety on greenhouse change
  };

  const adjustQuantity = (delta: number) => {
    setQuantity((prev) => Math.max(1, prev + delta));
  };

  const handleQuantityInput = (text: string) => {
    const n = parseInt(text.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(n) && n >= 1) setQuantity(n);
    else if (text === '') setQuantity(1);
  };

  const showFeedback = (type: 'success' | 'error', text: string) => {
    setFeedbackMsg({ type, text });
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  const handleSubmit = async () => {
    if (!greenhouse.trim()) {
      showFeedback('error', 'Please select a greenhouse');
      return;
    }
    if (!variety.trim()) {
      showFeedback('error', 'Please select a variety');
      return;
    }
    if (quantity < 1) {
      showFeedback('error', 'Quantity must be at least 1');
      return;
    }

    setSubmitting(true);
    const farm = await getFarm();

    try {
      // Save locally first (offline-first)
      await addActualHarvest(greenhouse, variety, quantity, today, notes.trim(), farm, false);

      // Fire-and-forget API call if connected
      if (isConnected) {
        submitActualHarvest(greenhouse, variety, quantity, today, notes.trim(), farm).catch(() => {});
      }

      showFeedback('success', `Saved: ${quantity} stems of ${variety} from ${greenhouse}`);

      // Keep greenhouse + variety for quick entry, reset quantity + notes
      setQuantity(1);
      setNotes('');

      // Refresh recent entries
      await loadRecent();
    } catch (err: any) {
      showFeedback('error', err?.message ?? 'Failed to save entry');
    }

    setSubmitting(false);
  };

  const totalToday = recentEntries.reduce((s, e) => s + e.quantity, 0);

  return (
    <View style={styles.container}>
      <SyncBanner />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Date display */}
        <View style={styles.dateBadge}>
          <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.dateText}>{formatDisplayDate(today)}</Text>
        </View>

        {/* Form card */}
        <View style={styles.formCard}>
          <Text style={styles.cardTitle}>Record Actual Harvest</Text>

          {/* Greenhouse */}
          <View style={styles.field}>
            <Text style={styles.label}>
              Greenhouse <Text style={styles.required}>*</Text>
            </Text>
            {loadingGreenhouses ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={colors.textMuted} />
                <Text style={styles.loadingText}>Loading greenhouses…</Text>
              </View>
            ) : (
              <Dropdown
                value={greenhouse}
                options={greenhouseOptions}
                placeholder="Select greenhouse"
                onSelect={handleGreenhouseSelect}
                searchable={greenhouseOptions.length > 6}
              />
            )}
          </View>

          {/* Variety */}
          <View style={styles.field}>
            <Text style={styles.label}>
              Variety <Text style={styles.required}>*</Text>
            </Text>
            <Dropdown
              value={variety}
              options={varietyOptions}
              placeholder={greenhouse ? 'Select variety' : 'Select greenhouse first'}
              onSelect={setVariety}
              disabled={!greenhouse}
              searchable={varietyOptions.length > 6}
            />
          </View>

          {/* Quantity stepper */}
          <View style={styles.field}>
            <Text style={styles.label}>
              Quantity (stems) <Text style={styles.required}>*</Text>
            </Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => adjustQuantity(-10)}
                activeOpacity={0.7}
              >
                <Text style={styles.stepperBtnText}>−10</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => adjustQuantity(-1)}
                activeOpacity={0.7}
              >
                <Ionicons name="remove" size={20} color={colors.text} />
              </TouchableOpacity>

              <TextInput
                style={styles.stepperInput}
                value={String(quantity)}
                onChangeText={handleQuantityInput}
                keyboardType="number-pad"
                textAlign="center"
                selectTextOnFocus
              />

              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => adjustQuantity(1)}
                activeOpacity={0.7}
              >
                <Ionicons name="add" size={20} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.stepperBtn}
                onPress={() => adjustQuantity(10)}
                activeOpacity={0.7}
              >
                <Text style={styles.stepperBtnText}>+10</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.quickQtyRow}>
              {[50, 100, 200, 500].map((q) => (
                <TouchableOpacity
                  key={q}
                  style={styles.quickQtyBtn}
                  onPress={() => setQuantity(q)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.quickQtyText}>{q}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Notes */}
          <View style={styles.field}>
            <Text style={styles.label}>
              Notes <Text style={styles.optional}>(optional)</Text>
            </Text>
            <TextInput
              style={styles.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder="Any additional details…"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
            />
          </View>

          {/* Feedback */}
          {feedbackMsg && (
            <View style={[
              styles.feedbackBanner,
              feedbackMsg.type === 'success' ? styles.feedbackSuccess : styles.feedbackError,
            ]}>
              <Ionicons
                name={feedbackMsg.type === 'success' ? 'checkmark-circle' : 'alert-circle'}
                size={16}
                color={feedbackMsg.type === 'success' ? '#16A34A' : colors.error}
              />
              <Text style={[
                styles.feedbackText,
                feedbackMsg.type === 'success' ? styles.feedbackTextSuccess : styles.feedbackTextError,
              ]}>
                {feedbackMsg.text}
              </Text>
            </View>
          )}

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.textOnPrimary} />
            ) : (
              <Ionicons name="save-outline" size={20} color={colors.textOnPrimary} />
            )}
            <Text style={styles.submitBtnText}>
              {submitting ? 'Saving…' : 'Record Harvest Count'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Today's entries */}
        <View style={styles.recentSection}>
          <View style={styles.recentHeader}>
            <Text style={styles.recentTitle}>Today's Entries</Text>
            {totalToday > 0 && (
              <View style={styles.totalBadge}>
                <Text style={styles.totalBadgeText}>{totalToday.toLocaleString()} stems total</Text>
              </View>
            )}
          </View>

          {loadingRecent ? (
            <ActivityIndicator size="small" color={colors.textMuted} style={{ marginVertical: spacing.lg }} />
          ) : recentEntries.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="analytics-outline" size={32} color={colors.textMuted} />
              <Text style={styles.emptyText}>No entries yet today</Text>
              <Text style={styles.emptySubtext}>Use the form above to record actual harvest counts</Text>
            </View>
          ) : (
            recentEntries.map((entry, i) => (
              <View key={i} style={styles.entryRow}>
                <View style={styles.entryLeft}>
                  <Text style={styles.entryGH} numberOfLines={1}>{entry.greenhouse}</Text>
                  <Text style={styles.entryVariety} numberOfLines={1}>{entry.variety}</Text>
                </View>
                <View style={styles.entryRight}>
                  <Text style={styles.entryQty}>{entry.quantity.toLocaleString()}</Text>
                  <Text style={styles.entryUnit}>stems</Text>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },

  dateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },

  formCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadow.md,
  },
  cardTitle: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.text,
    marginBottom: spacing.lg,
  },

  field: { marginBottom: spacing.lg },
  label: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  required: { color: colors.error },
  optional: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },

  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  loadingText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },

  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepperBtn: {
    width: 48,
    height: 56,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  stepperInput: {
    flex: 1,
    height: 56,
    borderRadius: borderRadius.md,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xl,
    color: colors.text,
    textAlign: 'center',
  },

  quickQtyRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  quickQtyBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  quickQtyText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },

  notesInput: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.text,
    minHeight: 60,
  },

  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
  },
  feedbackSuccess: { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' },
  feedbackError: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  feedbackText: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
  },
  feedbackTextSuccess: { color: '#16A34A' },
  feedbackTextError: { color: colors.error },

  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.textOnPrimary,
  },

  recentSection: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  recentTitle: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: colors.text,
  },
  totalBadge: {
    backgroundColor: '#DCFCE7',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  totalBadgeText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: '#16A34A',
  },

  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.md,
    color: colors.textMuted,
  },
  emptySubtext: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 260,
  },

  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  entryLeft: { flex: 1 },
  entryGH: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  entryVariety: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  entryRight: { alignItems: 'flex-end' },
  entryQty: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.text,
  },
  entryUnit: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
});
