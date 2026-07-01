import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import { fetchShelvesDashboard } from '../services/api';
import { fontFamily, fontSize, spacing } from '../theme';

// ─────────────────────────────────────────────────────────────────────────
// IR sensor display — chrome and palette.
//
// Palette is the canonical "Iron" colourmap used in FLIR thermal cameras.
// HUD chrome (borders, ticks, readouts) is mint #5eead4 on near-black —
// the colour a real instrument uses for overlays because it's the maximum-
// contrast non-data hue against the iron ramp.
// ─────────────────────────────────────────────────────────────────────────
const COLORS = {
  bg:       '#04050a',
  bgInner:  '#0a0a18',
  hud:      '#5eead4',
  hudDim:   'rgba(94,234,212,0.35)',
  hudFaint: 'rgba(94,234,212,0.12)',
  trash:    '#ef4444',
  text:     '#e2e8f0',
  textDim:  '#94a3b8',
};

// Iron colourmap — 8 stops from cold black through magenta/orange to white-hot.
const IRON: { d: number; c: string }[] = [
  { d: 0, c: '#0c0c2a' },
  { d: 1, c: '#1a0a3e' },
  { d: 2, c: '#41105e' },
  { d: 3, c: '#7c1a82' },
  { d: 4, c: '#c93a00' },
  { d: 5, c: '#f6a300' },
  { d: 6, c: '#fcdc4d' },
  { d: 7, c: '#ffe9a0' },
  { d: 8, c: '#ffffff' },
];

const TRASH_THRESHOLD_D = 6;

function ironColor(age: number): string {
  const a = Math.max(0, Math.min(age, IRON[IRON.length - 1].d));
  // Nearest-stop snap — alpha blending across blob halos smooths visually.
  for (let i = 0; i < IRON.length - 1; i++) {
    if (a <= IRON[i + 1].d) {
      return (a - IRON[i].d) < (IRON[i + 1].d - a) ? IRON[i].c : IRON[i + 1].c;
    }
  }
  return IRON[IRON.length - 1].c;
}

// HH:MM:SS clock for the HUD top bar — sells the "live instrument" feel.
function useClock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return t.toTimeString().slice(0, 8);
}

// ─────────────────────────────────────────────────────────────────────────
// Data shapes
// ─────────────────────────────────────────────────────────────────────────
interface ShelfBucket {
  bucket_id: string;
  variety:   string | null;
  item_code: string | null;
  stem_qty:  number;
  age_days:  number | null;
  date_added: string | null;
}
interface ShelfGridRow {
  shelf_id:     string;
  farm:         string | null;
  buckets:      ShelfBucket[];
  bucket_count: number;
  max_age_days: number;
  total_stems:  number;
}
interface ShelvingPayload {
  total_items?:    number;
  total_stems?:    number;
  avg_age?:        number;
  oldest_age?:     number;
  shelves_grid?:   ShelfGridRow[];
}

// ─────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────
export default function ShelfMapScreen() {
  const { isConnected } = useApp();
  const [loading, setLoading]    = useState(true);
  const [refreshing, setRefresh] = useState(false);
  const [data, setData]          = useState<ShelvingPayload | null>(null);
  const [pickShelf, setPickShelf] = useState<ShelfGridRow | null>(null);

  const clock = useClock();

  const load = useCallback(async () => {
    if (!isConnected) { setLoading(false); return; }
    try {
      const res = await fetchShelvesDashboard();
      setData(res || null);
    } catch { /* keep previous data on the canvas — a real instrument freezes its last reading */ }
    finally { setLoading(false); setRefresh(false); }
  }, [isConnected]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const shelves = useMemo<ShelfGridRow[]>(() => data?.shelves_grid || [], [data]);

  const stats = useMemo(() => {
    const all = shelves.flatMap((s) => s.buckets);
    const ages = all.map((b) => Math.max(0, b.age_days ?? 0));
    const sum  = ages.reduce((a, b) => a + b, 0);
    return {
      buckets: all.length,
      stems:   all.reduce((a, b) => a + (b.stem_qty || 0), 0),
      oldest:  ages.length ? Math.max(...ages) : 0,
      avg:     ages.length ? sum / ages.length : 0,
      trash:   all.filter((b) => (b.age_days ?? 0) >= TRASH_THRESHOLD_D).length,
    };
  }, [shelves]);

  const hottestBuckets = useMemo(() => {
    return shelves
      .flatMap((s) => s.buckets.map((b) => ({ ...b, shelf_id: s.shelf_id })))
      .filter((b) => (b.age_days ?? 0) > 0)
      .sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0))
      .slice(0, 6);
  }, [shelves]);

  const onRefresh = useCallback(async () => { setRefresh(true); await load(); }, [load]);

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={COLORS.hud} />
        <Text style={styles.hudMono}>ACQUIRING THERMAL SIGNAL…</Text>
      </View>
    );
  }
  if (!isConnected && shelves.length === 0) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Ionicons name="cloud-offline-outline" size={48} color={COLORS.hud} />
        <Text style={styles.hudMono}>SIGNAL LOST — RECONNECT FOR LIVE FEED</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* ── HUD top bar ──────────────────────────────────────────── */}
      <View style={styles.topbar}>
        <View style={styles.topbarLeft}>
          <View style={styles.recDot} />
          <Text style={styles.hudMonoStrong}>LIVE</Text>
          <View style={styles.hudDivider} />
          <Text style={styles.hudMono}>COLDSTORE / THERMAL</Text>
        </View>
        <View style={styles.topbarRight}>
          <Text style={styles.hudMono}>SCAN {clock}</Text>
        </View>
      </View>

      {/* ── Body: HUD strip + thermal canvas ────────────────────── */}
      <View style={styles.body}>
        <ScrollView
          style={styles.leftPanel}
          contentContainerStyle={styles.leftContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.hud} />}
        >
          {/* KPI block: BUCKETS / STEMS */}
          <View style={styles.hudBlock}>
            <Text style={styles.hudLabel}>BKTS</Text>
            <Text style={styles.hudBigNumber}>{stats.buckets}</Text>
            <Text style={styles.hudCaption}>{stats.stems.toLocaleString()} STMS</Text>
          </View>

          {/* KPI block: MAX age (the headline number a supervisor cares about) */}
          <View style={styles.hudBlock}>
            <Text style={styles.hudLabel}>MAX AGE</Text>
            <View style={styles.maxAgeRow}>
              <View style={[styles.bigDot, { backgroundColor: ironColor(stats.oldest) }]} />
              <Text style={styles.hudBigNumber}>{stats.oldest}<Text style={styles.hudUnit}>d</Text></Text>
            </View>
            <Text style={styles.hudCaption}>AVG {stats.avg.toFixed(1)}d</Text>
          </View>

          {/* TRASH counter — the operational risk signal */}
          {stats.trash > 0 ? (
            <View style={[styles.hudBlock, styles.hudBlockAlert]}>
              <Text style={[styles.hudLabel, { color: COLORS.trash }]}>↯ TRASH RISK</Text>
              <Text style={[styles.hudBigNumber, { color: COLORS.trash }]}>{stats.trash}</Text>
              <Text style={styles.hudCaption}>BKTS ≥ {TRASH_THRESHOLD_D}d</Text>
            </View>
          ) : (
            <View style={styles.hudBlock}>
              <Text style={styles.hudLabel}>TRASH RISK</Text>
              <Text style={styles.hudBigNumber}>0</Text>
              <Text style={styles.hudCaption}>BKTS ≥ {TRASH_THRESHOLD_D}d</Text>
            </View>
          )}

          {/* Hottest list — supervisor-actionable */}
          <Text style={styles.sectionRule}>── HOTTEST ──</Text>
          {hottestBuckets.length === 0 ? (
            <Text style={styles.hudMono}>NO HEAT DETECTED</Text>
          ) : hottestBuckets.map((b) => (
            <TouchableOpacity
              key={b.bucket_id}
              activeOpacity={0.6}
              onPress={() => setPickShelf(shelves.find((s) => s.shelf_id === b.shelf_id) || null)}
              style={styles.hotRow}
            >
              <View style={[styles.hotDot, { backgroundColor: ironColor(b.age_days ?? 0) }]} />
              <Text style={styles.hotId} numberOfLines={1}>{b.bucket_id}</Text>
              <Text style={styles.hotAge}>{b.age_days ?? 0}d</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* RIGHT — instrument canvas */}
        <View style={styles.canvasWrap}>
          <InstrumentFrame
            shelves={shelves}
            onShelfPick={setPickShelf}
          />
        </View>
      </View>

      {/* Drill-down: tap a shelf or a hotbar row → see all its buckets */}
      <Modal visible={!!pickShelf} transparent animationType="fade" onRequestClose={() => setPickShelf(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalEyebrow}>SHELF</Text>
                <Text style={styles.modalTitle}>{pickShelf?.shelf_id}</Text>
              </View>
              <TouchableOpacity onPress={() => setPickShelf(null)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={22} color={COLORS.hud} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalKPI}>
              <View>
                <Text style={styles.modalKpiLabel}>BUCKETS</Text>
                <Text style={styles.modalKpiValue}>{pickShelf?.bucket_count ?? 0}</Text>
              </View>
              <View>
                <Text style={styles.modalKpiLabel}>STEMS</Text>
                <Text style={styles.modalKpiValue}>{(pickShelf?.total_stems ?? 0).toLocaleString()}</Text>
              </View>
              <View>
                <Text style={styles.modalKpiLabel}>MAX AGE</Text>
                <View style={styles.modalAgeRow}>
                  <View style={[styles.dot8, { backgroundColor: ironColor(pickShelf?.max_age_days ?? 0) }]} />
                  <Text style={styles.modalKpiValue}>{pickShelf?.max_age_days ?? 0}d</Text>
                </View>
              </View>
            </View>
            <ScrollView style={styles.modalList}>
              {(pickShelf?.buckets || []).map((b, i) => (
                <View key={b.bucket_id || i} style={styles.bucketRow}>
                  <View style={[styles.bucketDot, { backgroundColor: ironColor(b.age_days ?? 0) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bucketId}>{b.bucket_id}</Text>
                    <Text style={styles.bucketMeta}>{b.variety || b.item_code || '—'}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.bucketStems}>{(b.stem_qty || 0).toLocaleString()} stems</Text>
                    <Text style={styles.bucketAge}>{b.age_days ?? 0}d</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Instrument frame: corner brackets, crosshair, scale bar.
// Inside: thermal clusters (one per shelf).
// ─────────────────────────────────────────────────────────────────────────
function InstrumentFrame({
  shelves,
  onShelfPick,
}: {
  shelves: ShelfGridRow[];
  onShelfPick: (s: ShelfGridRow) => void;
}) {
  const { width: SW, height: SH } = Dimensions.get('window');
  // Right-side viewport: ~64% of screen width, ~70% of remaining height.
  const FW = Math.floor(SW * 0.62);
  const FH = Math.floor(SH * 0.74);

  // The IR scale bar sits inside the bottom of the frame.
  const scaleH = 14;
  // Scan area: full frame minus the bottom scale strip.
  const scanH = FH - scaleH - 6;

  // Cluster centres: serpentine across the canvas.
  const clusters = useMemo(() => {
    const n = Math.max(1, shelves.length);
    const aspect = FW / scanH;
    const cols = Math.max(2, Math.ceil(Math.sqrt(n * aspect)));
    const rows = Math.max(2, Math.ceil(n / cols));
    const cw = FW / cols;
    const ch = scanH / rows;
    return shelves.map((s, i) => {
      const r = Math.floor(i / cols);
      const inRow = i % cols;
      const c = r % 2 === 0 ? inRow : (cols - 1 - inRow);
      return {
        shelf: s,
        cx: c * cw + cw / 2,
        cy: r * ch + ch / 2,
        cw,
        ch,
      };
    });
  }, [shelves, FW, scanH]);

  // Compute trash-marker x-position on the IR scale bar (0d → left, 9d+ → right).
  const trashX = (TRASH_THRESHOLD_D / (IRON[IRON.length - 1].d || 9)) * (FW - 24) + 12;

  return (
    <View style={[styles.frame, { width: FW, height: FH }]}>
      {/* Inner scan area (everything except scale strip) */}
      <View pointerEvents="box-none" style={[styles.scanArea, { height: scanH }]}>
        {/* Faint grid — telemetry texture */}
        <View pointerEvents="none" style={styles.gridH1} />
        <View pointerEvents="none" style={styles.gridH2} />
        <View pointerEvents="none" style={styles.gridV1} />
        <View pointerEvents="none" style={styles.gridV2} />

        {/* Centre crosshair */}
        <View pointerEvents="none" style={[styles.crosshairH, { top: scanH / 2 - 0.5, width: FW }]} />
        <View pointerEvents="none" style={[styles.crosshairV, { left: FW / 2 - 0.5, height: scanH }]} />
        <Text style={[styles.crosshairTag, { left: FW / 2 + 6, top: scanH / 2 + 4 }]}>+</Text>

        {/* Clusters of thermal blobs */}
        {clusters.map(({ shelf, cx, cy, cw, ch }) => (
          <ThermalCluster
            key={shelf.shelf_id}
            shelf={shelf}
            cx={cx}
            cy={cy}
            radius={Math.min(cw, ch) * 0.45}
            onPick={() => onShelfPick(shelf)}
          />
        ))}

        {/* Corner brackets */}
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
      </View>

      {/* Scale bar at the bottom of the frame */}
      <View style={[styles.scaleStrip, { width: FW }]}>
        <View style={styles.scaleGradient}>
          {IRON.map((s, i) => (
            <View
              key={i}
              style={[styles.scaleSeg, { backgroundColor: s.c }]}
            />
          ))}
        </View>
        {/* TRASH threshold marker */}
        <View pointerEvents="none" style={[styles.trashMarker, { left: trashX }]} />
        <Text style={[styles.trashLabel, { left: trashX - 18 }]}>TRASH→</Text>
        <Text style={styles.scaleLabelLeft}>0d</Text>
        <Text style={styles.scaleLabelRight}>{IRON[IRON.length - 1].d}d+</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Thermal cluster — one shelf becomes one warm mass.
// Bucket blobs are placed in a small ring around the shelf centre. Inner /
// outer halos give the IR-camera bloom: alpha blending across overlapping
// halos smooths into a continuous gradient.
// ─────────────────────────────────────────────────────────────────────────
function ThermalCluster({
  shelf, cx, cy, radius, onPick,
}: {
  shelf: ShelfGridRow;
  cx: number;
  cy: number;
  radius: number;
  onPick: () => void;
}) {
  const buckets = shelf.buckets;
  const n = buckets.length;
  if (n === 0) return null;

  // For small clusters (≤9 buckets) the ring radius scales tightly so blobs
  // overlap heavily. For big clusters (up to 27 buckets), spread out so the
  // mass shows shape but stays coherent.
  const ringR = Math.min(radius * 0.65, 4 + n * 1.4);

  // Each blob = 3 stacked halos: outer (very faint), mid, inner (bright).
  // Blob radius scales modestly with bucket stem count for visual weight.
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPick}
      style={{
        position: 'absolute',
        left: cx - radius,
        top: cy - radius,
        width: radius * 2,
        height: radius * 2,
      }}
    >
      {buckets.map((b, i) => {
        const theta = (i / n) * Math.PI * 2;
        // The first bucket sits dead-centre so single-bucket shelves bloom in place.
        const dx = n === 1 ? 0 : ringR * Math.cos(theta);
        const dy = n === 1 ? 0 : ringR * Math.sin(theta);
        const col = ironColor(b.age_days ?? 0);
        const weight = Math.max(0.5, Math.min(1.4, (b.stem_qty || 50) / 80));
        const inner = Math.max(8, radius * 0.32 * weight);
        const mid   = inner * 1.85;
        const outer = inner * 3.05;
        const px = radius + dx;
        const py = radius + dy;
        return (
          <React.Fragment key={b.bucket_id || i}>
            <View style={{ position: 'absolute', left: px - outer, top: py - outer, width: outer * 2, height: outer * 2, borderRadius: outer, backgroundColor: col, opacity: 0.10 }} />
            <View style={{ position: 'absolute', left: px - mid,   top: py - mid,   width: mid   * 2, height: mid   * 2, borderRadius: mid,   backgroundColor: col, opacity: 0.32 }} />
            <View style={{ position: 'absolute', left: px - inner, top: py - inner, width: inner * 2, height: inner * 2, borderRadius: inner, backgroundColor: col, opacity: 0.88 }} />
          </React.Fragment>
        );
      })}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.md },

  // ── Top HUD bar ─────────────────────────────────────────────────────
  topbar: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hudFaint,
  },
  topbarLeft:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topbarRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.trash },
  hudDivider: { width: 1, height: 12, backgroundColor: COLORS.hudFaint },

  body: { flex: 1, flexDirection: 'row' },

  // ── Left HUD strip ──────────────────────────────────────────────────
  leftPanel: { width: '36%', borderRightWidth: 1, borderRightColor: COLORS.hudFaint },
  leftContent: { padding: 8, gap: 6 },

  hudBlock: {
    backgroundColor: COLORS.bgInner,
    borderWidth: 1,
    borderColor: COLORS.hudFaint,
    padding: 8,
  },
  hudBlockAlert: { borderColor: COLORS.trash },

  hudLabel: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: COLORS.hud,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  hudBigNumber: {
    fontFamily: fontFamily.bold,
    fontSize: 26,
    color: COLORS.text,
    letterSpacing: -0.5,
    lineHeight: 30,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  hudUnit: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: COLORS.textDim,
  },
  hudCaption: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: COLORS.textDim,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  maxAgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bigDot: { width: 10, height: 10, borderRadius: 5 },

  sectionRule: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: COLORS.hud,
    letterSpacing: 2,
    marginTop: 8,
    marginBottom: 2,
  },
  hudMono: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: COLORS.text,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  hudMonoStrong: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: COLORS.trash,
    letterSpacing: 1.8,
    fontWeight: '700',
    textTransform: 'uppercase',
  },

  hotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hudFaint,
  },
  hotDot: { width: 8, height: 8, borderRadius: 2 },
  hotId: { flex: 1, fontFamily: 'monospace', fontSize: 11, color: COLORS.text, letterSpacing: 0.5 },
  hotAge: { fontFamily: 'monospace', fontSize: 11, color: COLORS.hud, fontWeight: '700' },

  // ── Right canvas ────────────────────────────────────────────────────
  canvasWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 6 },
  frame: {
    backgroundColor: COLORS.bgInner,
    borderWidth: 1,
    borderColor: COLORS.hudFaint,
    position: 'relative',
    overflow: 'hidden',
  },
  scanArea: { width: '100%', position: 'relative', overflow: 'hidden' },

  // Faint gridlines for telemetry texture (thirds)
  gridH1: { position: 'absolute', left: 0, right: 0, top: '33%', height: 1, backgroundColor: COLORS.hudFaint },
  gridH2: { position: 'absolute', left: 0, right: 0, top: '66%', height: 1, backgroundColor: COLORS.hudFaint },
  gridV1: { position: 'absolute', top: 0, bottom: 0, left: '33%', width: 1, backgroundColor: COLORS.hudFaint },
  gridV2: { position: 'absolute', top: 0, bottom: 0, left: '66%', width: 1, backgroundColor: COLORS.hudFaint },

  // Centre crosshair
  crosshairH: { position: 'absolute', left: 0, height: 1, backgroundColor: COLORS.hudDim },
  crosshairV: { position: 'absolute', top: 0, width: 1, backgroundColor: COLORS.hudDim },
  crosshairTag: { position: 'absolute', fontFamily: 'monospace', fontSize: 9, color: COLORS.hud, letterSpacing: 1 },

  // Corner brackets (real targeting-reticle scale)
  corner: { position: 'absolute', width: 18, height: 18, borderColor: COLORS.hud },
  cornerTL: { top: 0,    left: 0,    borderTopWidth: 2, borderLeftWidth: 2 },
  cornerTR: { top: 0,    right: 0,   borderTopWidth: 2, borderRightWidth: 2 },
  cornerBL: { bottom: 0, left: 0,    borderBottomWidth: 2, borderLeftWidth: 2 },
  cornerBR: { bottom: 0, right: 0,   borderBottomWidth: 2, borderRightWidth: 2 },

  // Bottom IR scale strip — lives inside the frame
  scaleStrip: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: 26,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: COLORS.hudFaint,
    backgroundColor: COLORS.bgInner,
  },
  scaleGradient: { flexDirection: 'row', height: 6 },
  scaleSeg: { flex: 1 },
  scaleLabelLeft: {
    position: 'absolute',
    bottom: 1,
    left: 12,
    fontFamily: 'monospace',
    fontSize: 8,
    color: COLORS.hud,
    letterSpacing: 1,
  },
  scaleLabelRight: {
    position: 'absolute',
    bottom: 1,
    right: 12,
    fontFamily: 'monospace',
    fontSize: 8,
    color: COLORS.hud,
    letterSpacing: 1,
  },
  trashMarker: {
    position: 'absolute',
    top: 5,
    width: 1,
    height: 10,
    backgroundColor: COLORS.trash,
  },
  trashLabel: {
    position: 'absolute',
    bottom: 1,
    fontFamily: 'monospace',
    fontSize: 8,
    color: COLORS.trash,
    letterSpacing: 1,
    fontWeight: '700',
  },

  // ── Modal (drill-down) ──────────────────────────────────────────────
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: COLORS.bgInner,
    borderTopWidth: 1,
    borderTopColor: COLORS.hud,
    padding: 16,
    maxHeight: '75%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hudFaint,
    marginBottom: 12,
  },
  modalEyebrow: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: COLORS.hud,
    letterSpacing: 2,
  },
  modalTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    color: COLORS.text,
    letterSpacing: -0.3,
    marginTop: 2,
  },
  modalKPI: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hudFaint,
    marginBottom: 12,
  },
  modalKpiLabel: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: COLORS.hud,
    letterSpacing: 1.5,
  },
  modalKpiValue: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    color: COLORS.text,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  modalAgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot8: { width: 10, height: 10, borderRadius: 5 },
  modalList: { flexGrow: 0 },
  bucketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hudFaint,
  },
  bucketDot: { width: 12, height: 12, borderRadius: 6 },
  bucketId: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: COLORS.text,
    letterSpacing: 0.5,
  },
  bucketMeta: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: COLORS.textDim,
    marginTop: 2,
  },
  bucketStems: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: COLORS.text,
  },
  bucketAge: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: COLORS.hud,
    marginTop: 2,
    fontWeight: '700',
  },
});
