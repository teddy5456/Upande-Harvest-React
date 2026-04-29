/**
 * Skeleton shimmer system.
 *
 * One shared Animated.Value drives a diagonal light strip that sweeps
 * left-to-right across EVERY skeleton box simultaneously — like a single
 * light source passing over the whole screen. All boxes stay in perfect
 * sync regardless of where they sit on the screen. Runs entirely on the
 * native thread (useNativeDriver: true), zero JS-thread cost.
 *
 * Exports:
 *   SkeletonBox            — single configurable shimmer shape
 *   HarvestFormSkeleton    — mirrors the Harvest form layout exactly
 *   DashboardSkeleton      — mirrors the Dashboard bento layout with the
 *                            REAL card colours so the skeleton → content
 *                            crossfade is visually seamless
 */

import React, { useEffect } from 'react';
import { Animated, Dimensions, View, StyleSheet, ViewStyle } from 'react-native';
import { borderRadius, spacing } from '../theme';

const { width: SW } = Dimensions.get('window');

// The light strip is ~45 % of screen width.  Wide enough to look smooth,
// narrow enough that it clearly looks like a moving highlight.
const STRIP_W = Math.round(SW * 0.45);
// 1 600 ms per full sweep — unhurried but not sluggish.
const SWEEP_MS = 1600;

// ─── Shared sweep animation ───────────────────────────────────────────────────

const sweep = new Animated.Value(0);
let sweepRunning = false;

function startSweep() {
  if (sweepRunning) return;
  sweepRunning = true;
  Animated.loop(
    Animated.timing(sweep, {
      toValue: 1,
      duration: SWEEP_MS,
      useNativeDriver: true,
    })
  ).start();
}

// Pre-computed interpolation — shared across every SkeletonBox instance so
// React Native only calculates it once.
const sharedTranslateX = sweep.interpolate({
  inputRange:  [0, 1],
  // Start fully off-screen left, finish fully off-screen right.
  // Every container on the screen will be swept regardless of its position.
  outputRange: [-(STRIP_W + SW), SW + STRIP_W],
});

// ─── SkeletonBox ─────────────────────────────────────────────────────────────

export interface SkeletonBoxProps {
  width?:        number | string;
  height?:       number;
  radius?:       number;
  /** Background colour of the skeleton shape */
  baseColor?:    string;
  /** Colour of the moving light strip. Use low-opacity for dark base colours. */
  shimmerColor?: string;
  style?:        ViewStyle;
}

export function SkeletonBox({
  width        = '100%',
  height       = 16,
  radius       = borderRadius.md,
  baseColor    = '#DCDCDC',
  shimmerColor = 'rgba(255,255,255,0.72)',
  style,
}: SkeletonBoxProps) {
  useEffect(startSweep, []);

  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: baseColor,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {/*
        The diagonal skew (-18°) gives the strip a premium bevelled look.
        top / bottom are extended far beyond the box bounds so the skew
        never shows a clipped corner — overflow: 'hidden' trims it cleanly.
      */}
      <Animated.View
        style={{
          position:        'absolute',
          top:             -(height * 3),
          bottom:          -(height * 3),
          width:           STRIP_W,
          backgroundColor: shimmerColor,
          transform: [
            { skewX: '-18deg' },
            { translateX: sharedTranslateX },
          ],
        }}
      />
    </View>
  );
}

// ─── Palette helpers ──────────────────────────────────────────────────────────

// Light surface (Harvest form, white cards)
const L = {
  base:    '#E2E2E2',
  shimmer: 'rgba(255,255,255,0.82)',
};

// Dark cards — real Dashboard colours.
// Shimmer is intentionally subtle on dark surfaces.
const D = {
  hero:    '#052E16',  // matches s.hero backgroundColor
  blue:    '#0F2744',  // matches C.tileBlue
  stone:   '#1C1917',  // matches C.tileStone
  red:     '#2A0A0A',  // slightly lighter than C.tileRed so it reads as a card
  card:    '#E8E8E8',  // white-ish cards (variance, GH breakdown)
  shimmer: 'rgba(255,255,255,0.10)',
  shimmerLight: 'rgba(255,255,255,0.72)',
};

function DarkBox(props: Omit<SkeletonBoxProps, 'shimmerColor'> & { color: string }) {
  const { color, ...rest } = props;
  return <SkeletonBox {...rest} baseColor={color} shimmerColor={D.shimmer} />;
}

// ─── HarvestFormSkeleton ──────────────────────────────────────────────────────
// Four fields (Greenhouse, Section, Item, Quantity) + scan input.
// Heights and spacing match the real form so the crossfade is invisible.

export function HarvestFormSkeleton() {
  // Label widths mirror realistic label lengths for each field
  const labelWidths = [96, 72, 48, 72];

  return (
    <View style={st.formWrap}>
      {labelWidths.map((lw, i) => (
        <View key={i} style={st.fieldGroup}>
          <SkeletonBox
            width={lw} height={11} radius={4}
            baseColor={L.base} shimmerColor={L.shimmer}
            style={st.labelGap}
          />
          <SkeletonBox
            width="100%" height={48}
            baseColor={L.base} shimmerColor={L.shimmer}
          />
        </View>
      ))}

      {/* Scan input row */}
      <View style={st.fieldGroup}>
        <SkeletonBox
          width={80} height={11} radius={4}
          baseColor={L.base} shimmerColor={L.shimmer}
          style={st.labelGap}
        />
        <SkeletonBox
          width="100%" height={48}
          baseColor={L.base} shimmerColor={L.shimmer}
        />
        <SkeletonBox
          width={170} height={9} radius={3}
          baseColor={L.base} shimmerColor={L.shimmer}
          style={st.hintGap}
        />
      </View>
    </View>
  );
}

// ─── DashboardSkeleton ────────────────────────────────────────────────────────
// Each shape uses the EXACT colour of its corresponding real card so when
// the crossfade fires the visual weight of the screen doesn't shift at all.

export function DashboardSkeleton() {
  return (
    <View style={st.dashWrap}>

      {/* Hero — dark green, same as s.hero */}
      <DarkBox
        width="100%" height={152} radius={16}
        color={D.hero}
        style={st.gap}
      />

      {/* Received + Graded side-by-side tiles */}
      <View style={st.row}>
        <DarkBox width="48.5%" height={100} radius={12} color={D.blue} />
        <DarkBox width="48.5%" height={100} radius={12} color={D.stone} />
      </View>

      {/* Rejects tile */}
      <DarkBox
        width="100%" height={96} radius={12}
        color={D.red}
        style={st.gap}
      />

      {/* Variance / GH breakdown — white-ish cards */}
      <SkeletonBox
        width="100%" height={110} radius={12}
        baseColor={D.card} shimmerColor={D.shimmerLight}
        style={st.gap}
      />
      <SkeletonBox
        width="100%" height={140} radius={12}
        baseColor={D.card} shimmerColor={D.shimmerLight}
      />

    </View>
  );
}

const st = StyleSheet.create({
  formWrap: {
    padding:       spacing.lg,
    paddingBottom: spacing.xxl,
  },
  fieldGroup: {
    marginBottom: spacing.lg,
  },
  labelGap: {
    marginBottom: spacing.sm,
  },
  hintGap: {
    marginTop: spacing.xs,
  },
  dashWrap: {
    padding:       spacing.lg,
    paddingBottom: spacing.xxl,
  },
  row: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    marginBottom:   spacing.md,
  },
  gap: {
    marginBottom: spacing.md,
  },
});
