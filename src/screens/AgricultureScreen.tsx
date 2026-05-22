import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors, fontFamily, fontSize, spacing, borderRadius, shadow } from '../theme';

interface AgricultureModule {
  key: string;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  enabled: boolean;
}

interface AgricultureCard extends AgricultureModule {
  navigateTo?: { parent?: boolean; route: string };
}

const MODULES: AgricultureCard[] = [
  {
    key: 'ProductionPlan',
    label: 'Production Plan',
    description: 'Set weekly targets per greenhouse',
    icon: 'calendar-outline',
    enabled: true,
    navigateTo: { route: 'ProductionPlan' },
  },
  {
    key: 'ProductionTracking',
    label: 'Production Tracking',
    description: 'Today’s actual stems vs plan',
    icon: 'analytics-outline',
    enabled: true,
    navigateTo: { parent: true, route: 'ActualHarvest' },
  },
  {
    key: 'Tasks',
    label: 'Tasks',
    description: 'My week + everyone’s assignments',
    icon: 'checkmark-done-outline',
    enabled: true,
    navigateTo: { route: 'Tasks' },
  },
  {
    key: 'BedSampling',
    label: 'Bed Sampling',
    description: 'Walk a bed and count stems per stage',
    icon: 'pulse-outline',
    enabled: true,
    navigateTo: { route: 'BedSampling' },
  },
  {
    key: 'UprootReplant',
    label: 'Uproot / Replant',
    description: 'Log bed lifecycle events',
    icon: 'sync-outline',
    enabled: true,
    navigateTo: { route: 'UprootReplant' },
  },
  {
    key: 'Seedlings',
    label: 'Seedlings',
    description: 'Request and dispatch seedlings',
    icon: 'leaf-outline',
    enabled: true,
    navigateTo: { route: 'Seedlings' },
  },
  {
    key: 'CropCycleView',
    label: 'Crop Cycles',
    description: 'Active cycles per greenhouse',
    icon: 'git-branch-outline',
    enabled: true,
    navigateTo: { route: 'CropCycleView' },
  },
  {
    key: 'Scouting',
    label: 'Scouting Inbox',
    description: 'Coming soon',
    icon: 'eye-outline',
    enabled: false,
  },
];

export default function AgricultureScreen() {
  const navigation = useNavigation<any>();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Agriculture</Text>
      <Text style={styles.subheading}>
        Production, planning and crop operations
      </Text>

      <View style={styles.grid}>
        {MODULES.map((m) => (
          <TouchableOpacity
            key={m.key}
            style={[styles.card, !m.enabled && styles.cardDisabled]}
            activeOpacity={m.enabled ? 0.7 : 1}
            onPress={() => {
              if (!m.enabled || !m.navigateTo) return;
              if (m.navigateTo.parent) {
                navigation.getParent()?.navigate(m.navigateTo.route);
              } else {
                navigation.navigate(m.navigateTo.route);
              }
            }}
          >
            <View style={styles.iconWrap}>
              <Ionicons
                name={m.icon}
                size={22}
                color={m.enabled ? colors.text : colors.textMuted}
              />
            </View>
            <Text
              style={[
                styles.cardLabel,
                !m.enabled && { color: colors.textMuted },
              ]}
            >
              {m.label}
            </Text>
            <Text style={styles.cardDesc}>{m.description}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  heading: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xxl,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subheading: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  card: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.sm,
  },
  cardDisabled: {
    opacity: 0.55,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  cardLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  cardDesc: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
});
