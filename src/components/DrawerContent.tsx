import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';
import { lightHaptic } from '../utils/feedback';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = SCREEN_WIDTH * 0.78;

const NAV_ITEMS = [
  { label: 'Dashboard', icon: 'home-outline' as const, tab: 'Dashboard' },
  { label: 'Harvest', icon: 'leaf-outline' as const, tab: 'Harvest' },
  { label: 'Receiving', icon: 'download-outline' as const, tab: 'Receive' },
  { label: 'Shelve', icon: 'scan-outline' as const, tab: 'Shelve' },
  { label: 'Grade', icon: 'clipboard-outline' as const, tab: 'Grade' },
  { label: 'Shelf Map', icon: 'grid-outline' as const, tab: 'Map' },
  { label: 'Settings', icon: 'cog-outline' as const, tab: 'Settings' },
];

interface DrawerMenuProps {
  visible: boolean;
  onClose: () => void;
  onNavigate: (tab: string) => void;
}

export default function DrawerMenu({ visible, onClose, onNavigate }: DrawerMenuProps) {
  const { fullName, userEmail, logout } = useApp();
  const slideAnim = React.useRef(new Animated.Value(-DRAWER_WIDTH)).current;

  React.useEffect(() => {
    if (visible) {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start();
    } else {
      slideAnim.setValue(-DRAWER_WIDTH);
    }
  }, [visible, slideAnim]);

  const handleClose = () => {
    Animated.timing(slideAnim, {
      toValue: -DRAWER_WIDTH,
      duration: 200,
      useNativeDriver: true,
    }).start(() => onClose());
  };

  const initials = fullName
    .split(' ')
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
        <Animated.View style={[styles.drawer, { transform: [{ translateX: slideAnim }] }]}>
          <ScrollView contentContainerStyle={styles.container} bounces={false}>
            <View style={styles.header}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
              <Text style={styles.name} numberOfLines={1}>{fullName || 'User'}</Text>
              <Text style={styles.email} numberOfLines={1}>{userEmail}</Text>
            </View>

            <View style={styles.nav}>
              {NAV_ITEMS.map((item) => (
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

            <View style={styles.footer}>
              <TouchableOpacity style={styles.signOutRow} onPress={handleSignOut} activeOpacity={0.7}>
                <Ionicons name="log-out-outline" size={20} color={colors.error} />
                <Text style={styles.signOutText}>Sign Out</Text>
              </TouchableOpacity>
              <Text style={styles.version}>Upande Harvest v1.0</Text>
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
    width: DRAWER_WIDTH,
    backgroundColor: colors.surface,
    height: '100%',
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
  },
  header: {
    paddingVertical: spacing.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  avatarText: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.textOnPrimary,
  },
  name: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.lg,
    color: colors.text,
  },
  email: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  nav: {
    flex: 1,
    paddingTop: spacing.sm,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  navLabel: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.md,
    color: colors.text,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  signOutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  signOutText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.md,
    color: colors.error,
  },
  version: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
