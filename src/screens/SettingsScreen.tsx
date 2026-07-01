import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getSetting, setSetting } from '../database/settings';
import { getPendingCount, getFailedCount, retryFailed, clearSynced, getAllEntries } from '../database/sync-queue';
import { resetDatabase } from '../database/database';
import { useApp } from '../context/AppContext';
import Dropdown, { DropdownOption } from '../components/Dropdown';
import { getCachedFarms } from '../utils/farm-cache';
import { SyncQueueEntry } from '../types';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';
import { version } from '../../package.json';
import {
  hasEnrolledCredentials,
  clearEnrolledCredentials,
  enrollCredentials,
  biometricSupported,
  resetOfferedFlag,
} from '../services/auth';
import { getSid, getApiUrl } from '../database/settings';

/**
 * Parse a sync_queue.created_at value to the device's local clock.
 *
 * Two formats live in the DB:
 *   - New rows (from this build forward): full ISO with 'Z' (e.g. '2026-05-29T11:30:00.000Z')
 *     — JS parses cleanly as UTC and toLocaleString() localizes.
 *   - Old rows (from SQLite's `datetime('now')` default): naked UTC text
 *     without a zone marker (e.g. '2026-05-29 11:30:00') — JS would mis-parse
 *     this as LOCAL time, producing a 3-hour drift in EAT. Append 'Z' to
 *     force UTC interpretation.
 */
function formatQueueTime(createdAt: string | null | undefined): string {
  if (!createdAt) return '—';
  let iso = String(createdAt);
  // Detect "no zone marker": 'YYYY-MM-DD HH:MM:SS' style → convert to ISO + Z
  if (!iso.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(iso)) {
    iso = iso.replace(' ', 'T') + 'Z';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) return createdAt;
  return d.toLocaleString();
}

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
  const { triggerSync, refreshStats, logout, fullName, userEmail, isSyncing } = useApp();
  const [farm, setFarm] = useState('');
  const [farmOptions, setFarmOptions] = useState<DropdownOption[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [queueEntries, setQueueEntries] = useState<SyncQueueEntry[]>([]);
  const [showQueue, setShowQueue] = useState(false);
  const [retryProgress, setRetryProgress] = useState<{ total: number; done: number } | null>(null);
  const [bioEnrolled, setBioEnrolled] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const screenshotRef = useRef<View>(null);

  useEffect(() => {
    let alive = true;
    hasEnrolledCredentials().then(v => { if (alive) setBioEnrolled(v); });
    return () => { alive = false; };
  }, []);

  const handleToggleFingerprint = async () => {
    if (bioEnrolled) {
      Alert.alert(
        'Turn off fingerprint sign-in?',
        'You\'ll need to type your email and password the next time you sign in.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Turn off',
            style: 'destructive',
            onPress: async () => {
              await clearEnrolledCredentials();
              await resetOfferedFlag();
              setBioEnrolled(false);
            },
          },
        ],
      );
      return;
    }

    // Turning ON — biometrically encrypt the current session's credentials.
    // We need the password fresh from the user (we never keep it in JS memory
    // outside the unlocked SecureStore blob), so ask them to confirm it.
    const bio = await biometricSupported();
    if (!bio.available) {
      Alert.alert('Not supported', 'This device doesn\'t support biometric or device-PIN authentication.');
      return;
    }
    Alert.prompt(
      'Confirm your password',
      'Re-enter your password to enable fingerprint sign-in. We need it to encrypt your credentials behind your fingerprint.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Enable',
          onPress: async (pwd?: string) => {
            if (!pwd) return;
            const serverUrl = await getApiUrl();
            if (!serverUrl || !userEmail) {
              Alert.alert('Not signed in', 'Please sign in first.');
              return;
            }
            const ok = await enrollCredentials({
              serverUrl,
              email: userEmail,
              password: pwd,
              enrolledAt: new Date().toISOString(),
            });
            if (ok) {
              setBioEnrolled(true);
              Alert.alert('Enabled', 'Fingerprint sign-in is now on.');
            } else {
              Alert.alert('Not enabled', 'Fingerprint enrolment was cancelled.');
            }
          },
        },
      ],
      'secure-text',
    );
  };

  const refreshSyncState = async () => {
    setPendingCount(await getPendingCount());
    setFailedCount(await getFailedCount());
    setQueueEntries(await getAllEntries());
  };

  useEffect(() => {
    (async () => {
      const f = await getSetting('farm');
      if (f) setFarm(f);
      await refreshSyncState();
      const farms = await getCachedFarms();
      if (farms.length > 0) {
        setFarmOptions(farms.map((f) => ({ label: f.farm_name || f.name, value: f.name })));
      }
    })();
  }, []);

  // Poll the queue while a retry / sync is in progress so the user sees
  // entries flip from pending → synced/failed in (near) real time.
  useEffect(() => {
    const active = retryProgress !== null || isSyncing;
    if (!active) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      refreshSyncState().catch(() => {});
    }, 500);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [retryProgress, isSyncing]);

  const handleFarmSelect = async (value: string) => {
    setFarm(value);
    await setSetting('farm', value);
  };

  const handleRetryFailed = async () => {
    if (retryProgress) return;
    const total = await getFailedCount();
    if (total === 0) {
      Alert.alert('Nothing to retry', 'No failed entries in the queue.');
      return;
    }
    setShowQueue(true);
    setRetryProgress({ total, done: 0 });

    await retryFailed();

    try {
      await triggerSync((done, _total) => {
        // syncPendingEntries reports against the actual pending pool, which
        // may include rows queued before retry was pressed. Cap to our snapshot
        // so the bar reflects the user's expectation ("retrying N").
        setRetryProgress((p) => (p ? { ...p, done: Math.min(done, p.total) } : p));
      });
    } finally {
      await refreshSyncState();
      setRetryProgress((p) => (p ? { ...p, done: p.total } : null));
      setTimeout(() => setRetryProgress(null), 700);
    }
  };

  const handleClearSynced = async () => {
    await clearSynced();
    await refreshStats();
    await refreshSyncState();
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
      await refreshSyncState();
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
    <View style={styles.container} ref={screenshotRef}>
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
          <View style={styles.row}>
            <Ionicons name="leaf-outline" size={20} color={colors.text} />
            <Text style={styles.rowLabel}>Farm</Text>
            <View style={{ flex: 1 }}>
              <Dropdown
                value={farm}
                options={farmOptions}
                placeholder={farmOptions.length === 0 ? 'No farms available' : 'Select farm'}
                onSelect={handleFarmSelect}
                disabled={farmOptions.length === 0}
              />
            </View>
          </View>
        </View>

        {/* Sync */}
        <Text style={styles.sectionHeader}>Sync</Text>
        <View style={styles.section}>
          <Row icon="time-outline" label="Pending" value={String(pendingCount)} />
          <View style={styles.divider} />
          <Row icon="alert-circle-outline" label="Failed" value={String(failedCount)} />
          <View style={styles.divider} />
          <Row
            icon="refresh-outline"
            label={retryProgress ? 'Retrying…' : 'Retry failed'}
            onPress={retryProgress ? undefined : handleRetryFailed}
          />
          {retryProgress && (
            <View style={styles.progressWrap}>
              <View style={styles.progressHeader}>
                <ActivityIndicator size="small" color={colors.text} />
                <Text style={styles.progressLabel}>
                  {retryProgress.done} of {retryProgress.total}
                </Text>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${retryProgress.total > 0
                        ? Math.round((retryProgress.done / retryProgress.total) * 100)
                        : 0}%`,
                    },
                  ]}
                />
              </View>
            </View>
          )}
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
                        {formatQueueTime(entry.created_at)}
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
          <Row
            icon="finger-print-outline"
            label="Fingerprint sign-in"
            value={bioEnrolled ? 'On' : 'Off'}
            onPress={handleToggleFingerprint}
          />
          <View style={styles.divider} />
          <Row icon="trash-outline" label="Reset all data" onPress={handleResetData} color={colors.error} />
          <View style={styles.divider} />
          <Row icon="log-out-outline" label="Sign out" onPress={handleLogout} color={colors.error} />
        </View>

        <Text style={styles.versionText}>Upande Harvest v{version}</Text>
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

  // Progress bar (retry)
  progressWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    paddingTop: 2,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  progressLabel: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.text,
    borderRadius: 2,
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

  // Support modal
  spOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  spCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    width: '100%',
    maxWidth: 360,
  },
  spHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  spTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
  },
  spLabel: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginBottom: 4,
    marginTop: spacing.xs,
  },
  spInput: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  spActions: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  spSkip: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  spSubmit: {
    flex: 2,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  spSubmitText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: '#fff' },
  spSkipText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.textMuted },
});

