import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScanInput from '../components/ScanInput';
import QRScanner from '../components/QRScanner';
import Dropdown, { DropdownOption } from '../components/Dropdown';
import {
  traceItemJourney,
  applyJourneyCorrection,
  verifySupervisorCredentials,
  fetchVarieties,
  fetchGreenhouses,
  JourneyTrace,
  JourneyEvent,
  JourneyEditable,
  JourneyLink,
} from '../services/api';
import { colors, fontFamily, fontSize, spacing, borderRadius, shadow } from '../theme';
import { onScanSuccess, lightHaptic } from '../utils/feedback';

// ─────────────────────────────────────────────────────────────────────────
// The journey spine. Colour lives ONLY in the 10px stage nodes and their
// icons — everything around stays the app's monochrome so the timeline
// reads as the same design, elevated. One accent per lifecycle stage.
// ─────────────────────────────────────────────────────────────────────────
const STAGE: Record<string, { color: string; icon: keyof typeof Ionicons.glyphMap; }> = {
  harvested:  { color: '#22C55E', icon: 'leaf' },
  received:   { color: '#0EA5E9', icon: 'download' },
  shelved:    { color: '#8B5CF6', icon: 'grid' },
  stored:     { color: '#06B6D4', icon: 'snow' },
  drained:    { color: '#06B6D4', icon: 'water' },
  issued:     { color: '#F59E0B', icon: 'paper-plane' },
  returned:   { color: '#F59E0B', icon: 'return-down-back' },
  graded:     { color: '#EC4899', icon: 'clipboard' },
  packed:     { color: '#171717', icon: 'cube' },
  dispatched: { color: '#16A34A', icon: 'airplane' },
  rejected:   { color: '#EF4444', icon: 'close-circle' },
};

const ENTITY_META: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  bucket:      { label: 'Bucket',      icon: 'flask-outline' },
  bunch:       { label: 'Bunch',       icon: 'rose-outline' },
  storage_box: { label: 'Storage box', icon: 'snow-outline' },
  pack_box:    { label: 'Pack box',    icon: 'cube-outline' },
  shelf:       { label: 'Shelf',       icon: 'grid-outline' },
  opl:         { label: 'Pick list',   icon: 'list-outline' },
};

function stageOf(stage: string) {
  return STAGE[stage] ?? { color: colors.textMuted, icon: 'ellipse' as const };
}

/** "3d 4h ago" / "2h 15m ago" from a server timestamp. */
function relativeAge(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts.replace(' ', 'T'));
  if (isNaN(d.getTime())) return '';
  let mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  const days = Math.floor(mins / 1440);
  mins -= days * 1440;
  const hours = Math.floor(mins / 60);
  mins -= hours * 60;
  if (days > 0) return `${days}d ${hours}h ago`;
  if (hours > 0) return `${hours}h ${mins}m ago`;
  return `${mins}m ago`;
}

/** Gap between two events, as a compact chip label ("18h on the way"). */
function gapLabel(prev: string | null, next: string | null): string | null {
  if (!prev || !next) return null;
  const a = new Date(prev.replace(' ', 'T')).getTime();
  const b = new Date(next.replace(' ', 'T')).getTime();
  if (isNaN(a) || isNaN(b) || b <= a) return null;
  let mins = Math.floor((b - a) / 60000);
  if (mins < 1) return null;
  const days = Math.floor(mins / 1440);
  mins -= days * 1440;
  const hours = Math.floor(mins / 60);
  mins -= hours * 60;
  if (days > 0) return `${days}d ${hours}h later`;
  if (hours > 0) return `${hours}h ${mins}m later`;
  return `${mins}m later`;
}

function formatTs(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts.replace(' ', 'T'));
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// ── Pulsing halo on the current (last) stage node ──────────────────────────
function PulsingNode({ color }: { color: string }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={styles.nodeWrap}>
      <Animated.View
        style={[
          styles.nodeHalo,
          {
            backgroundColor: color,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
          },
        ]}
      />
      <View style={[styles.node, { backgroundColor: color }]} />
    </View>
  );
}

// ── One timeline row, entrance-animated ─────────────────────────────────────
function TimelineRow({
  event, prevTs, isLast, index,
}: {
  event: JourneyEvent; prevTs: string | null; isLast: boolean; index: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 320,
      delay: Math.min(index, 8) * 70,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim, index]);

  const s = stageOf(event.stage);
  const gap = gapLabel(prevTs, event.ts);

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
      }}
    >
      {gap && (
        <View style={styles.gapRow}>
          <View style={styles.gapLine} />
          <Text style={styles.gapText}>{gap}</Text>
        </View>
      )}
      <View style={styles.eventRow}>
        <View style={styles.spineCol}>
          {isLast
            ? <PulsingNode color={s.color} />
            : <View style={styles.nodeWrap}><View style={[styles.node, { backgroundColor: s.color }]} /></View>}
          {!isLast && <View style={styles.spineLine} />}
        </View>
        <View style={[styles.eventCard, isLast && styles.eventCardCurrent]}>
          <View style={styles.eventHead}>
            <Ionicons name={s.icon} size={14} color={s.color} />
            <Text style={styles.eventTitle}>{event.title}</Text>
            {isLast && <View style={styles.nowPill}><Text style={styles.nowPillText}>LATEST</Text></View>}
          </View>
          {!!event.detail && <Text style={styles.eventDetail}>{event.detail}</Text>}
          <Text style={styles.eventTime}>
            {formatTs(event.ts)}{event.ts ? `  ·  ${relativeAge(event.ts)}` : ''}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

export default function JourneyScreen() {
  const [trace, setTrace] = useState<JourneyTrace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrevious, setShowPrevious] = useState(false);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [staged, setStaged] = useState<Record<string, string | number>>({});
  const [relocateFor, setRelocateFor] = useState<JourneyEditable | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [supEmail, setSupEmail] = useState('');
  const [supPwd, setSupPwd] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string[] | null>(null);
  // Bucket corrections: new harvest cycle, or rewrite the last one.
  const [mode, setMode] = useState<'new_cycle' | 'amend'>('amend');

  // Option lists, lazily fetched when edit mode first opens
  const [varietyOptions, setVarietyOptions] = useState<DropdownOption[]>([]);
  const [greenhouseOptions, setGreenhouseOptions] = useState<DropdownOption[]>([]);
  const optionsLoaded = useRef(false);

  const resetEdit = useCallback(() => {
    setEditing(false);
    setStaged({});
    setReviewOpen(false);
    setSupEmail('');
    setSupPwd('');
    setApplyError(null);
  }, []);

  const runTrace = useCallback(async (code: string) => {
    setLoading(true);
    setError(null);
    setApplied(null);
    setShowPrevious(false);
    resetEdit();
    try {
      const t = await traceItemJourney(code);
      setTrace(t);
      lightHaptic();
    } catch (e: any) {
      setError(e?.message || 'Lookup failed');
      setTrace(null);
    } finally {
      setLoading(false);
    }
  }, [resetEdit]);

  const openEdit = useCallback(async () => {
    setEditing(true);
    // Preselect what the server says is sane for this bucket's state, but leave
    // the operator holding the decision.
    const modes = trace?.correction_modes || [];
    setMode((modes.find(m => m.default)?.key) || 'amend');
    if (optionsLoaded.current) return;
    optionsLoaded.current = true;
    try {
      const [v, g] = await Promise.all([fetchVarieties(), fetchGreenhouses()]);
      setVarietyOptions((v.items || []).map(i => ({ label: i.item_code, value: i.item_code })));
      setGreenhouseOptions((g.greenhouses || []).map(gh => ({
        label: gh.warehouse_name || gh.name, value: gh.name,
      })));
    } catch {
      // Dropdowns degrade to empty; text fields still work
    }
  }, [trace]);

  const stage = useCallback((key: string, value: string | number) => {
    setStaged(prev => {
      const next = { ...prev };
      const field = trace?.editable.find(f => f.key === key);
      if (field && String(field.current) === String(value)) {
        delete next[key]; // reverted back to the original — unstage
      } else {
        next[key] = value;
      }
      return next;
    });
  }, [trace]);

  const stagedCount = Object.keys(staged).length;

  /* A new cycle needs the whole harvest, not just what the operator retyped:
     keeping the previous variety/greenhouse/cutter is a legitimate choice, and
     `stage()` unstages anything equal to the current value. So carry those
     forward explicitly and let the staged edits win. */
  const NEW_CYCLE_CARRY = ['variety', 'greenhouse', 'harvester'];
  const changesToSend = useCallback(() => {
    if (mode !== 'new_cycle') return staged;
    const carried: Record<string, string | number> = {};
    trace?.editable.forEach(f => {
      if (NEW_CYCLE_CARRY.includes(f.key) && f.current !== '' && f.current != null) {
        carried[f.key] = f.current;
      }
    });
    return { ...carried, ...staged };
  }, [mode, staged, trace]);

  // A new harvest is meaningless without a stem count; an amend is not.
  const newCycleNeedsQty = mode === 'new_cycle' && !staged.stem_qty;
  const canReview = stagedCount > 0 && !newCycleNeedsQty;

  const handleRelocateScan = useCallback((data: string) => {
    if (!relocateFor) return;
    // Destination labels may be JSON ({"shelf_id": "A2"}) or plain text
    let ident = data.trim();
    try {
      const parsed = JSON.parse(ident.split('}', 1)[0] + '}');
      ident = String(
        parsed.shelf_id ?? parsed.box_id ?? parsed.bucket_id ?? parsed.id ?? ident
      ).trim();
    } catch { /* plain text */ }
    stage(relocateFor.key, ident);
    setRelocateFor(null);
  }, [relocateFor, stage]);

  const handleApply = useCallback(async () => {
    if (!trace || stagedCount === 0) return;
    setApplying(true);
    setApplyError(null);
    try {
      // Prove the supervisor's credentials against this server first — the
      // temporary Server Script deployment can't check the password itself.
      await verifySupervisorCredentials(supEmail.trim(), supPwd);
      const res = await applyJourneyCorrection({
        code: trace.id,
        changes: changesToSend(),
        supervisorUser: supEmail.trim(),
        supervisorPwd: supPwd,
        ...(trace.correction_modes?.length ? { mode } : {}),
      });
      onScanSuccess();
      setApplied(res.applied || []);
      resetEdit();
      // Re-trace so the timeline reflects the corrected reality
      const t = await traceItemJourney(trace.id);
      setTrace(t);
    } catch (e: any) {
      setApplyError(e?.message || 'Correction failed');
    } finally {
      setApplying(false);
    }
  }, [trace, staged, stagedCount, supEmail, supPwd, mode, changesToSend, resetEdit]);

  const entity = trace ? ENTITY_META[trace.entity_type] : null;
  const age = trace?.header.harvested_at ? relativeAge(trace.header.harvested_at) : null;

  const editableByKey = useMemo(() => {
    const m: Record<string, JourneyEditable> = {};
    trace?.editable.forEach(f => { m[f.key] = f; });
    return m;
  }, [trace]);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Scan bar — always available so the next scan is one tap away */}
        <View style={styles.scanWrap}>
          <ScanInput
            placeholder="Scan or type any bucket, bunch or box code"
            scannerTitle="Scan any label to trace it"
            onScan={runTrace}
            autoFocus={!trace}
          />
        </View>

        {loading && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.text} />
            <Text style={styles.loadingText}>Tracing…</Text>
          </View>
        )}

        {!loading && error && (
          <View style={styles.errorCard}>
            <Ionicons name="help-circle-outline" size={22} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!loading && !trace && !error && (
          <View style={styles.empty}>
            <View style={styles.emptyIconRing}>
              <Ionicons name="git-branch-outline" size={40} color={colors.text} />
            </View>
            <Text style={styles.emptyTitle}>Trace anything</Text>
            <Text style={styles.emptySub}>
              Scan any label to see where it came from, who handled it and where it is now.
            </Text>
            <View style={styles.emptyChips}>
              {(['bucket', 'bunch', 'storage_box', 'pack_box', 'shelf'] as const).map(k => (
                <View key={k} style={styles.emptyChip}>
                  <Ionicons name={ENTITY_META[k].icon} size={13} color={colors.textSecondary} />
                  <Text style={styles.emptyChipText}>{ENTITY_META[k].label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {!loading && trace && (
          <>
            {/* Success banner after a correction */}
            {applied && (
              <View style={styles.appliedCard}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.appliedTitle}>Corrections applied</Text>
                  {applied.map((a, i) => (
                    <Text key={i} style={styles.appliedLine}>• {a}</Text>
                  ))}
                </View>
              </View>
            )}

            {/* Hero passport card */}
            <View style={styles.hero}>
              <View style={styles.heroTop}>
                <View style={styles.heroEyebrow}>
                  <Ionicons name={entity?.icon ?? 'help-outline'} size={13} color={colors.textSecondary} />
                  <Text style={styles.heroEyebrowText}>{entity?.label?.toUpperCase()}</Text>
                </View>
                {trace.editable.length > 0 && (
                  <TouchableOpacity
                    style={[styles.editToggle, editing && styles.editToggleOn]}
                    onPress={() => (editing ? resetEdit() : openEdit())}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={editing ? 'close' : 'pencil'}
                      size={15}
                      color={editing ? colors.textOnPrimary : colors.text}
                    />
                    <Text style={[styles.editToggleText, editing && { color: colors.textOnPrimary }]}>
                      {editing ? 'Cancel' : 'Correct'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={styles.heroId}>{trace.header.id}</Text>
              {/* An empty, unheld bucket is physically back in the field. What
                  we know about it belongs to the cycle that just ended, so say
                  "last known" rather than presenting it as its contents. */}
              {trace.header.stale && <Text style={styles.heroStaleTag}>LAST KNOWN</Text>}
              <Text style={[styles.heroTitle, trace.header.stale && styles.heroTitleStale]}>
                {trace.header.title}
              </Text>
              {!!trace.header.subtitle && (
                <Text style={styles.heroSubtitle}>{trace.header.subtitle}</Text>
              )}
              <View style={styles.heroChips}>
                <View style={styles.statusPill}>
                  <View style={styles.statusDot} />
                  <Text style={styles.statusPillText}>{trace.header.status}</Text>
                </View>
                {trace.header.stems > 0 && (
                  <View style={styles.heroChip}>
                    <Text style={styles.heroChipText}>{trace.header.stems} stems</Text>
                  </View>
                )}
                {age && (
                  <View style={styles.heroChip}>
                    <Ionicons name="time-outline" size={12} color={colors.textSecondary} />
                    <Text style={styles.heroChipText}>Harvested {age}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Edit panel */}
            {editing && (
              <View style={styles.editCard}>
                <Text style={styles.sectionTitle}>CORRECT DETAILS</Text>
                <Text style={styles.editHint}>
                  Fix what's wrong, then a supervisor signs off. Every change is logged.
                </Text>

                {/* Where the correction lands. Rewriting the last harvest also
                    re-attributes its bunches and rejects, so this is never a
                    silent default. */}
                {!!trace.correction_modes?.length && (
                  <View style={styles.modeBlock}>
                    {trace.correction_modes.map(m => {
                      const on = mode === m.key;
                      return (
                        <TouchableOpacity
                          key={m.key}
                          style={[styles.modeCard, on && styles.modeCardOn]}
                          onPress={() => setMode(m.key)}
                          activeOpacity={0.75}
                        >
                          <View style={styles.modeCardTop}>
                            <View style={[styles.modeRadio, on && styles.modeRadioOn]}>
                              {on && <View style={styles.modeRadioDot} />}
                            </View>
                            <Text style={[styles.modeCardLabel, on && styles.modeCardLabelOn]}>
                              {m.label}
                            </Text>
                          </View>
                          <Text style={styles.modeCardHint}>{m.hint}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {trace.editable.map(f => {
                  const value = staged[f.key] !== undefined ? staged[f.key] : f.current;
                  const dirty = staged[f.key] !== undefined;
                  if (f.type === 'relocate') {
                    return (
                      <View key={f.key} style={styles.fieldRow}>
                        <Text style={styles.fieldLabel}>{f.label}</Text>
                        <TouchableOpacity
                          style={[styles.relocateBtn, dirty && styles.fieldDirty]}
                          onPress={() => setRelocateFor(f)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="qr-code-outline" size={15} color={colors.text} />
                          <Text style={styles.relocateBtnText}>
                            {dirty ? `→ ${staged[f.key]}` : (f.current ? `Now: ${f.current}` : 'Scan destination')}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  }
                  if (f.type === 'select') {
                    const opts = f.options_source === 'varieties' ? varietyOptions : greenhouseOptions;
                    return (
                      <View key={f.key} style={styles.fieldRow}>
                        <Text style={styles.fieldLabel}>{f.label}</Text>
                        <View style={dirty ? styles.fieldDirty : undefined}>
                          <Dropdown
                            value={String(value ?? '')}
                            options={opts}
                            placeholder={opts.length ? `Select ${f.label.toLowerCase()}` : 'Loading options…'}
                            onSelect={v => stage(f.key, v)}
                            searchable
                          />
                        </View>
                      </View>
                    );
                  }
                  return (
                    <View key={f.key} style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>{f.label}</Text>
                      <TextInput
                        style={[styles.fieldInput, dirty && styles.fieldDirty]}
                        defaultValue={String(f.current ?? '')}
                        onChangeText={t => stage(f.key, f.type === 'number' ? t.replace(/[^0-9.]/g, '') : t)}
                        keyboardType={f.type === 'number' ? 'numeric' : 'default'}
                        autoCapitalize="none"
                        placeholder={f.label}
                        placeholderTextColor={colors.textMuted}
                      />
                    </View>
                  );
                })}
              </View>
            )}

            {/* The journey spine */}
            <Text style={styles.sectionTitle}>JOURNEY</Text>
            <View style={styles.timeline}>
              {trace.timeline.length === 0 && (
                <Text style={styles.noEvents}>No recorded events yet.</Text>
              )}
              {trace.timeline.map((ev, i) => (
                <TimelineRow
                  key={`${ev.stage}-${ev.ts}-${i}`}
                  event={ev}
                  prevTs={i > 0 ? trace.timeline[i - 1].ts : null}
                  isLast={i === trace.timeline.length - 1}
                  index={i}
                />
              ))}
            </View>

            {/* Earlier cycles (reused buckets) */}
            {trace.previous_cycles.length > 0 && (
              <>
                <TouchableOpacity
                  style={styles.prevToggle}
                  onPress={() => setShowPrevious(v => !v)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={showPrevious ? 'chevron-down' : 'chevron-forward'}
                    size={15}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.prevToggleText}>
                    Earlier journeys ({trace.previous_cycles.length})
                  </Text>
                </TouchableOpacity>
                {showPrevious && trace.previous_cycles.map((c, ci) => (
                  <View key={ci} style={styles.prevCycle}>
                    <Text style={styles.prevCycleDate}>
                      {formatTs(c.start_ts)}
                    </Text>
                    {c.events.map((ev, i) => (
                      <View key={i} style={styles.prevEventRow}>
                        <View style={[styles.prevDot, { backgroundColor: stageOf(ev.stage).color }]} />
                        <Text style={styles.prevEventText} numberOfLines={2}>
                          <Text style={{ fontFamily: fontFamily.medium }}>{ev.title}</Text>
                          {ev.detail ? ` — ${ev.detail}` : ''}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}
              </>
            )}

            {/* Related items — hop through the chain without rescanning */}
            {trace.links.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>RELATED</Text>
                <View style={styles.linksWrap}>
                  {trace.links.map((l: JourneyLink, i) => {
                    const traceable = l.type !== 'opl';
                    return (
                      <TouchableOpacity
                        key={`${l.id}-${i}`}
                        style={[styles.linkChip, !traceable && { opacity: 0.55 }]}
                        onPress={traceable ? () => runTrace(l.id) : undefined}
                        activeOpacity={0.6}
                        disabled={!traceable}
                      >
                        <Ionicons
                          name={ENTITY_META[l.type]?.icon ?? 'link-outline'}
                          size={13}
                          color={colors.textSecondary}
                        />
                        <Text style={styles.linkChipText} numberOfLines={1}>{l.label}</Text>
                        {traceable && (
                          <Ionicons name="arrow-forward" size={11} color={colors.textMuted} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {/* Correction audit trail */}
            {trace.corrections.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>PAST CORRECTIONS</Text>
                <View style={styles.auditCard}>
                  {trace.corrections.map((c, i) => (
                    <View key={i} style={styles.auditRow}>
                      <Ionicons name="shield-checkmark-outline" size={13} color={colors.textMuted} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.auditText}>{c.text.replace(/^Journey correction on \S+ /, '')}</Text>
                        <Text style={styles.auditTs}>{formatTs(c.ts)}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* Sticky review bar while edits are staged */}
      {editing && stagedCount > 0 && (
        <View style={styles.reviewBar}>
          <Text style={styles.reviewBarText}>
            {newCycleNeedsQty
              ? 'Enter the stems in the bucket'
              : mode === 'new_cycle'
                ? 'New harvest ready'
                : `${stagedCount} change${stagedCount > 1 ? 's' : ''} staged`}
          </Text>
          <TouchableOpacity
            style={[styles.reviewBtn, !canReview && { opacity: 0.4 }]}
            onPress={() => setReviewOpen(true)}
            disabled={!canReview}
            activeOpacity={0.8}
          >
            <Ionicons name="shield-checkmark" size={15} color={colors.textOnPrimary} />
            <Text style={styles.reviewBtnText}>Review & authorize</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Relocation destination scanner */}
      <QRScanner
        visible={relocateFor !== null}
        title={relocateFor?.scan_hint || 'Scan destination'}
        onScanned={handleRelocateScan}
        onClose={() => setRelocateFor(null)}
      />

      {/* Supervisor authorization sheet */}
      <Modal visible={reviewOpen} transparent animationType="fade" onRequestClose={() => setReviewOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Supervisor sign-off</Text>
              <TouchableOpacity onPress={() => setReviewOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {!!trace?.correction_modes?.length && (
              <View style={styles.modeBanner}>
                <Ionicons
                  name={mode === 'new_cycle' ? 'add-circle-outline' : 'create-outline'}
                  size={14}
                  color={colors.text}
                />
                <Text style={styles.modeBannerText}>
                  {mode === 'new_cycle'
                    ? 'Logging a NEW harvest on this bucket — history stays as recorded'
                    : 'Rewriting the LAST harvest entry on this bucket'}
                </Text>
              </View>
            )}

            <View style={styles.diffBox}>
              {trace && Object.entries(changesToSend()).map(([k, v]) => {
                const f = editableByKey[k];
                return (
                  <View key={k} style={styles.diffRow}>
                    <Text style={styles.diffField}>{f?.label ?? k}</Text>
                    <Text style={styles.diffChange} numberOfLines={1}>
                      <Text style={{ color: colors.textMuted }}>{String(f?.current || '—')}</Text>
                      {'  →  '}
                      <Text style={{ fontFamily: fontFamily.semiBold }}>{String(v)}</Text>
                    </Text>
                  </View>
                );
              })}
            </View>

            <Text style={styles.modalHint}>
              A supervisor confirms these corrections with their own login. Both names go on the record.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={supEmail}
              onChangeText={setSupEmail}
              placeholder="Supervisor email"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <TextInput
              style={styles.modalInput}
              value={supPwd}
              onChangeText={setSupPwd}
              placeholder="Supervisor password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
            />
            {applyError && <Text style={styles.modalError}>{applyError}</Text>}
            <TouchableOpacity
              style={[
                styles.modalApply,
                (applying || !supEmail.trim() || !supPwd) && { opacity: 0.4 },
              ]}
              onPress={handleApply}
              disabled={applying || !supEmail.trim() || !supPwd}
              activeOpacity={0.8}
            >
              {applying
                ? <ActivityIndicator size="small" color={colors.textOnPrimary} />
                : (
                  <>
                    <Ionicons name="checkmark" size={16} color={colors.textOnPrimary} />
                    <Text style={styles.modalApplyText}>Apply corrections</Text>
                  </>
                )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const NODE = 12;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: 120 },
  scanWrap: { marginBottom: spacing.md },
  centered: { alignItems: 'center', paddingVertical: spacing.xxl },
  loadingText: {
    fontFamily: fontFamily.regular, fontSize: fontSize.sm,
    color: colors.textMuted, marginTop: spacing.sm,
  },

  // Empty state
  empty: { alignItems: 'center', paddingTop: spacing.xxl, paddingHorizontal: spacing.xl },
  emptyIconRing: {
    width: 88, height: 88, borderRadius: 44,
    borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: colors.text },
  emptySub: {
    fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textSecondary,
    textAlign: 'center', marginTop: spacing.sm, lineHeight: 20,
  },
  emptyChips: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center',
    gap: spacing.sm, marginTop: spacing.xl,
  },
  emptyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: borderRadius.full, paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  emptyChipText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textSecondary },

  // Error
  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginTop: spacing.sm,
  },
  errorText: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.text },

  // Applied banner
  appliedCard: {
    flexDirection: 'row', gap: spacing.sm,
    backgroundColor: '#F0FDF4', borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: '#BBF7D0',
    padding: spacing.md, marginBottom: spacing.md,
  },
  appliedTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text },
  appliedLine: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },

  // Hero
  hero: {
    backgroundColor: colors.surface, borderRadius: borderRadius.lg,
    padding: spacing.lg, marginBottom: spacing.lg, ...shadow.md,
  },
  heroTop: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: spacing.sm,
  },
  heroEyebrow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroEyebrowText: {
    fontFamily: fontFamily.semiBold, fontSize: 10, letterSpacing: 1.2,
    color: colors.textSecondary,
  },
  editToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md, paddingVertical: 5,
  },
  editToggleOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  editToggleText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.text },
  heroId: {
    fontFamily: 'monospace', fontSize: fontSize.xxl, color: colors.text,
    letterSpacing: -0.5, fontWeight: '700' as const,
  },
  heroTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.lg, color: colors.text, marginTop: 2 },
  // An idle bucket's variety is history, not fact — step it back visually.
  heroTitleStale: { color: colors.textSecondary },
  heroStaleTag: {
    fontFamily: fontFamily.medium, fontSize: 9, letterSpacing: 1.2,
    color: colors.textMuted, marginTop: 6,
  },
  heroSubtitle: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
  heroChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md, paddingVertical: 5,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  statusPillText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textOnPrimary },
  heroChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.surfaceAlt, borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md, paddingVertical: 5,
  },
  heroChipText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textSecondary },

  // Section titles
  sectionTitle: {
    fontFamily: fontFamily.semiBold, fontSize: 10, letterSpacing: 1.2,
    color: colors.textMuted, marginBottom: spacing.sm, marginTop: spacing.xs,
  },

  // Edit card
  editCard: {
    backgroundColor: colors.surface, borderRadius: borderRadius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  editHint: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted,
    marginBottom: spacing.md, marginTop: -4,
  },
  // Correction-mode chooser
  modeBlock: { gap: spacing.sm, marginBottom: spacing.lg },
  modeCard: {
    borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.md,
    padding: spacing.md, backgroundColor: colors.surface,
  },
  modeCardOn: { borderColor: colors.text, backgroundColor: colors.surfaceAlt },
  modeCardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  modeRadio: {
    width: 16, height: 16, borderRadius: 8, borderWidth: 1.5,
    borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center',
  },
  modeRadioOn: { borderColor: colors.text },
  modeRadioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.text },
  modeCardLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.textSecondary },
  modeCardLabelOn: { fontFamily: fontFamily.semiBold, color: colors.text },
  modeCardHint: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted,
    marginTop: 4, marginLeft: 24, lineHeight: 15,
  },
  modeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceAlt, borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md,
  },
  modeBannerText: {
    flex: 1, fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.text,
    lineHeight: 15,
  },

  fieldRow: { marginBottom: spacing.md },
  fieldLabel: {
    fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textSecondary,
    marginBottom: 4,
  },
  fieldInput: {
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    borderRadius: borderRadius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.text,
  },
  fieldDirty: { borderColor: colors.warning, borderWidth: 1.5, borderRadius: borderRadius.sm },
  relocateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    borderRadius: borderRadius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  relocateBtnText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },

  // Timeline spine
  timeline: { marginBottom: spacing.lg },
  noEvents: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  eventRow: { flexDirection: 'row' },
  spineCol: { width: 28, alignItems: 'center' },
  nodeWrap: {
    width: 28, height: 28, justifyContent: 'center', alignItems: 'center',
    marginTop: spacing.sm,
  },
  node: {
    width: NODE, height: NODE, borderRadius: NODE / 2,
    borderWidth: 2, borderColor: colors.surface,
  },
  nodeHalo: { position: 'absolute', width: NODE + 4, height: NODE + 4, borderRadius: (NODE + 4) / 2 },
  spineLine: { flex: 1, width: 2, backgroundColor: colors.border, marginTop: -2, marginBottom: -spacing.sm },
  eventCard: {
    flex: 1, backgroundColor: colors.surface, borderRadius: borderRadius.md,
    padding: spacing.md, marginLeft: spacing.sm, marginBottom: spacing.sm,
    ...shadow.sm,
  },
  eventCardCurrent: { borderWidth: 1, borderColor: colors.text },
  eventHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eventTitle: { flex: 1, fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text },
  nowPill: {
    backgroundColor: colors.primary, borderRadius: borderRadius.sm,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  nowPillText: { fontFamily: fontFamily.semiBold, fontSize: 8, letterSpacing: 0.8, color: colors.textOnPrimary },
  eventDetail: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textSecondary,
    marginTop: 3, lineHeight: 17,
  },
  eventTime: { fontFamily: fontFamily.regular, fontSize: 10, color: colors.textMuted, marginTop: 4 },
  gapRow: { flexDirection: 'row', alignItems: 'center', marginLeft: 13, gap: spacing.sm },
  gapLine: { width: 2, height: 18, backgroundColor: colors.border },
  gapText: { fontFamily: fontFamily.regular, fontSize: 10, color: colors.textMuted, fontStyle: 'italic' },

  // Previous cycles
  prevToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: spacing.sm, marginBottom: spacing.xs,
  },
  prevToggleText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.textSecondary },
  prevCycle: {
    backgroundColor: colors.surfaceAlt, borderRadius: borderRadius.md,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  prevCycleDate: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  prevEventRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: 4 },
  prevDot: { width: 7, height: 7, borderRadius: 4, marginTop: 5 },
  prevEventText: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textSecondary },

  // Links
  linksWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  linkChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: borderRadius.full, paddingHorizontal: spacing.md, paddingVertical: 7,
    maxWidth: '100%',
  },
  linkChipText: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.text, flexShrink: 1 },

  // Audit
  auditCard: {
    backgroundColor: colors.surface, borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md,
    marginBottom: spacing.lg,
  },
  auditRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  auditText: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 16 },
  auditTs: { fontFamily: fontFamily.regular, fontSize: 10, color: colors.textMuted, marginTop: 2 },

  // Review bar
  reviewBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, ...shadow.md,
  },
  reviewBarText: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text },
  reviewBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: borderRadius.full,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2,
  },
  reviewBtnText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.textOnPrimary },

  // Supervisor modal
  modalOverlay: {
    flex: 1, backgroundColor: colors.overlay,
    justifyContent: 'center', padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface, borderRadius: borderRadius.lg, padding: spacing.lg,
  },
  modalHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: spacing.md,
  },
  modalTitle: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: colors.text },
  diffBox: {
    backgroundColor: colors.surfaceAlt, borderRadius: borderRadius.md,
    padding: spacing.md, marginBottom: spacing.md,
  },
  diffRow: { marginBottom: spacing.xs },
  diffField: { fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textSecondary },
  diffChange: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.text, marginTop: 1 },
  modalHint: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted,
    marginBottom: spacing.md, lineHeight: 17,
  },
  modalInput: {
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    borderRadius: borderRadius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.text,
    marginBottom: spacing.sm,
  },
  modalError: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.error, marginBottom: spacing.sm },
  modalApply: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: borderRadius.md,
    paddingVertical: spacing.md, marginTop: spacing.xs,
  },
  modalApplyText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.textOnPrimary },
});
