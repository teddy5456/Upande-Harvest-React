import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { colors, fontFamily, fontSize, spacing } from '../theme';

export default function SyncBanner() {
  const { isConnected, isSyncing, pendingSync, failedSync, logs, retryConnection } = useApp();
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    await retryConnection();
    setIsRetrying(false);
  };
  const [isOpen, setIsOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const prevFailedSync = useRef(failedSync);

  // Auto-open (showing only latest log) when a new failure occurs
  useEffect(() => {
    if (failedSync > prevFailedSync.current) {
      setIsOpen(true);
      setShowAll(false);
    }
    prevFailedSync.current = failedSync;
  }, [failedSync]);

  // Close expanded state when there's nothing to show
  const hasStatus = !isConnected || isSyncing || pendingSync > 0 || failedSync > 0;
  if (!hasStatus && logs.length === 0) return null;

  // Status bar content
  let icon: keyof typeof Ionicons.glyphMap = 'information-circle-outline';
  let label = '';
  let textColor = colors.textMuted;

  if (!isConnected) {
    icon = isRetrying ? 'sync-outline' : 'cloud-offline-outline';
    label = isRetrying ? 'Checking…' : `Offline${pendingSync > 0 ? ` · ${pendingSync} queued` : ''}`;
    textColor = colors.warning;
  } else if (isSyncing) {
    icon = 'sync-outline';
    label = 'Syncing...';
    textColor = colors.primary;
  } else if (failedSync > 0) {
    icon = 'alert-circle-outline';
    label = `${failedSync} failed`;
    textColor = colors.error;
  } else if (pendingSync > 0) {
    icon = 'time-outline';
    label = `${pendingSync} pending`;
    textColor = colors.warning;
  } else {
    icon = 'checkmark-circle-outline';
    label = 'Logs';
    textColor = colors.textMuted;
  }

  const displayedLogs = showAll ? logs : logs.slice(0, 1);

  return (
    <View style={styles.wrapper}>
      {/* Tap to toggle */}
      <TouchableOpacity
        style={styles.bar}
        onPress={() => {
          const opening = !isOpen;
          setIsOpen(opening);
          if (!opening) setShowAll(false);
        }}
        activeOpacity={0.7}
      >
        {isSyncing ? (
          <ActivityIndicator size={12} color={textColor} />
        ) : (
          <Ionicons name={icon} size={12} color={textColor} />
        )}
        <Text style={[styles.barLabel, { color: textColor }]}>{label}</Text>
        {logs.length > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{logs.length}</Text>
          </View>
        )}
        {!isConnected && (
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation?.(); handleRetry(); }}
            disabled={isRetrying}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.retryBtn}
          >
            {isRetrying
              ? <ActivityIndicator size={11} color={colors.warning} />
              : <Text style={styles.retryText}>Retry</Text>
            }
          </TouchableOpacity>
        )}
        <Ionicons
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={11}
          color={colors.textMuted}
        />
      </TouchableOpacity>

      {/* Collapsible log panel */}
      {isOpen && (
        <View style={styles.panel}>
          {logs.length === 0 ? (
            <Text style={styles.emptyText}>No logs yet</Text>
          ) : (
            displayedLogs.map((log) => (
              <View key={log.id} style={styles.logRow}>
                <Ionicons
                  name={
                    log.type === 'error' ? 'alert-circle' :
                    log.type === 'success' ? 'checkmark-circle' :
                    log.type === 'warning' ? 'warning' :
                    'information-circle'
                  }
                  size={13}
                  color={
                    log.type === 'error' ? colors.error :
                    log.type === 'success' ? colors.success :
                    log.type === 'warning' ? colors.warning :
                    colors.textMuted
                  }
                />
                <Text style={styles.logMessage} numberOfLines={2}>{log.message}</Text>
                <Text style={styles.logTime}>{log.time}</Text>
              </View>
            ))
          )}

          {/* Show all / show less toggle */}
          {logs.length > 1 && (
            <TouchableOpacity
              style={styles.showAllRow}
              onPress={() => setShowAll(!showAll)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={showAll ? 'chevron-up' : 'chevron-down'}
                size={11}
                color={colors.primary}
              />
              <Text style={styles.showAllText}>
                {showAll ? 'Show less' : `Show all (${logs.length})`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.surfaceAlt,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  barLabel: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    flex: 1,
    textAlign: 'center',
  },
  badge: {
    backgroundColor: colors.textMuted,
    borderRadius: 9999,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontFamily: fontFamily.medium,
    fontSize: 9,
    color: colors.surface,
  },

  retryBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  retryText: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    color: colors.warning,
  },

  // Log panel
  panel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  emptyText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  logMessage: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.text,
  },
  logTime: {
    fontFamily: fontFamily.regular,
    fontSize: 10,
    color: colors.textMuted,
  },

  // Show all row
  showAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  showAllText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.primary,
  },
});
