import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily, fontSize, spacing } from '../theme';

interface ScanConfirmationProps {
  visible: boolean;
  /** success = green tick · error = red alert · queued = amber cloud (saved offline) */
  type: 'success' | 'error' | 'queued';
  message?: string;
  onDismiss: () => void;
}

const DISPLAY_MS = 1200;

const ICON_MAP = {
  success: { name: 'checkmark-circle'   as const, color: colors.success },
  error:   { name: 'alert-circle'       as const, color: colors.error   },
  queued:  { name: 'cloud-upload-outline' as const, color: colors.warning },
};

export default function ScanConfirmation({ visible, type, message, onDismiss }: ScanConfirmationProps) {
  const scale = useRef(new Animated.Value(0.8)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 80, friction: 8 }),
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start();

      const timer = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
          scale.setValue(0.8);
          onDismiss();
        });
      }, DISPLAY_MS);

      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!visible) return null;

  const icon = ICON_MAP[type];

  return (
    <View style={styles.overlay}>
      <Animated.View style={[styles.content, { transform: [{ scale }], opacity }]}>
        <Ionicons name={icon.name} size={56} color={icon.color} />
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  content: {
    alignItems: 'center',
    gap: spacing.md,
  },
  message: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.lg,
    color: colors.text,
    textAlign: 'center',
    paddingHorizontal: spacing.xxl,
  },
});
