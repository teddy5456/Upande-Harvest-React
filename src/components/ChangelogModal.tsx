import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Dimensions,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getSetting, setSetting } from '../database/settings';
import { colors, fontFamily, fontSize, spacing, borderRadius, shadow } from '../theme';

const CHANGELOG_VERSION = '1.3';
const { width: SW } = Dimensions.get('window');

// ─── Changelog entries ────────────────────────────────────────────────────────
const ENTRIES = [
  {
    id: 'grade-anyorder',
    bg: '#0F172A',
    accent: '#6366F1',
    accentSoft: '#1E1B4B',
    tag: 'Improved',
    tagColor: '#6366F1',
    title: 'Scan in Any Order',
    body: 'The Grade screen now auto-detects each QR code — bunch, grader, or bucket — so you can scan in whatever order works fastest for you.',
    illustration: 'qr',
  },
  {
    id: 'packing',
    bg: '#1C0A00',
    accent: '#F59E0B',
    accentSoft: '#431407',
    tag: 'New',
    tagColor: '#F59E0B',
    title: 'Packing Page',
    body: 'A dedicated Packing screen lets you scan a box label and then scan bunches into it. Close the box when done — works offline too.',
    illustration: 'action',
  },
  {
    id: 'quality',
    bg: '#022C22',
    accent: '#22C55E',
    accentSoft: '#14532D',
    tag: 'New',
    tagColor: '#22C55E',
    title: 'Quality Tracking',
    body: 'Record field rejects, receiving rejects, and packhouse discards in one place. Select a reason, enter quantity, and submit.',
    illustration: 'update',
  },
  {
    id: 'clean-ui',
    bg: '#0C1A2E',
    accent: '#38BDF8',
    accentSoft: '#0C2A3E',
    tag: 'Improved',
    tagColor: '#38BDF8',
    title: 'Cleaner Logs',
    body: 'Entry logs now stay out of your way — only errors show by default. Tap "Show all" to see every scan in a session.',
    illustration: 'nav',
  },
  {
    id: 'harvest-ux',
    bg: '#0D1F12',
    accent: '#4ADE80',
    accentSoft: '#14532D',
    tag: 'Improved',
    tagColor: '#4ADE80',
    title: 'Harvest, Faster',
    body: 'Greenhouse data now loads instantly — even offline. Fields light up red when something is missing instead of showing a popup. Press "Next" after quantity to jump straight to the scan field.',
    illustration: 'harvest',
  },
  {
    id: 'offline-ux',
    bg: '#12101E',
    accent: '#A78BFA',
    accentSoft: '#1E1B4B',
    tag: 'Improved',
    tagColor: '#A78BFA',
    title: 'Smarter Offline',
    body: 'The app now detects lost signal almost instantly instead of waiting up to 30 seconds. Entries saved while offline show a cloud icon — not a red error. When back online they sync automatically.',
    illustration: 'offline',
  },
];

// ─── Illustrations ─────────────────────────────────────────────────────────────

function IllustrationQR({ accent, accentSoft }: { accent: string; accentSoft: string }) {
  return (
    <View style={il.root}>
      {/* background blobs */}
      <View style={[il.blob, { width: 220, height: 220, borderRadius: 110, backgroundColor: accentSoft, top: -30, left: -40 }]} />
      <View style={[il.blob, { width: 140, height: 140, borderRadius: 70, backgroundColor: accentSoft, bottom: 0, right: -20, opacity: 0.6 }]} />

      {/* QR card */}
      <View style={[il.card, { borderColor: accent + '55' }]}>
        {/* QR grid */}
        <View style={il.qrGrid}>
          {[...Array(5)].map((_, r) =>
            [...Array(5)].map((_, c) => {
              const corner = (r < 2 && c < 2) || (r < 2 && c > 2) || (r > 2 && c < 2);
              const filled = corner || (r === 2 && c === 2) || Math.random() > 0.45;
              return (
                <View
                  key={`${r}-${c}`}
                  style={[
                    il.qrCell,
                    {
                      backgroundColor: filled ? '#fff' : 'transparent',
                      opacity: filled ? 1 : 0,
                    },
                  ]}
                />
              );
            })
          )}
        </View>
        {/* JSON badge overlapping bottom-right */}
        <View style={[il.jsonBadge, { backgroundColor: accent }]}>
          <Text style={il.jsonText}>{`{ id }`}</Text>
        </View>
      </View>

      {/* check badge */}
      <View style={[il.checkBadge, { backgroundColor: '#22C55E' }]}>
        <Ionicons name="checkmark" size={18} color="#fff" />
      </View>
    </View>
  );
}

function IllustrationAction({ accent, accentSoft }: { accent: string; accentSoft: string }) {
  return (
    <View style={il.root}>
      <View style={[il.blob, { width: 200, height: 200, borderRadius: 100, backgroundColor: accentSoft, top: 10, left: SW * 0.1 }]} />

      {/* Error node */}
      <View style={[il.actionNode, { backgroundColor: '#7F1D1D', left: SW * 0.04 }]}>
        <Ionicons name="alert-circle" size={28} color="#EF4444" />
        <Text style={[il.actionNodeLabel, { color: '#FCA5A5' }]}>Shelve{'\n'}Error</Text>
      </View>

      {/* Arrow */}
      <View style={il.arrowRow}>
        <View style={[il.arrowLine, { backgroundColor: accent }]} />
        <Ionicons name="chevron-forward" size={22} color={accent} />
      </View>

      {/* Fix node */}
      <View style={[il.actionNode, { backgroundColor: '#14532D', right: SW * 0.04 }]}>
        <Ionicons name="download" size={28} color="#22C55E" />
        <Text style={[il.actionNodeLabel, { color: '#86EFAC' }]}>Receive{'\n'}Now</Text>
      </View>

      {/* bottom label */}
      <View style={[il.pill, { backgroundColor: accent + '33', borderColor: accent + '66' }]}>
        <Ionicons name="flash" size={12} color={accent} />
        <Text style={[il.pillText, { color: accent }]}>One tap to fix</Text>
      </View>
    </View>
  );
}

function IllustrationUpdate({ accent, accentSoft }: { accent: string; accentSoft: string }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 3000, useNativeDriver: true })
    ).start();
  }, []);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={il.root}>
      <View style={[il.blob, { width: 240, height: 240, borderRadius: 120, backgroundColor: accentSoft, top: -20, alignSelf: 'center' }]} />

      {/* rotating ring */}
      <Animated.View style={[il.ring, { borderColor: accent + '44', transform: [{ rotate }] }]} />
      <Animated.View style={[il.ring, { width: 130, height: 130, borderRadius: 65, borderColor: accent + '88', borderStyle: 'dashed', transform: [{ rotate }] }]} />

      {/* centre icon */}
      <View style={[il.centerIcon, { backgroundColor: accent }]}>
        <Ionicons name="arrow-down-circle" size={38} color="#fff" />
      </View>

      {/* floating version chips */}
      <View style={[il.versionChip, { top: 18, right: SW * 0.12, backgroundColor: accentSoft, borderColor: accent + '66' }]}>
        <Text style={[il.versionChipText, { color: accent }]}>v1.1</Text>
      </View>
      <View style={[il.versionChip, { bottom: 24, left: SW * 0.1, backgroundColor: accentSoft, borderColor: accent + '44' }]}>
        <Text style={[il.versionChipText, { color: accent + 'AA' }]}>v1.0</Text>
      </View>
    </View>
  );
}

function IllustrationNav({ accent, accentSoft }: { accent: string; accentSoft: string }) {
  return (
    <View style={il.root}>
      <View style={[il.blob, { width: 200, height: 200, borderRadius: 100, backgroundColor: accentSoft, top: 0, alignSelf: 'center' }]} />

      {/* phone mockup */}
      <View style={[il.phone, { borderColor: accent + '88' }]}>
        {/* screen content lines */}
        <View style={il.screenLines}>
          {[80, 60, 70, 50].map((w, i) => (
            <View key={i} style={[il.screenLine, { width: `${w}%`, backgroundColor: accent + '33' }]} />
          ))}
        </View>
        {/* tab bar */}
        <View style={[il.phoneTabBar, { backgroundColor: accentSoft, borderTopColor: accent + '55' }]}>
          {['home', 'leaf', 'download', 'scan', 'clipboard'].map((icon, i) => (
            <View key={i} style={il.phoneTab}>
              <Ionicons
                name={(icon + (i === 0 ? '' : '-outline')) as any}
                size={14}
                color={i === 0 ? accent : accent + '66'}
              />
            </View>
          ))}
        </View>
      </View>

      {/* checkmark badge */}
      <View style={[il.checkBadge, { backgroundColor: accent, right: SW * 0.16, bottom: 30 }]}>
        <Ionicons name="checkmark" size={18} color="#fff" />
      </View>
    </View>
  );
}

function IllustrationHarvest({ accent, accentSoft }: { accent: string; accentSoft: string }) {
  return (
    <View style={il.root}>
      <View style={[il.blob, { width: 220, height: 220, borderRadius: 110, backgroundColor: accentSoft, top: -10, alignSelf: 'center' }]} />

      {/* Form card */}
      <View style={[il.card, { width: 180, height: 160, borderColor: accent + '44', gap: 10, paddingVertical: 16, paddingHorizontal: 14 }]}>
        {/* Field rows — first two normal, third highlighted red (missing) */}
        {[accent + '33', accent + '33', '#EF444455'].map((bg, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 52, height: 9, borderRadius: 4, backgroundColor: accent + '44' }} />
            <View style={{ flex: 1, height: 24, borderRadius: 6, backgroundColor: bg, borderWidth: i === 2 ? 1.5 : 0, borderColor: i === 2 ? '#EF4444' : 'transparent' }} />
          </View>
        ))}
        {/* "← required" label on last field */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: -4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' }} />
          <View style={{ width: 70, height: 8, borderRadius: 3, backgroundColor: '#EF444466' }} />
        </View>
      </View>

      {/* Green tick badge — "it worked" */}
      <View style={[il.checkBadge, { backgroundColor: accent, right: SW * 0.14, bottom: 28 }]}>
        <Ionicons name="checkmark" size={18} color="#fff" />
      </View>
    </View>
  );
}

function IllustrationOffline({ accent, accentSoft }: { accent: string; accentSoft: string }) {
  return (
    <View style={il.root}>
      <View style={[il.blob, { width: 220, height: 220, borderRadius: 110, backgroundColor: accentSoft, top: -10, alignSelf: 'center' }]} />

      {/* Cloud upload icon — central hero */}
      <View style={[il.centerIcon, { backgroundColor: accent, width: 88, height: 88, borderRadius: 44 }]}>
        <Ionicons name="cloud-upload-outline" size={42} color="#fff" />
      </View>

      {/* "Saved for sync" pill */}
      <View style={[il.pill, { backgroundColor: accentSoft, borderColor: accent + '66', bottom: 52 }]}>
        <Ionicons name="time-outline" size={12} color={accent} />
        <Text style={[il.pillText, { color: accent }]}>Saved for sync</Text>
      </View>

      {/* Two entry rows suggesting a queue */}
      {[0, 1].map((i) => (
        <View key={i} style={{
          position: 'absolute',
          bottom: 14 + i * 28,
          left: SW * 0.06,
          right: SW * 0.06,
          height: 20,
          borderRadius: 6,
          backgroundColor: accent + (i === 0 ? '22' : '11'),
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 8,
          gap: 6,
        }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent + (i === 0 ? 'CC' : '66') }} />
          <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: accent + (i === 0 ? '55' : '33') }} />
        </View>
      ))}
    </View>
  );
}

const ILLUSTRATIONS: Record<string, React.ComponentType<any>> = {
  qr: IllustrationQR,
  action: IllustrationAction,
  update: IllustrationUpdate,
  nav: IllustrationNav,
  harvest: IllustrationHarvest,
  offline: IllustrationOffline,
};

// ─── Main component ────────────────────────────────────────────────────────────

interface ChangelogModalProps {
  forceVisible?: boolean;
  onClose?: () => void;
}

export default function ChangelogModal({ forceVisible = false, onClose }: ChangelogModalProps) {
  const [visible, setVisible] = useState(false);
  const [page, setPage] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (forceVisible) {
      open();
      return;
    }
    getSetting('changelog_seen').then((val) => {
      if (val !== CHANGELOG_VERSION) open();
    });
  }, [forceVisible]);

  function open() {
    setPage(0);
    setVisible(true);
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }

  function close() {
    setSetting('changelog_seen', CHANGELOG_VERSION);
    Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setVisible(false);
      onClose?.();
    });
  }

  function goTo(index: number) {
    setPage(index);
    scrollRef.current?.scrollTo({ x: index * SW, animated: true });
  }

  const entry = ENTRIES[page];
  const Illustration = ILLUSTRATIONS[entry.illustration];
  const isLast = page === ENTRIES.length - 1;

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent>
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <View style={[styles.sheet, { backgroundColor: entry.bg }]}>

          {/* Dismiss X */}
          <TouchableOpacity style={styles.closeBtn} onPress={close} activeOpacity={0.7}>
            <Ionicons name="close" size={20} color="#ffffff88" />
          </TouchableOpacity>

          {/* Illustration pager */}
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEnabled={false}
            style={styles.ilScroll}
          >
            {ENTRIES.map((e) => {
              const Ill = ILLUSTRATIONS[e.illustration];
              return (
                <View key={e.id} style={[styles.ilPage, { width: SW }]}>
                  <Ill accent={e.accent} accentSoft={e.accentSoft} />
                </View>
              );
            })}
          </ScrollView>

          {/* Text content */}
          <View style={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}>
            <View style={styles.topRow}>
              <View style={[styles.tag, { backgroundColor: entry.accent + '22', borderColor: entry.accent + '55' }]}>
                <Text style={[styles.tagText, { color: entry.accent }]}>{entry.tag}</Text>
              </View>
              <Text style={styles.counter}>{page + 1} / {ENTRIES.length}</Text>
            </View>

            <Text style={styles.title}>{entry.title}</Text>
            {/* Body wrapped in flex:1 View so the Text always renders
                regardless of how the sheet height resolves */}
            <View style={{ flex: 1, justifyContent: 'flex-start', paddingTop: spacing.xs }}>
              <Text style={styles.body}>{entry.body}</Text>
            </View>

            {/* Dots */}
            <View style={styles.dots}>
              {ENTRIES.map((_, i) => (
                <TouchableOpacity key={i} onPress={() => goTo(i)} activeOpacity={0.7}>
                  <View style={[
                    styles.dot,
                    i === page
                      ? { backgroundColor: entry.accent, width: 20 }
                      : { backgroundColor: '#ffffff33' },
                  ]} />
                </TouchableOpacity>
              ))}
            </View>

            {/* Actions */}
            <View style={styles.actions}>
              {page > 0 && (
                <TouchableOpacity style={styles.backBtn} onPress={() => goTo(page - 1)} activeOpacity={0.7}>
                  <Ionicons name="chevron-back" size={18} color="#ffffffaa" />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.nextBtn, { backgroundColor: entry.accent, flex: 1 }]}
                onPress={isLast ? close : () => goTo(page + 1)}
                activeOpacity={0.8}
              >
                <Text style={styles.nextBtnText}>{isLast ? "Let's go!" : 'Next'}</Text>
                {!isLast && <Ionicons name="arrow-forward" size={16} color="#fff" />}
              </TouchableOpacity>
            </View>
          </View>

        </View>
      </Animated.View>
    </Modal>
  );
}

// ─── Illustration styles ───────────────────────────────────────────────────────
const il = StyleSheet.create({
  root: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
  },
  card: {
    width: 130,
    height: 130,
    borderRadius: borderRadius.xl,
    backgroundColor: '#ffffff0f',
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadow.md,
  },
  qrGrid: {
    width: 80,
    height: 80,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  qrCell: {
    width: 12,
    height: 12,
    borderRadius: 2,
  },
  jsonBadge: {
    position: 'absolute',
    bottom: -12,
    right: -16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  jsonText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#fff',
    fontWeight: '700',
  },
  checkBadge: {
    position: 'absolute',
    bottom: 28,
    right: SW * 0.14,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadow.md,
  },
  actionNode: {
    position: 'absolute',
    top: '30%',
    width: 80,
    height: 80,
    borderRadius: borderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  actionNodeLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 9,
    textAlign: 'center',
    lineHeight: 12,
  },
  arrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
  },
  arrowLine: {
    width: 40,
    height: 2,
    borderRadius: 1,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    position: 'absolute',
    bottom: 20,
  },
  pillText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
  },
  ring: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 2,
  },
  centerIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadow.md,
  },
  versionChip: {
    position: 'absolute',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  versionChipText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
  },
  phone: {
    width: 130,
    height: 200,
    borderRadius: 18,
    borderWidth: 2,
    backgroundColor: '#ffffff08',
    overflow: 'hidden',
  },
  screenLines: {
    flex: 1,
    padding: spacing.sm,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  screenLine: {
    height: 8,
    borderRadius: 4,
  },
  phoneTabBar: {
    height: 36,
    flexDirection: 'row',
    borderTopWidth: 1,
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.xs,
  },
  phoneTab: {
    flex: 1,
    alignItems: 'center',
  },
});

// ─── Sheet styles ──────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    height: '88%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  closeBtn: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ffffff15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ilScroll: {
    height: '52%',
  },
  ilPage: {
    height: '100%',
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  tag: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  tagText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.xs,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  counter: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: '#ffffff55',
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xxl,
    color: '#fff',
    marginBottom: spacing.sm,
    letterSpacing: -0.5,
  },
  body: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: '#ffffffcc',
    lineHeight: 22,
  },
  dots: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  dot: {
    height: 6,
    borderRadius: 3,
    width: 6,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ffffff15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  nextBtn: {
    height: 48,
    borderRadius: borderRadius.lg,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  nextBtnText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: '#fff',
  },
});
