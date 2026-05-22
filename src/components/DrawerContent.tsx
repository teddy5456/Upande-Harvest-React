import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Pressable,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../context/AppContext';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';
import { lightHaptic } from '../utils/feedback';

const NAV_ITEMS = [
  { label: 'Dashboard', icon: 'home-outline' as const, tab: 'Dashboard' },
  { label: 'Harvest', icon: 'leaf-outline' as const, tab: 'Harvest' },
  { label: 'Receiving', icon: 'download-outline' as const, tab: 'Receive' },
  { label: 'Transfer', icon: 'swap-horizontal-outline' as const, tab: 'Transfer', xfloraOnly: true },
  { label: 'Shelve', icon: 'scan-outline' as const, tab: 'Shelve' },
  { label: 'Grade', icon: 'clipboard-outline' as const, tab: 'Grade' },
  { label: 'Packing', icon: 'cube-outline' as const, tab: 'Pack' },
  { label: 'Quality', icon: 'shield-checkmark-outline' as const, tab: 'Quality' },
  { label: 'Shelf Map', icon: 'grid-outline' as const, tab: 'Map' },
  { label: 'Settings', icon: 'cog-outline' as const, tab: 'Settings' },
];

interface DrawerMenuProps {
  visible: boolean;
  onClose: () => void;
  onNavigate: (tab: string) => void;
  onWhatsNew?: () => void;
  onTutorial?: () => void;
}

export default function DrawerMenu({ visible, onClose, onNavigate, onWhatsNew, onTutorial }: DrawerMenuProps) {
  const { fullName, userEmail, logout, isXflora } = useApp();
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // Responsive drawer width: 80% of screen, capped between 240–320px
  const drawerWidth = Math.min(Math.max(screenWidth * 0.8, 240), 320);

  const slideAnim = React.useRef(new Animated.Value(-drawerWidth)).current;

  React.useEffect(() => {
    // Reset animation value when drawerWidth changes (orientation)
    if (!visible) {
      slideAnim.setValue(-drawerWidth);
    }
  }, [drawerWidth]);

  React.useEffect(() => {
    if (visible) {
      slideAnim.setValue(-drawerWidth);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start();
    } else {
      slideAnim.setValue(-drawerWidth);
    }
  }, [visible]);

  const handleClose = () => {
    Animated.timing(slideAnim, {
      toValue: -drawerWidth,
      duration: 200,
      useNativeDriver: true,
    }).start(() => onClose());
  };

  const initials = fullName
    .split(' ')
    .filter(Boolean)
    .map((n: string) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase() || '?';

  const handleNav = (tab: string) => {
    lightHaptic();
    handleClose();
    setTimeout(() => onNavigate(tab), 220);
  };

  const handleSignOut = () => {
    lightHaptic();
    handleClose();
    setTimeout(() => logout(), 220);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleClose} />

        <Animated.View
          style={[
            styles.drawer,
            {
              width: drawerWidth,
              transform: [{ translateX: slideAnim }],
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
            },
          ]}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            bounces={false}
            showsVerticalScrollIndicator={false}
          >
            {/* User header */}
            <View style={styles.header}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
              <Text style={styles.name} numberOfLines={1}>{fullName || 'User'}</Text>
              <Text style={styles.email} numberOfLines={1}>{userEmail}</Text>
            </View>

            {/* Nav items */}
            <View style={styles.nav}>
              {NAV_ITEMS
                .filter(item => !(isXflora && item.tab === 'Harvest'))
                .filter(item => !(item.xfloraOnly && !isXflora))
                .map((item) => (
                <TouchableOpacity
                  key={item.tab}
                  style={styles.navItem}
                  onPress={() => handleNav(item.tab)}
                  activeOpacity={0.7}
                >
                  <Ionicons name={item.icon} size={20} color={colors.textSecondary} />
                  <Text style={styles.navLabel}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Footer actions */}
            <View style={styles.footer}>
              {onTutorial && (
                <TouchableOpacity style={styles.footerRow} onPress={onTutorial} activeOpacity={0.7}>
                  <View style={[styles.footerBadge, { backgroundColor: '#F0FDF4' }]}>
                    <Ionicons name="help-circle-outline" size={15} color="#22C55E" />
                  </View>
                  <Text style={styles.footerRowText}>How to Use</Text>
                </TouchableOpacity>
              )}

              {onWhatsNew && (
                <TouchableOpacity style={styles.footerRow} onPress={onWhatsNew} activeOpacity={0.7}>
                  <View style={[styles.footerBadge, { backgroundColor: '#EEF2FF' }]}>
                    <Ionicons name="sparkles" size={15} color="#6366F1" />
                  </View>
                  <Text style={styles.footerRowText}>What's New</Text>
                  <View style={styles.newDot} />
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.footerRow} onPress={handleSignOut} activeOpacity={0.7}>
                <View style={[styles.footerBadge, { backgroundColor: '#FEF2F2' }]}>
                  <Ionicons name="log-out-outline" size={15} color={colors.error} />
                </View>
                <Text style={[styles.footerRowText, { color: colors.error }]}>Sign Out</Text>
              </TouchableOpacity>

              <Text style={styles.version}>Upande Harvest v1.2</Text>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  drawer: {
    backgroundColor: colors.surface,
    height: '100%',
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },

  header: {
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: spacing.xs,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: colors.textOnPrimary,
  },
  name: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
  },
  email: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },

  nav: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 11,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  navLabel: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.text,
  },

  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  footerBadge: {
    width: 30,
    height: 30,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  footerRowText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.text,
    flex: 1,
  },
  newDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#6366F1',
  },
  version: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    paddingBottom: spacing.xs,
  },
});
