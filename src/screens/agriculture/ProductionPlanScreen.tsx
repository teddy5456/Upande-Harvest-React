import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useApp } from '../../context/AppContext';
import { getCachedGreenhouses } from '../../utils/greenhouse-cache';
import Dropdown, { DropdownOption } from '../../components/Dropdown';
import {
  createProductionPlanForm,
  listProductionPlanForms,
  getProductionPlanForm,
  listActualHarvest,
} from '../../services/api';
import {
  Greenhouse,
  ProductionPlanDay,
  ProductionPlanTask,
  ProductionPlanListEntry,
  ActualHarvestRecord,
  stripStemLength,
} from '../../types';
import {
  colors,
  fontFamily,
  fontSize,
  spacing,
  borderRadius,
  shadow,
} from '../../theme';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TOTAL_KEY = '__total__';

type ViewMode = 'edit' | 'compare';
type GhMode = 'total' | 'variety';
type Week = string[];

interface VarietyTargets {
  [variety: string]: Week;
}
interface TaskDraft {
  id: string;
  task_name: string;
  section: string;
  target: string;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function getMonday(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay();
  out.setDate(out.getDate() + (day === 0 ? -6 : 1 - day));
  out.setHours(0, 0, 0, 0);
  return out;
}
function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}
function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
}
function weekRangeLabel(monday: Date): string {
  const sunday = addDays(monday, 6);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (monday.getMonth() === sunday.getMonth()) {
    return `${monday.getDate()}–${sunday.getDate()} ${months[monday.getMonth()]}`;
  }
  return `${monday.getDate()} ${months[monday.getMonth()]} – ${sunday.getDate()} ${months[sunday.getMonth()]}`;
}
function emptyWeek(): Week { return ['','','','','','',''] }
function newTask(): TaskDraft {
  return { id: `${Date.now()}-${Math.random()}`, task_name: '', section: '', target: '' };
}

function sumWeek(w: Week | undefined): number {
  if (!w) return 0;
  return w.reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
}

export default function ProductionPlanScreen() {
  const { isConnected } = useApp();

  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [viewMode, setViewMode] = useState<ViewMode>('edit');

  const [greenhouses, setGreenhouses] = useState<Greenhouse[]>([]);
  const [loadingGH, setLoadingGH] = useState(false);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [ghModes, setGhModes] = useState<Record<string, GhMode>>({});
  // targets[gh][variety|TOTAL_KEY] = Week
  const [targets, setTargets] = useState<Record<string, VarietyTargets>>({});
  const [tasks, setTasks] = useState<Record<string, TaskDraft[]>>({});

  const [existingPlans, setExistingPlans] = useState<ProductionPlanListEntry[]>([]);
  const [actuals, setActuals] = useState<ActualHarvestRecord[]>([]);
  const [savedDays, setSavedDays] = useState<Record<string, ProductionPlanDay[]>>({});

  const [saving, setSaving] = useState(false);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [feedback, setFeedback] = useState<
    { type: 'success' | 'error'; text: string } | null
  >(null);

  const weekDates = useMemo(
    () => DAY_LABELS.map((_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const planPeriod = useMemo(
    () => `${weekStart.getFullYear()}-W${pad(isoWeekNumber(weekStart))}`,
    [weekStart]
  );

  useEffect(() => {
    setLoadingGH(true);
    getCachedGreenhouses()
      .then(setGreenhouses)
      .catch(() => {})
      .finally(() => setLoadingGH(false));
  }, []);

  const loadExisting = useCallback(async () => {
    if (!isConnected) return;
    try {
      setExistingPlans(await listProductionPlanForms(undefined, 100));
    } catch {
      setExistingPlans([]);
    }
  }, [isConnected]);

  useFocusEffect(useCallback(() => { loadExisting(); }, [loadExisting]));

  const existingThisWeek = useMemo(
    () => existingPlans.filter((p) => p.plan_period === planPeriod),
    [existingPlans, planPeriod]
  );
  const planExistsFor = (gh: string) =>
    existingThisWeek.some((p) => p.greenhouse === gh);

  // Compare mode: fetch actuals + saved plans for the current week
  useEffect(() => {
    if (viewMode !== 'compare' || !isConnected) return;
    let cancelled = false;
    (async () => {
      setLoadingCompare(true);
      try {
        const fromD = isoDate(weekDates[0]);
        const toD = isoDate(weekDates[6]);
        const [acts] = await Promise.all([
          listActualHarvest(fromD, toD),
        ]);
        if (cancelled) return;
        setActuals(acts);

        const map: Record<string, ProductionPlanDay[]> = {};
        for (const p of existingThisWeek) {
          try {
            const full = await getProductionPlanForm(p.name);
            map[p.greenhouse] = full.days;
          } catch {}
          if (cancelled) return;
        }
        if (!cancelled) setSavedDays(map);
      } finally {
        if (!cancelled) setLoadingCompare(false);
      }
    })();
    return () => { cancelled = true; };
  }, [viewMode, weekStart, isConnected, existingThisWeek.length]);

  const setCell = (gh: string, variety: string, dayIdx: number, value: string) => {
    setTargets((prev) => {
      const ghMap = { ...(prev[gh] ?? {}) };
      const week = (ghMap[variety] ?? emptyWeek()).slice();
      week[dayIdx] = value.replace(/[^0-9]/g, '');
      ghMap[variety] = week;
      return { ...prev, [gh]: ghMap };
    });
  };

  const fillWeek = (gh: string, variety: string, value: string) => {
    const clean = value.replace(/[^0-9]/g, '') || '0';
    setTargets((prev) => {
      const ghMap = { ...(prev[gh] ?? {}) };
      ghMap[variety] = Array(7).fill(clean);
      return { ...prev, [gh]: ghMap };
    });
  };
  const clearVarietyWeek = (gh: string, variety: string) => {
    setTargets((prev) => {
      const ghMap = { ...(prev[gh] ?? {}) };
      ghMap[variety] = emptyWeek();
      return { ...prev, [gh]: ghMap };
    });
  };

  const setMode = (gh: string, mode: GhMode) => {
    setGhModes((prev) => ({ ...prev, [gh]: mode }));
  };

  const addTask = (gh: string) => {
    setTasks((prev) => ({
      ...prev,
      [gh]: [...(prev[gh] ?? []), newTask()],
    }));
  };
  const updateTask = (gh: string, id: string, patch: Partial<TaskDraft>) => {
    setTasks((prev) => ({
      ...prev,
      [gh]: (prev[gh] ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  };
  const removeTask = (gh: string, id: string) => {
    setTasks((prev) => ({
      ...prev,
      [gh]: (prev[gh] ?? []).filter((t) => t.id !== id),
    }));
  };

  // ── helpers ───────────────────────────────────────────────────────────

  const ghWeekTotal = (gh: string): number => {
    const ghMap = targets[gh];
    if (!ghMap) return 0;
    const mode = ghModes[gh] ?? 'total';
    if (mode === 'total') return sumWeek(ghMap[TOTAL_KEY]);
    return Object.entries(ghMap)
      .filter(([k]) => k !== TOTAL_KEY)
      .reduce((s, [, w]) => s + sumWeek(w), 0);
  };

  const grandTotal = useMemo(
    () => greenhouses.reduce((s, gh) => s + ghWeekTotal(gh.name), 0),
    [greenhouses, targets, ghModes]
  );
  const filledCount = useMemo(
    () => greenhouses.filter((gh) => ghWeekTotal(gh.name) > 0).length,
    [greenhouses, targets, ghModes]
  );

  // Compare lookups
  const plannedForDay = (gh: string, dayIso: string, variety?: string): number => {
    const rows = savedDays[gh] ?? [];
    return rows
      .filter((r) =>
        r.plan_date === dayIso &&
        (variety ? r.variety === variety : !r.variety)
      )
      .reduce((s, r) => s + (r.target_stems || 0), 0);
  };
  const plannedForDayAny = (gh: string, dayIso: string): number => {
    const rows = savedDays[gh] ?? [];
    return rows
      .filter((r) => r.plan_date === dayIso)
      .reduce((s, r) => s + (r.target_stems || 0), 0);
  };
  const actualForDay = (gh: string, dayIso: string, variety?: string): number => {
    return actuals
      .filter((a) =>
        a.greenhouse === gh &&
        a.harvest_date === dayIso &&
        (variety ? stripStemLength(a.variety) === variety : true)
      )
      .reduce((s, a) => s + (a.quantity || 0), 0);
  };

  const canSave =
    viewMode === 'edit' && filledCount > 0 && !saving && isConnected;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setFeedback(null);

    let okCount = 0;
    let firstErr: string | null = null;

    for (const gh of greenhouses) {
      const ghTotal = ghWeekTotal(gh.name);
      const ghTasks = tasks[gh.name] ?? [];
      if (ghTotal === 0 && ghTasks.length === 0) continue;

      const mode = ghModes[gh.name] ?? 'total';
      const ghMap = targets[gh.name] ?? {};
      const days: ProductionPlanDay[] = [];

      if (mode === 'total') {
        const w = ghMap[TOTAL_KEY] ?? emptyWeek();
        w.forEach((v, i) => {
          const n = parseInt(v, 10) || 0;
          if (n > 0) {
            days.push({ plan_date: isoDate(weekDates[i]), target_stems: n });
          }
        });
      } else {
        Object.entries(ghMap)
          .filter(([k]) => k !== TOTAL_KEY)
          .forEach(([variety, w]) => {
            w.forEach((v, i) => {
              const n = parseInt(v, 10) || 0;
              if (n > 0) {
                days.push({
                  plan_date: isoDate(weekDates[i]),
                  target_stems: n,
                  variety,
                });
              }
            });
          });
      }

      const sectionAssignee = new Map<string, string>();
      for (const s of gh.custom_sections ?? []) {
        if (s.section_name && s.employee) {
          sectionAssignee.set(s.section_name, s.employee);
        }
      }
      const planTasks: ProductionPlanTask[] = ghTasks
        .filter((t) => t.task_name.trim())
        .map((t) => ({
          task_name: t.task_name.trim(),
          greenhouse: gh.name,
          section: t.section || undefined,
          target: t.target ? parseInt(t.target, 10) || undefined : undefined,
          status: 'Pending',
          assignee: t.section ? sectionAssignee.get(t.section) : undefined,
        }));

      try {
        await createProductionPlanForm({
          plan_period: planPeriod,
          greenhouse: gh.name,
          days,
          tasks: planTasks,
        });
        okCount++;
      } catch (err: any) {
        if (!firstErr) firstErr = err?.message ?? 'Failed to save';
      }
    }

    if (firstErr && okCount === 0) {
      setFeedback({ type: 'error', text: firstErr });
    } else if (firstErr) {
      setFeedback({ type: 'error', text: `Saved ${okCount}, failed: ${firstErr}` });
    } else {
      setFeedback({
        type: 'success',
        text: `Saved plan for ${okCount} greenhouse${okCount === 1 ? '' : 's'}`,
      });
      setTargets({});
      setTasks({});
      setGhModes({});
      setExpanded({});
      loadExisting();
    }
    setSaving(false);
  };

  // ── render helpers ────────────────────────────────────────────────────

  const renderEditRow = (gh: string, variety: string, week: Week) => (
    <View style={styles.editRow}>
      {DAY_LABELS.map((label, i) => (
        <View key={label} style={styles.dayCell}>
          <Text style={styles.dayLabel}>{label}</Text>
          <Text style={styles.dayDate}>{weekDates[i].getDate()}</Text>
          <TextInput
            style={styles.dayInput}
            value={week[i]}
            onChangeText={(t) => setCell(gh, variety, i, t)}
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            selectTextOnFocus
          />
        </View>
      ))}
    </View>
  );

  const renderCompareRow = (gh: string, variety?: string) => (
    <View style={styles.compareGrid}>
      {weekDates.map((d, i) => {
        const dayIso = isoDate(d);
        const planned = variety
          ? plannedForDay(gh, dayIso, variety)
          : plannedForDayAny(gh, dayIso);
        const actual = actualForDay(gh, dayIso, variety);
        const variance = actual - planned;
        const varianceColor =
          variance > 0 ? colors.success
          : variance < 0 ? colors.error
          : colors.textMuted;
        return (
          <View key={i} style={styles.compareCell}>
            <Text style={styles.dayLabel}>{DAY_LABELS[i]}</Text>
            <Text style={styles.dayDate}>{d.getDate()}</Text>
            <Text style={styles.compareValuePlan}>{planned || '—'}</Text>
            <Text style={styles.compareValueActual}>{actual || '—'}</Text>
            <Text style={[styles.compareValueVariance, { color: varianceColor }]}>
              {variance > 0 ? '+' : ''}{variance}
            </Text>
          </View>
        );
      })}
    </View>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.weekHeader}>
        <TouchableOpacity
          style={styles.weekArrow}
          onPress={() => setWeekStart(addDays(weekStart, -7))}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.weekLabel}>{weekRangeLabel(weekStart)}</Text>
          <Text style={styles.weekSub}>
            {planPeriod} · {weekStart.getFullYear()}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.weekArrow}
          onPress={() => setWeekStart(addDays(weekStart, 7))}
          hitSlop={10}
        >
          <Ionicons name="chevron-forward" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.modeBar}>
        <TouchableOpacity
          style={styles.todayBtn}
          onPress={() => setWeekStart(getMonday(new Date()))}
          activeOpacity={0.7}
        >
          <Text style={styles.todayBtnText}>This week</Text>
        </TouchableOpacity>

        <View style={styles.segmented}>
          {(['edit', 'compare'] as ViewMode[]).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.segItem, viewMode === m && styles.segItemActive]}
              onPress={() => setViewMode(m)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.segText,
                  viewMode === m && styles.segTextActive,
                ]}
              >
                {m === 'edit' ? 'Edit' : 'Compare'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {viewMode === 'edit' && (
        <View style={styles.summary}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{filledCount}</Text>
            <Text style={styles.summaryLabel}>greenhouses</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{grandTotal.toLocaleString()}</Text>
            <Text style={styles.summaryLabel}>weekly stems</Text>
          </View>
        </View>
      )}

      {viewMode === 'compare' && loadingCompare && (
        <ActivityIndicator color={colors.textMuted} style={{ marginVertical: spacing.md }} />
      )}

      {loadingGH ? (
        <ActivityIndicator color={colors.textMuted} style={{ marginTop: spacing.xl }} />
      ) : greenhouses.length === 0 ? (
        <Text style={styles.emptyText}>No greenhouses available</Text>
      ) : (
        greenhouses.map((gh) => {
          const open = !!expanded[gh.name];
          const mode = ghModes[gh.name] ?? 'total';
          const ghMap = targets[gh.name] ?? {};
          const ghTasks = tasks[gh.name] ?? [];
          const total = ghWeekTotal(gh.name);
          const hasExisting = planExistsFor(gh.name);

          const varieties: string[] = (() => {
            const seen = new Set<string>();
            const list: string[] = [];
            for (const v of gh.custom_varieties_grown ?? []) {
              const base = stripStemLength(v.variety);
              if (seen.has(base)) continue;
              seen.add(base);
              list.push(base);
            }
            return list;
          })();

          const sectionOptions: DropdownOption[] = (gh.custom_sections ?? []).map((s) => ({
            label: s.section_name + (s.employee_name ? ` · ${s.employee_name}` : ''),
            value: s.section_name,
          }));

          return (
            <View key={gh.name} style={styles.ghCard}>
              <TouchableOpacity
                style={styles.ghHeader}
                activeOpacity={0.7}
                onPress={() => setExpanded((prev) => ({ ...prev, [gh.name]: !prev[gh.name] }))}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.ghName}>{gh.warehouse_name || gh.name}</Text>
                  <View style={styles.ghMetaRow}>
                    {hasExisting && (
                      <View style={styles.pill}>
                        <Text style={styles.pillText}>plan exists</Text>
                      </View>
                    )}
                    {viewMode === 'edit' && total > 0 && (
                      <Text style={styles.ghTotal}>{total.toLocaleString()} stems</Text>
                    )}
                  </View>
                </View>
                <Ionicons
                  name={open ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.textMuted}
                />
              </TouchableOpacity>

              {open && (
                <View style={styles.ghBody}>
                  {viewMode === 'edit' ? (
                    <>
                      <View style={styles.modeRow}>
                        <Text style={styles.modeLabel}>Plan by</Text>
                        <View style={styles.miniSeg}>
                          {(['total', 'variety'] as GhMode[]).map((m) => (
                            <TouchableOpacity
                              key={m}
                              style={[styles.miniSegItem, mode === m && styles.miniSegActive]}
                              onPress={() => setMode(gh.name, m)}
                              activeOpacity={0.7}
                            >
                              <Text
                                style={[
                                  styles.miniSegText,
                                  mode === m && styles.miniSegTextActive,
                                ]}
                              >
                                {m === 'total' ? 'Greenhouse total' : 'By variety'}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>

                      {mode === 'total' ? (
                        <>
                          {renderEditRow(gh.name, TOTAL_KEY, ghMap[TOTAL_KEY] ?? emptyWeek())}
                          <View style={styles.quickActions}>
                            <TouchableOpacity
                              style={styles.quickBtn}
                              onPress={() => {
                                const w = ghMap[TOTAL_KEY] ?? emptyWeek();
                                const first = w.find((v) => parseInt(v, 10) > 0) || '0';
                                fillWeek(gh.name, TOTAL_KEY, first);
                              }}
                              activeOpacity={0.7}
                            >
                              <Ionicons name="copy-outline" size={14} color={colors.text} />
                              <Text style={styles.quickBtnText}>Fill week</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.quickBtn}
                              onPress={() => clearVarietyWeek(gh.name, TOTAL_KEY)}
                              activeOpacity={0.7}
                            >
                              <Ionicons name="close-outline" size={14} color={colors.text} />
                              <Text style={styles.quickBtnText}>Clear</Text>
                            </TouchableOpacity>
                          </View>
                        </>
                      ) : varieties.length === 0 ? (
                        <Text style={styles.emptyText}>
                          No varieties configured on this greenhouse
                        </Text>
                      ) : (
                        varieties.map((variety) => (
                          <View key={variety} style={styles.varietyBlock}>
                            <View style={styles.varietyHeader}>
                              <Text style={styles.varietyName}>{variety}</Text>
                              <Text style={styles.varietyTotal}>
                                {sumWeek(ghMap[variety])} stems
                              </Text>
                            </View>
                            {renderEditRow(gh.name, variety, ghMap[variety] ?? emptyWeek())}
                            <View style={styles.quickActions}>
                              <TouchableOpacity
                                style={styles.quickBtn}
                                onPress={() => {
                                  const w = ghMap[variety] ?? emptyWeek();
                                  const first = w.find((v) => parseInt(v, 10) > 0) || '0';
                                  fillWeek(gh.name, variety, first);
                                }}
                                activeOpacity={0.7}
                              >
                                <Ionicons name="copy-outline" size={14} color={colors.text} />
                                <Text style={styles.quickBtnText}>Fill week</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.quickBtn}
                                onPress={() => clearVarietyWeek(gh.name, variety)}
                                activeOpacity={0.7}
                              >
                                <Ionicons name="close-outline" size={14} color={colors.text} />
                                <Text style={styles.quickBtnText}>Clear</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))
                      )}

                      {/* Tasks */}
                      <View style={styles.tasksWrap}>
                        <View style={styles.tasksHeader}>
                          <Text style={styles.tasksTitle}>Tasks for sections</Text>
                          <TouchableOpacity
                            style={styles.addTaskBtn}
                            onPress={() => addTask(gh.name)}
                            activeOpacity={0.7}
                          >
                            <Ionicons name="add" size={14} color={colors.text} />
                            <Text style={styles.addTaskText}>Add task</Text>
                          </TouchableOpacity>
                        </View>
                        {ghTasks.length === 0 ? (
                          <Text style={styles.tasksEmpty}>
                            No tasks. Add jobs for section operators.
                          </Text>
                        ) : (
                          ghTasks.map((t) => (
                            <View key={t.id} style={styles.taskRow}>
                              <View style={styles.taskInputs}>
                                <TextInput
                                  style={[styles.input, { marginBottom: spacing.xs }]}
                                  value={t.task_name}
                                  onChangeText={(v) =>
                                    updateTask(gh.name, t.id, { task_name: v })
                                  }
                                  placeholder="What needs doing? (e.g. Deadhead bed 12)"
                                  placeholderTextColor={colors.textMuted}
                                />
                                <View style={styles.taskGrid}>
                                  <View style={{ flex: 2 }}>
                                    {sectionOptions.length > 0 ? (
                                      <Dropdown
                                        value={t.section}
                                        options={sectionOptions}
                                        placeholder="Section"
                                        onSelect={(v) =>
                                          updateTask(gh.name, t.id, { section: v })
                                        }
                                      />
                                    ) : (
                                      <TextInput
                                        style={styles.input}
                                        value={t.section}
                                        onChangeText={(v) =>
                                          updateTask(gh.name, t.id, { section: v })
                                        }
                                        placeholder="Section"
                                        placeholderTextColor={colors.textMuted}
                                      />
                                    )}
                                  </View>
                                  <TextInput
                                    style={[styles.input, { flex: 1 }]}
                                    value={t.target}
                                    onChangeText={(v) =>
                                      updateTask(gh.name, t.id, {
                                        target: v.replace(/[^0-9]/g, ''),
                                      })
                                    }
                                    placeholder="Target"
                                    placeholderTextColor={colors.textMuted}
                                    keyboardType="number-pad"
                                  />
                                </View>
                              </View>
                              <TouchableOpacity
                                style={styles.taskDel}
                                onPress={() => removeTask(gh.name, t.id)}
                                hitSlop={8}
                              >
                                <Ionicons name="trash-outline" size={16} color={colors.error} />
                              </TouchableOpacity>
                            </View>
                          ))
                        )}
                      </View>
                    </>
                  ) : (
                    <>
                      <View style={styles.compareLegend}>
                        <Text style={[styles.legendItem, { color: colors.textSecondary }]}>
                          plan
                        </Text>
                        <Text style={[styles.legendItem, { color: colors.text }]}>
                          actual
                        </Text>
                        <Text style={[styles.legendItem, { color: colors.textMuted }]}>
                          variance
                        </Text>
                      </View>
                      {renderCompareRow(gh.name)}
                      {varieties.length > 0 && (savedDays[gh.name]?.some((d) => d.variety)) && (
                        <View style={styles.byVarietyCompare}>
                          <Text style={styles.tasksTitle}>By variety</Text>
                          {varieties.map((variety) => {
                            const hasPlan = (savedDays[gh.name] ?? []).some(
                              (d) => d.variety === variety
                            );
                            const hasActual = actuals.some(
                              (a) =>
                                a.greenhouse === gh.name &&
                                stripStemLength(a.variety) === variety
                            );
                            if (!hasPlan && !hasActual) return null;
                            return (
                              <View key={variety} style={styles.varietyBlock}>
                                <Text style={styles.varietyName}>{variety}</Text>
                                {renderCompareRow(gh.name, variety)}
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </>
                  )}
                </View>
              )}
            </View>
          );
        })
      )}

      {feedback && (
        <View
          style={[
            styles.feedback,
            feedback.type === 'success' ? styles.feedbackOk : styles.feedbackErr,
          ]}
        >
          <Text style={styles.feedbackText}>{feedback.text}</Text>
        </View>
      )}

      {viewMode === 'edit' && (
        <TouchableOpacity
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          disabled={!canSave}
          onPress={handleSave}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.saveBtnText}>
              Save plan ({filledCount} greenhouse{filledCount === 1 ? '' : 's'})
            </Text>
          )}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },

  weekHeader: {
    flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs,
  },
  weekArrow: {
    width: 36, height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  weekLabel: { fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: colors.text },
  weekSub: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs,
    color: colors.textMuted, marginTop: 2,
  },

  modeBar: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg, marginTop: spacing.sm,
  },
  todayBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: borderRadius.full, backgroundColor: colors.surfaceAlt,
  },
  todayBtnText: {
    fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textSecondary,
  },
  segmented: {
    flexDirection: 'row', backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.full, padding: 2,
  },
  segItem: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  segItemActive: { backgroundColor: colors.primary },
  segText: {
    fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textSecondary,
  },
  segTextActive: { color: colors.textOnPrimary },

  summary: {
    flexDirection: 'row',
    backgroundColor: colors.surface, borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    paddingVertical: spacing.md, marginBottom: spacing.lg,
    ...shadow.sm,
  },
  summaryCell: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  summaryValue: { fontFamily: fontFamily.bold, fontSize: fontSize.xl, color: colors.text },
  summaryLabel: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs,
    color: colors.textMuted, marginTop: 2,
  },

  ghCard: {
    backgroundColor: colors.surface, borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    marginBottom: spacing.md, overflow: 'hidden', ...shadow.sm,
  },
  ghHeader: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  ghName: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text },
  ghMetaRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4,
  },
  ghTotal: {
    fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textSecondary,
  },
  pill: {
    paddingHorizontal: spacing.sm, paddingVertical: 2,
    borderRadius: borderRadius.full, backgroundColor: colors.surfaceAlt,
  },
  pillText: {
    fontFamily: fontFamily.medium, fontSize: 10, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  ghBody: {
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },

  modeRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  modeLabel: {
    fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textMuted,
  },
  miniSeg: {
    flexDirection: 'row', backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.full, padding: 2,
  },
  miniSegItem: {
    paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: borderRadius.full,
  },
  miniSegActive: { backgroundColor: colors.primary },
  miniSegText: {
    fontFamily: fontFamily.medium, fontSize: 11, color: colors.textSecondary,
  },
  miniSegTextActive: { color: colors.textOnPrimary },

  editRow: { flexDirection: 'row', gap: spacing.xs },
  dayCell: { flex: 1, alignItems: 'center', paddingVertical: spacing.xs },
  dayLabel: {
    fontFamily: fontFamily.medium, fontSize: 10,
    color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  dayDate: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.xs,
    color: colors.textSecondary, marginBottom: spacing.xs,
  },
  dayInput: {
    width: '100%', backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.sm, paddingVertical: spacing.xs,
    fontFamily: fontFamily.semiBold, fontSize: fontSize.sm,
    color: colors.text, textAlign: 'center',
  },

  varietyBlock: { marginTop: spacing.md },
  varietyHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: spacing.xs,
  },
  varietyName: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.xs, color: colors.text,
  },
  varietyTotal: {
    fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textMuted,
  },

  quickActions: {
    flexDirection: 'row', width: '100%',
    justifyContent: 'flex-end', gap: spacing.sm,
    marginTop: spacing.sm,
  },
  quickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm, backgroundColor: colors.surfaceAlt,
  },
  quickBtnText: {
    fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.text,
  },

  tasksWrap: {
    marginTop: spacing.lg, paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  tasksHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: spacing.sm,
  },
  tasksTitle: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text,
  },
  addTaskBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm, backgroundColor: colors.surfaceAlt,
  },
  addTaskText: {
    fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.text,
  },
  tasksEmpty: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs,
    color: colors.textMuted, paddingVertical: spacing.sm,
  },
  taskRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.sm },
  taskInputs: { flex: 1 },
  taskGrid: { flexDirection: 'row', gap: spacing.sm },
  taskDel: { padding: spacing.sm, marginLeft: spacing.xs },
  input: {
    backgroundColor: colors.surfaceAlt, borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.text,
  },

  compareLegend: {
    flexDirection: 'row', justifyContent: 'flex-end',
    gap: spacing.md, marginBottom: spacing.xs,
  },
  legendItem: {
    fontFamily: fontFamily.medium, fontSize: 10,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  compareGrid: { flexDirection: 'row', gap: spacing.xs },
  compareCell: { flex: 1, alignItems: 'center', paddingVertical: spacing.xs },
  compareValuePlan: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs,
    color: colors.textSecondary, marginTop: 2,
  },
  compareValueActual: {
    fontFamily: fontFamily.bold, fontSize: fontSize.sm, color: colors.text,
  },
  compareValueVariance: {
    fontFamily: fontFamily.medium, fontSize: 10, marginTop: 2,
  },
  byVarietyCompare: {
    marginTop: spacing.md, paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },

  feedback: {
    padding: spacing.md, borderRadius: borderRadius.md, marginTop: spacing.md,
  },
  feedbackOk: { backgroundColor: 'rgba(34, 197, 94, 0.12)' },
  feedbackErr: { backgroundColor: 'rgba(239, 68, 68, 0.12)' },
  feedbackText: {
    fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.text,
  },

  saveBtn: {
    backgroundColor: colors.primary, paddingVertical: spacing.md,
    borderRadius: borderRadius.md, alignItems: 'center', marginTop: spacing.lg,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.textOnPrimary,
  },

  emptyText: {
    fontFamily: fontFamily.regular, fontSize: fontSize.sm,
    color: colors.textMuted, paddingVertical: spacing.lg, textAlign: 'center',
  },
});
