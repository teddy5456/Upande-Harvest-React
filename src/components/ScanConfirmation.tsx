import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  colors,
  fontFamily,
  fontSize,
  spacing,
  borderRadius,
} from '../theme';

interface ScanConfirmationProps {
  visible: boolean;
  /** success = green tick · error = red alert · queued = amber cloud (saved offline) */
  type: 'success' | 'error' | 'queued';
  /** Short summary line — appears as the card body */
  message?: string;
  /** Optional title; when omitted a sensible default is chosen per type */
  title?: string;
  onDismiss: () => void;
}

// Errors stick long enough to actually read the offending message + allowed list.
// Success/queued stay snappy so they don't break the scan rhythm.
const DURATION_MS: Record<ScanConfirmationProps['type'], number> = {
  success: 1200,
  queued: 1400,
  error: 6500,
};

const ICON_MAP = {
  success: {
    name: 'checkmark-circle' as const,
    color: colors.success,
    accent: 'rgba(34, 197, 94, 0.10)',
    border: 'rgba(34, 197, 94, 0.25)',
    defaultTitle: 'Scanned',
  },
  error: {
    name: 'alert-circle' as const,
    color: colors.error,
    accent: 'rgba(239, 68, 68, 0.10)',
    border: 'rgba(239, 68, 68, 0.30)',
    // Generic across every flow that uses this modal (Harvest, Receive,
    // Shelve, Grade, Pack…). Screens can override via the `title` prop.
    defaultTitle: 'Scan rejected',
  },
  queued: {
    name: 'cloud-upload-outline' as const,
    color: colors.warning,
    accent: 'rgba(245, 158, 11, 0.10)',
    border: 'rgba(245, 158, 11, 0.25)',
    defaultTitle: 'Queued',
  },
};

export default function ScanConfirmation({
  visible,
  type,
  message,
  title,
  onDismiss,
}: ScanConfirmationProps) {
  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissedRef = useRef(false);

  const close = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    Animated.timing(opacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      scale.setValue(0.85);
      onDismiss();
    });
  };

  useEffect(() => {
    if (!visible) return;
    dismissedRef.current = false;
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        tension: 90,
        friction: 9,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(close, DURATION_MS[type]);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, type]);

  if (!visible) return null;

  const meta = ICON_MAP[type];
  const heading = title || meta.defaultTitle;
  const isError = type === 'error';

  // Errors get a fuller treatment: structured card, dim backdrop, tap-to-dismiss.
  // Success/queued stay as the airy, glanceable overlay they were before.
  if (isError) {
    return (
      <View style={styles.overlayDim} pointerEvents="box-none">
        <TouchableWithoutFeedback onPress={close}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
        <Animated.View
          style={[
            styles.errorCard,
            { transform: [{ scale }], opacity },
          ]}
          pointerEvents="box-none"
        >
          <View
            style={[
              styles.errorIconWrap,
              { backgroundColor: meta.accent, borderColor: meta.border },
            ]}
          >
            <Ionicons name={meta.name} size={44} color={meta.color} />
          </View>
          <Text style={styles.errorTitle}>{heading}</Text>
          {message ? (
            <Text style={styles.errorBody}>{message}</Text>
          ) : null}
          <View style={styles.errorHintRow}>
            <Ionicons
              name="hand-left-outline"
              size={12}
              color={colors.textMuted}
            />
            <Text style={styles.errorHint}>Tap anywhere to dismiss</Text>
          </View>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={styles.overlayLight} pointerEvents="none">
      <Animated.View
        style={[
          styles.successCard,
          {
            transform: [{ scale }],
            opacity,
            backgroundColor: meta.accent,
            borderColor: meta.border,
          },
        ]}
      >
        <Ionicons name={meta.name} size={48} color={meta.color} />
        {(title || message) ? (
          <View style={styles.successText}>
            {title ? <Text style={styles.successTitle}>{title}</Text> : null}
            {message ? (
              <Text style={styles.successMessage}>{message}</Text>
            ) : null}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayLight: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  overlayDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 15, 17, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
    paddingHorizontal: spacing.xl,
  },

  // ── Success / queued (glanceable) ──────────────────────────────────────
  successCard: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    maxWidth: 320,
  },
  successText: { alignItems: 'center', gap: 2 },
  successTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
  },
  successMessage: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  // ── Error (sticks, tap-to-dismiss) ─────────────────────────────────────
  errorCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 8,
  },
  errorIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  errorTitle: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xl,
    color: colors.text,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  errorBody: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: spacing.sm,
  },
  errorHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  errorHint: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
