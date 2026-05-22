import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  AppState,
  AppStateStatus,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

export default function UpdatePrompt() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    // expo-updates only works in standalone builds, not Expo Go dev client
    if (__DEV__) return;

    // Check on mount
    checkForUpdate();

    // Re-check each time the app comes back to the foreground
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appState.current !== 'active' && nextState === 'active') {
        checkForUpdate();
      }
      appState.current = nextState;
    });

    return () => subscription.remove();
  }, []);

  async function checkForUpdate() {
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        setUpdateAvailable(true);
      }
    } catch {
      // Silently ignore — update check failing shouldn't break the app
    }
  }

  async function applyUpdate() {
    setDownloading(true);
    setError(null);
    try {
      await Updates.fetchUpdateAsync();

      // reloadAsync() restarts the app — it should never return.
      // If we're still alive after 10 s, something silently failed.
      const stuckTimer = setTimeout(() => {
        setDownloading(false);
        setError('Update downloaded. Close and reopen the app to finish installing.');
      }, 10_000);

      try {
        await Updates.reloadAsync();
        // Should not reach here under normal circumstances
        clearTimeout(stuckTimer);
      } catch {
        clearTimeout(stuckTimer);
        setDownloading(false);
        setError('Update downloaded. Close and reopen the app to finish installing.');
      }
    } catch {
      setError('Failed to download update. Try again later.');
      setDownloading(false);
    }
  }

  if (!updateAvailable) return null;

  return (
    <Modal transparent animationType="fade" visible={updateAvailable}>
      <View style={styles.overlay}>
        <View style={[styles.card, { paddingBottom: spacing.xl + insets.bottom }]}>
          <View style={styles.iconRow}>
            <View style={styles.iconBadge}>
              <Ionicons name="arrow-down-circle" size={32} color={colors.text} />
            </View>
          </View>

          <Text style={styles.title}>Update Available</Text>
          <Text style={styles.body}>
            A new version of Upande Harvest is ready. Install it now to get the latest fixes and improvements.
          </Text>

          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}

          <TouchableOpacity
            style={[styles.updateButton, downloading && styles.updateButtonDisabled]}
            onPress={applyUpdate}
            activeOpacity={0.8}
            disabled={downloading}
          >
            {downloading ? (
              <>
                <ActivityIndicator size="small" color={colors.textOnPrimary} />
                <Text style={styles.updateButtonText}>Installing…</Text>
              </>
            ) : (
              <>
                <Ionicons name="refresh-outline" size={16} color={colors.textOnPrimary} />
                <Text style={styles.updateButtonText}>Install Now</Text>
              </>
            )}
          </TouchableOpacity>

          {!downloading ? (
            <TouchableOpacity
              style={styles.laterButton}
              onPress={() => setUpdateAvailable(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.laterText}>Later</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  iconRow: {
    marginBottom: spacing.lg,
  },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xl,
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  body: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.xl,
  },
  errorText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  updateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.text,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    width: '100%',
    marginBottom: spacing.sm,
  },
  updateButtonDisabled: {
    opacity: 0.7,
  },
  updateButtonText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.textOnPrimary,
  },
  laterButton: {
    paddingVertical: spacing.sm,
  },
  laterText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
});
