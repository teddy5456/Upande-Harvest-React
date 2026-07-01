import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Animated,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

/**
 * Banner that appears when the app has been forced-offline for more than
 * STICKY_OFFLINE_MS. Specifically targets the Honeywell EDA52 issue where
 * the WiFi radio loses data-plane connectivity and Android doesn't recover
 * on its own. We can't toggle WiFi from JS on Android 11+, so the next-best
 * thing is a one-tap deep-link to the WiFi settings page where the operator
 * can flip it off/on themselves.
 */

const STICKY_OFFLINE_MS = 25_000; // 25 s — only shout when it's clearly stuck
const APP_PACKAGE_HINT  = 'com.android.settings';

export default function StaleConnectionBanner() {
  const { isConnected } = useApp();
  const [visible, setVisible] = useState(false);
  const slide = useRef(new Animated.Value(-80)).current;
  const offlineSinceRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isConnected) {
      offlineSinceRef.current = null;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (visible) {
        Animated.timing(slide, {
          toValue: -80, duration: 220, useNativeDriver: true,
        }).start(() => setVisible(false));
      }
      return;
    }

    // Gone offline — start the stale timer if it isn't running already.
    if (offlineSinceRef.current === null) {
      offlineSinceRef.current = Date.now();
      timerRef.current = setTimeout(() => {
        setVisible(true);
        Animated.spring(slide, {
          toValue: 0, useNativeDriver: true, tension: 90, friction: 9,
        }).start();
      }, STICKY_OFFLINE_MS);
    }

    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [isConnected, slide, visible]);

  const openWifiSettings = async () => {
    if (Platform.OS === 'android') {
      try {
        // Open the WiFi settings page directly via Android Intent.
        // `Linking.sendIntent` is available on Android only.
        // @ts-ignore — sendIntent is Android-only and not in the cross-platform type
        await Linking.sendIntent('android.settings.WIFI_SETTINGS');
        return;
      } catch {
        // fall through to generic settings
      }
    }
    try {
      await Linking.openSettings();
    } catch { /* swallow — user can navigate manually */ }
  };

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.banner,
        { transform: [{ translateY: slide }] },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <Ionicons name="wifi-outline" size={20} color="#fff" />
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>Stuck offline</Text>
          <Text style={styles.sub}>
            Connection has been down for a while. Toggling WiFi usually fixes it.
          </Text>
        </View>
        <TouchableOpacity
          style={styles.action}
          onPress={openWifiSettings}
          activeOpacity={0.85}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.actionText}>WiFi</Text>
          <Ionicons name="open-outline" size={14} color={colors.text} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    backgroundColor: colors.error,
    paddingTop: spacing.xxl + spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    zIndex: 999,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconWrap: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: '#fff',
    letterSpacing: -0.2,
  },
  sub: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.92)',
    marginTop: 1,
    lineHeight: 16,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: '#fff',
    borderRadius: borderRadius.full,
  },
  actionText: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xs,
    color: colors.text,
    letterSpacing: 0.3,
  },
});
