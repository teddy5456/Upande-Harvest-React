import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Dimensions,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';
import { useApp } from '../context/AppContext';

const { width: SW } = Dimensions.get('window');

interface TutorialStep {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  title: string;
  screen: string;
  steps: string[];
  tip?: string;
}

const TUTORIAL: TutorialStep[] = [
  {
    id: 'harvest',
    icon: 'leaf',
    iconColor: '#22C55E',
    iconBg: '#F0FDF4',
    title: 'Harvest',
    screen: 'Harvest tab',
    steps: [
      'Select the greenhouse from the dropdown.',
      'Choose the section and variety.',
      'Select or type the harvester name.',
      'Enter the stem quantity.',
      'Scan the bucket QR code to submit.',
    ],
    tip: 'You can borrow harvesters from other greenhouses using Manage Team.',
  },
  {
    id: 'receiving',
    icon: 'download',
    iconColor: '#F59E0B',
    iconBg: '#FFFBEB',
    title: 'Receiving',
    screen: 'Receive tab',
    steps: [
      'As buckets arrive at the packhouse, scan each bucket QR code.',
      'A green tick confirms the bucket was received.',
      'Errors appear inline — tap "Show all" to see the full log.',
    ],
    tip: 'If shelving a bucket fails, the app will offer to take you straight to Receiving.',
  },
  {
    id: 'shelve',
    icon: 'scan',
    iconColor: '#6366F1',
    iconBg: '#EEF2FF',
    title: 'Shelve',
    screen: 'Shelve tab',
    steps: [
      'Scan a shelf QR code (e.g. A1T — Side A, Position 1, Top).',
      'Once the shelf is confirmed, scan buckets one by one.',
      'Tap "Next Shelf" to move to a different shelf.',
    ],
    tip: 'Shelf codes follow the format: Side (A/B) + Position (1–99) + Level (T/M/B).',
  },
  {
    id: 'grade',
    icon: 'clipboard',
    iconColor: '#EC4899',
    iconBg: '#FDF2F8',
    title: 'Grade',
    screen: 'Grade tab',
    steps: [
      'Scan a bunch, grader, or bucket QR — in any order.',
      'The app detects which code was scanned automatically.',
      'Tap a slot pill to force the next scan into that slot.',
      'Once all three slots are filled, the entry is submitted.',
    ],
    tip: 'Tap the ✕ on a pill to clear a slot and re-scan it.',
  },
  {
    id: 'packing',
    icon: 'cube',
    iconColor: '#14B8A6',
    iconBg: '#F0FDFA',
    title: 'Packing',
    screen: 'Sidebar → Packing',
    steps: [
      'Scan the box label to open a new box.',
      'Scan bunches to add them to the box.',
      'Review the list and remove any mistakes.',
      'Tap "Close Box" to finalise and submit.',
    ],
    tip: 'Each bunch can only appear in a box once — duplicates are flagged.',
  },
  {
    id: 'quality',
    icon: 'shield-checkmark',
    iconColor: '#EF4444',
    iconBg: '#FEF2F2',
    title: 'Quality',
    screen: 'Sidebar → Quality',
    steps: [
      'Choose a section: Field Rejects, Receiving Rejects, or Packhouse Discards.',
      'Scan the bunch or bucket being rejected.',
      'Set the quantity using the +/− buttons.',
      'Select a reason from the chips.',
      'Add optional notes, then tap "Record Entry".',
    ],
  },
];

interface TutorialModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function TutorialModal({ visible, onClose }: TutorialModalProps) {
  const { isXflora } = useApp();
  const [page, setPage] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const insets = useSafeAreaInsets();

  const steps = TUTORIAL.filter(s => !(isXflora && s.id === 'harvest'));
  const step = steps[page];
  const isLast = page === steps.length - 1;

  function goTo(index: number) {
    Animated.timing(fadeAnim, { toValue: 0, duration: 100, useNativeDriver: true }).start(() => {
      setPage(index);
      scrollRef.current?.scrollTo({ x: index * SW, animated: false });
      Animated.timing(fadeAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    });
  }

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: spacing.xl + insets.bottom }]}>

          {/* Header */}
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>How to use Upande Harvest</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Tab row */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabsContent}>
            {steps.map((t, i) => (
              <TouchableOpacity
                key={t.id}
                style={[styles.tabChip, i === page && styles.tabChipActive]}
                onPress={() => goTo(i)}
                activeOpacity={0.7}
              >
                <Ionicons name={t.icon} size={13} color={i === page ? colors.textOnPrimary : colors.textMuted} />
                <Text style={[styles.tabChipText, i === page && styles.tabChipTextActive]}>{t.title}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Content */}
          <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
            {/* Icon + screen */}
            <View style={styles.iconRow}>
              <View style={[styles.iconCircle, { backgroundColor: step.iconBg }]}>
                <Ionicons name={step.icon} size={28} color={step.iconColor} />
              </View>
              <View>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepScreen}>{step.screen}</Text>
              </View>
            </View>

            {/* Steps */}
            <View style={styles.stepsList}>
              {step.steps.map((s, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={styles.stepNum}>
                    <Text style={styles.stepNumText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{s}</Text>
                </View>
              ))}
            </View>

            {/* Tip */}
            {step.tip && (
              <View style={styles.tipBox}>
                <Ionicons name="bulb-outline" size={15} color={colors.warning} />
                <Text style={styles.tipText}>{step.tip}</Text>
              </View>
            )}
          </Animated.View>

          {/* Navigation */}
          <View style={styles.nav}>
            <TouchableOpacity
              style={[styles.navBtn, page === 0 && styles.navBtnDisabled]}
              onPress={() => page > 0 && goTo(page - 1)}
              disabled={page === 0}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={18} color={page === 0 ? colors.textMuted : colors.text} />
              <Text style={[styles.navBtnText, page === 0 && styles.navBtnTextDisabled]}>Back</Text>
            </TouchableOpacity>

            {/* Dots */}
            <View style={styles.dots}>
              {steps.map((_, i) => (
                <TouchableOpacity key={i} onPress={() => goTo(i)} activeOpacity={0.7}>
                  <View style={[styles.dot, i === page && styles.dotActive]} />
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={styles.navBtn}
              onPress={isLast ? onClose : () => goTo(page + 1)}
              activeOpacity={0.7}
            >
              <Text style={styles.navBtnText}>{isLast ? 'Done' : 'Next'}</Text>
              {!isLast && <Ionicons name="chevron-forward" size={18} color={colors.text} />}
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: spacing.lg,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  sheetTitle: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: colors.text,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabsScroll: { maxHeight: 44 },
  tabsContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    alignItems: 'center',
  },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabChipText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  tabChipTextActive: { color: colors.textOnPrimary },

  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepTitle: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.text,
  },
  stepScreen: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
  },

  stepsList: { gap: spacing.md, marginBottom: spacing.lg },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  stepNumText: { fontFamily: fontFamily.bold, fontSize: 10, color: colors.textOnPrimary },
  stepText: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.text, flex: 1, lineHeight: 20 },

  tipBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: '#FFFBEB',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  tipText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.text,
    flex: 1,
    lineHeight: 18,
  },

  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: spacing.md,
  },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minWidth: 70,
  },
  navBtnDisabled: { opacity: 0.3 },
  navBtnText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text },
  navBtnTextDisabled: { color: colors.textMuted },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { width: 18, backgroundColor: colors.primary },
});
