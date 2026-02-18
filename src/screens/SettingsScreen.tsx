import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getSetting, setSetting } from '../database/settings';
import { getPendingCount, getFailedCount, retryFailed, clearSynced, getAllEntries } from '../database/sync-queue';
import { resetDatabase } from '../database/database';
import { useApp } from '../context/AppContext';
import SyncBanner from '../components/SyncBanner';
import { SyncQueueEntry } from '../types';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

function Row({ icon, label, value, onPress, color }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  color?: string;
}) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={onPress ? 0.5 : 1}
      disabled={!onPress}
    >
      <Ionicons name={icon} size={20} color={color || colors.text} />
      <Text style={[styles.rowLabel, color ? { color } : null]}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const { triggerSync, refreshStats, logout, fullName, userEmail } = useApp();
  const [farm, setFarm] = useState('');
  const [editingFarm, setEditingFarm] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [queueEntries, setQueueEntries] = useState<SyncQueueEntry[]>([]);
  const [showQueue, setShowQueue] = useState(false);

  useEffect(() => {
    (async () => {
      const f = await getSetting('farm');
      if (f) setFarm(f);
      setPendingCount(await getPendingCount());
      setFailedCount(await getFailedCount());
    })();
  }, []);

  const handleFarmBlur = async () => {
    setEditingFarm(false);
    await setSetting('farm', farm.trim());
  };

  const handleRetryFailed = async () => {
    await retryFailed();
    await triggerSync();
    setPendingCount(await getPendingCount());
    setFailedCount(await getFailedCount());
  };

  const handleClearSynced = async () => {
    await clearSynced();
    await refreshStats();
    setPendingCount(await getPendingCount());
    setFailedCount(await getFailedCount());
  };

  const handleResetData = () => {
    Alert.alert(
      'Reset All Data',
      'This will delete all local shelves, items, and sync queue entries. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await resetDatabase();
            await refreshStats();
            setPendingCount(0);
            setFailedCount(0);
            Alert.alert('Done', 'All local data has been cleared.');
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'You will need to sign in again to use the app.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: () => logout() },
      ]
    );
  };

  const handleShowQueue = async () => {
    if (!showQueue) {
      const entries = await getAllEntries();
      setQueueEntries(entries);
    }
    setShowQueue(!showQueue);
  };

  const initials = fullName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <View style={styles.container}>
      <SyncBanner />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Profile */}
        <TouchableOpacity style={styles.profile} activeOpacity={0.6}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials || '?'}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{fullName || 'User'}</Text>
            <Text style={styles.profileEmail}>{userEmail}</Text>
          </View>
        </TouchableOpacity>

        <View style={styles.dividerFull} />

        {/* General */}
        <Text style={styles.sectionHeader}>General</Text>
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => setEditingFarm(true)}
            activeOpacity={0.5}
          >
            <Ionicons name="leaf-outline" size={20} color={colors.text} />
            {editingFarm ? (
              <TextInput
                style={styles.inlineInput}
                value={farm}
                onChangeText={setFarm}
                onBlur={handleFarmBlur}
                placeholder="Enter farm name"
                placeholderTextColor={colors.textMuted}
                autoFocus
              />
            ) : (
              <>
                <Text style={styles.rowLabel}>Farm</Text>
                <Text style={styles.rowValue}>{farm || 'Not set'}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Sync */}
        <Text style={styles.sectionHeader}>Sync</Text>
        <View style={styles.section}>
          <Row icon="time-outline" label="Pending" value={String(pendingCount)} />
          <View style={styles.divider} />
          <Row icon="alert-circle-outline" label="Failed" value={String(failedCount)} />
          <View style={styles.divider} />
          <Row icon="refresh-outline" label="Retry failed" onPress={handleRetryFailed} />
          <View style={styles.divider} />
          <Row icon="checkmark-done-outline" label="Clear synced" onPress={handleClearSynced} />
          <View style={styles.divider} />
          <Row
            icon="list-outline"
            label={showQueue ? 'Hide queue' : 'View queue'}
            onPress={handleShowQueue}
          />
        </View>

        {/* Queue */}
        {showQueue && (
          <View style={styles.queueSection}>
            {queueEntries.length === 0 ? (
              <Text style={styles.queueEmpty}>Queue is empty</Text>
            ) : (
              queueEntries.map((entry, idx) => (
                <View key={entry.id}>
                  {idx > 0 && <View style={styles.divider} />}
                  <View style={styles.queueRow}>
                    <View style={styles.queueMain}>
                      <Text style={styles.queueAction}>{entry.action}</Text>
                      <Text style={styles.queueTime}>
                        {new Date(entry.created_at).toLocaleString()}
                      </Text>
                      {entry.error_message ? (
                        <Text style={styles.queueError}>{entry.error_message}</Text>
                      ) : null}
                    </View>
                    <View
                      style={[
                        styles.queueBadge,
                        {
                          backgroundColor:
                            entry.status === 'synced'
                              ? colors.success
                              : entry.status === 'failed'
                                ? colors.error
                                : colors.warning,
                        },
                      ]}
                    >
                      <Text style={styles.queueBadgeText}>{entry.status}</Text>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* Account */}
        <Text style={styles.sectionHeader}>Account</Text>
        <View style={styles.section}>
          <Row icon="trash-outline" label="Reset all data" onPress={handleResetData} color={colors.error} />
          <View style={styles.divider} />
          <Row icon="log-out-outline" label="Sign out" onPress={handleLogout} color={colors.error} />
        </View>

        <Text style={styles.versionText}>Upande Harvest v1.0</Text>
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
    paddingBottom: spacing.xxl,
  },

  // Profile
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    backgroundColor: colors.surface,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.text,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.textOnPrimary,
  },
  profileInfo: {
    marginLeft: spacing.md,
    flex: 1,
  },
  profileName: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
  },
  profileEmail: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 1,
  },

  // Sections
  sectionHeader: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  section: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },

  // Rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  rowLabel: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  rowValue: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  inlineInput: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.text,
    padding: 0,
  },

  // Dividers
  dividerFull: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: 52,
  },

  // Queue
  queueSection: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginTop: spacing.sm,
  },
  queueEmpty: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  queueMain: {
    flex: 1,
  },
  queueAction: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.text,
  },
  queueTime: {
    fontFamily: fontFamily.regular,
    fontSize: 10,
    color: colors.textMuted,
  },
  queueError: {
    fontFamily: fontFamily.regular,
    fontSize: 10,
    color: colors.error,
    marginTop: 1,
  },
  queueBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    marginLeft: spacing.sm,
  },
  queueBadgeText: {
    fontFamily: fontFamily.medium,
    color: '#fff',
    fontSize: 10,
  },

  // Footer
  versionText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});
