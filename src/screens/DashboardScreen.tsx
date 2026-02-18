import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import { getTodayGradingCount } from '../database/grading';
import { getTodayHarvestCount } from '../database/harvest';
import { getTodayReceivingCount } from '../database/receiving';
import SyncBanner from '../components/SyncBanner';
import { colors, fontFamily, fontSize, spacing, borderRadius, shadow } from '../theme';

export default function DashboardScreen() {
  const { stats, refreshStats, fullName } = useApp();
  const navigation = useNavigation<any>();
  const [harvestToday, setHarvestToday] = useState(0);
  const [receivingToday, setReceivingToday] = useState(0);
  const [gradingToday, setGradingToday] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const firstName = fullName.split(' ')[0] || 'there';

  const loadData = useCallback(async () => {
    await refreshStats();
    const [hc, rc, gc] = await Promise.all([
      getTodayHarvestCount(),
      getTodayReceivingCount(),
      getTodayGradingCount(),
    ]);
    setHarvestToday(hc);
    setReceivingToday(rc);
    setGradingToday(gc);
  }, [refreshStats]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <SyncBanner />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.text} />}
      >
        <Text style={styles.greeting}>Hi, {firstName}</Text>

        {/* Quick Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionCard}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('Harvest')}
          >
            <Ionicons name="leaf-outline" size={22} color={colors.text} />
            <Text style={styles.actionLabel}>Harvest</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionCard}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('Receive')}
          >
            <Ionicons name="download-outline" size={22} color={colors.text} />
            <Text style={styles.actionLabel}>Receive</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionCard}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('Shelve')}
          >
            <Ionicons name="scan-outline" size={22} color={colors.text} />
            <Text style={styles.actionLabel}>Shelve</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionCard}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('Grade')}
          >
            <Ionicons name="clipboard-outline" size={22} color={colors.text} />
            <Text style={styles.actionLabel}>Grade</Text>
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{harvestToday}</Text>
            <Text style={styles.statLabel}>Harvested</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{receivingToday}</Text>
            <Text style={styles.statLabel}>Received</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.total_buckets}</Text>
            <Text style={styles.statLabel}>Shelved</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{gradingToday}</Text>
            <Text style={styles.statLabel}>Graded</Text>
          </View>
        </View>

        {/* Sync status */}
        {stats.pending_sync > 0 && (
          <View style={styles.syncRow}>
            <Ionicons name="cloud-upload-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.syncText}>{stats.pending_sync} pending sync</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  greeting: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xl,
    color: colors.text,
    marginBottom: spacing.xl,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  actionCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  statCard: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xxl,
    color: colors.text,
  },
  statLabel: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  syncText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
});
