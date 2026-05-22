import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useApp } from '../../context/AppContext';
import Dropdown, { DropdownOption } from '../../components/Dropdown';
import { getCachedGreenhouses } from '../../utils/greenhouse-cache';
import {
  listProductionTasks,
  setProductionTaskStatus,
  getEmployeeForUser,
} from '../../services/api';
import { Greenhouse, ProductionTaskRow } from '../../types';
import {
  colors,
  fontFamily,
  fontSize,
  spacing,
  borderRadius,
  shadow,
} from '../../theme';

type Scope = 'greenhouse' | 'all' | 'mine';

function pad(n: number): string { return String(n).padStart(2, '0'); }
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
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
function weekLabel(monday: Date): string {
  const sunday = addDays(monday, 6);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (monday.getMonth() === sunday.getMonth()) {
    return `${monday.getDate()}–${sunday.getDate()} ${months[monday.getMonth()]}`;
  }
  return `${monday.getDate()} ${months[monday.getMonth()]} – ${sunday.getDate()} ${months[sunday.getMonth()]}`;
}

export default function TasksScreen() {
  const { isConnected, userEmail } = useApp();

  const [scope, setScope] = useState<Scope>('greenhouse');
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [tasks, setTasks] = useState<ProductionTaskRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [greenhouses, setGreenhouses] = useState<Greenhouse[]>([]);
  const [greenhouse, setGreenhouse] = useState('');
  const [myEmployee, setMyEmployee] = useState<{ name: string; employee_name: string } | null>(null);

  const planPeriod = useMemo(
    () => `${weekStart.getFullYear()}-W${pad(isoWeekNumber(weekStart))}`,
    [weekStart]
  );

  useEffect(() => {
    getCachedGreenhouses().then(setGreenhouses).catch(() => {});
  }, []);

  useEffect(() => {
    if (!userEmail) return;
    getEmployeeForUser(userEmail).then(setMyEmployee);
  }, [userEmail]);

  const greenhouseOptions: DropdownOption[] = greenhouses.map((gh) => ({
    label: gh.warehouse_name || gh.name,
    value: gh.name,
  }));
  const selectedGH = greenhouses.find((g) => g.name === greenhouse);
  const sectionEmployeeName = useMemo(() => {
    const map = new Map<string, string>();
    if (selectedGH) {
      for (const sec of selectedGH.custom_sections ?? []) {
        if (sec.section_name && sec.employee_name) {
          map.set(sec.section_name, sec.employee_name);
        }
      }
    }
    return map;
  }, [selectedGH]);

  const load = useCallback(async () => {
    if (!isConnected) return;
    if (scope === 'greenhouse' && !greenhouse) {
      setTasks([]);
      return;
    }
    if (scope === 'mine' && !myEmployee?.name) {
      setTasks([]);
      return;
    }
    setLoading(true);
    try {
      const assignee = scope === 'mine' ? myEmployee?.name : undefined;
      const gh = scope === 'greenhouse' ? greenhouse : undefined;
      setTasks(await listProductionTasks(planPeriod, assignee, gh));
    } catch {
      setTasks([]);
    }
    setLoading(false);
  }, [isConnected, scope, planPeriod, myEmployee?.name, greenhouse]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleStatus = async (t: ProductionTaskRow) => {
    if (updatingId) return;
    const next: 'Pending' | 'Done' = t.status === 'Done' ? 'Pending' : 'Done';
    setUpdatingId(t.name);
    try {
      await setProductionTaskStatus(t.name, next);
      setTasks((prev) =>
        prev.map((row) =>
          row.name === t.name
            ? { ...row, status: next, completed_on: next === 'Done' ? new Date().toISOString() : undefined }
            : row
        )
      );
    } catch {}
    setUpdatingId(null);
  };

  const grouped = useMemo(() => {
    const map = new Map<string, ProductionTaskRow[]>();
    for (const t of tasks) {
      let key: string;
      if (scope === 'greenhouse') {
        key = t.section || 'No section';
      } else if (scope === 'mine') {
        key = t.greenhouse || 'Unknown greenhouse';
      } else {
        key = `${t.greenhouse} · ${t.section || 'No section'}`;
      }
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [tasks, scope]);

  const pending = tasks.filter((t) => t.status !== 'Done').length;
  const done = tasks.length - pending;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
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
          <Text style={styles.weekLabel}>{weekLabel(weekStart)}</Text>
          <Text style={styles.weekSub}>{planPeriod}</Text>
        </View>
        <TouchableOpacity
          style={styles.weekArrow}
          onPress={() => setWeekStart(addDays(weekStart, 7))}
          hitSlop={10}
        >
          <Ionicons name="chevron-forward" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.segmented}>
        {([
          { key: 'greenhouse' as Scope, label: 'By greenhouse' },
          { key: 'all' as Scope, label: 'All' },
          { key: 'mine' as Scope, label: 'Mine' },
        ]).map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[styles.segItem, scope === opt.key && styles.segItemActive]}
            onPress={() => setScope(opt.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.segText, scope === opt.key && styles.segTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {scope === 'greenhouse' && (
        <View style={styles.ghPickerWrap}>
          <Dropdown
            value={greenhouse}
            options={greenhouseOptions}
            placeholder="Select greenhouse to see tasks"
            onSelect={setGreenhouse}
            searchable
          />
        </View>
      )}

      <View style={styles.summary}>
        <View style={styles.summaryCell}>
          <Text style={styles.summaryValue}>{pending}</Text>
          <Text style={styles.summaryLabel}>pending</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryCell}>
          <Text style={[styles.summaryValue, { color: colors.success }]}>{done}</Text>
          <Text style={styles.summaryLabel}>done</Text>
        </View>
      </View>

      {scope === 'mine' && !myEmployee && (
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            Your user isn't linked to an Employee record. Use "By greenhouse" or "All".
          </Text>
        </View>
      )}

      {scope === 'greenhouse' && !greenhouse ? (
        <Text style={styles.emptyText}>Pick a greenhouse above to see its tasks</Text>
      ) : loading && tasks.length === 0 ? (
        <ActivityIndicator color={colors.textMuted} style={{ marginTop: spacing.xl }} />
      ) : tasks.length === 0 ? (
        <Text style={styles.emptyText}>
          {scope === 'mine'
            ? 'No tasks assigned to you this week'
            : 'No tasks for this week'}
        </Text>
      ) : (
        grouped.map(([groupKey, groupTasks]) => {
          const employeeName =
            scope === 'greenhouse' ? sectionEmployeeName.get(groupKey) : undefined;
          return (
            <View key={groupKey} style={styles.group}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupHeading}>{groupKey}</Text>
                {employeeName && (
                  <Text style={styles.groupSubhead}>· {employeeName}</Text>
                )}
              </View>
              {groupTasks.map((t) => {
                const isDone = t.status === 'Done';
                return (
                  <TouchableOpacity
                    key={t.name}
                    style={[styles.taskCard, isDone && styles.taskCardDone]}
                    onPress={() => toggleStatus(t)}
                    activeOpacity={0.7}
                    disabled={updatingId === t.name}
                  >
                    <View style={[styles.checkbox, isDone && styles.checkboxDone]}>
                      {updatingId === t.name ? (
                        <ActivityIndicator size="small" color={colors.text} />
                      ) : isDone ? (
                        <Ionicons name="checkmark" size={14} color={colors.textOnPrimary} />
                      ) : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.taskTitle, isDone && styles.taskTitleDone]}>
                        {t.task_name}
                      </Text>
                      <View style={styles.taskMetaRow}>
                        {scope === 'mine' && t.section && (
                          <Text style={styles.taskMeta}>{t.greenhouse} · {t.section}</Text>
                        )}
                        {scope === 'all' && t.assignee_name && (
                          <Text style={styles.taskMeta}>{t.assignee_name}</Text>
                        )}
                        {t.target ? (
                          <Text style={styles.taskTarget}>target {t.target}</Text>
                        ) : null}
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },

  weekHeader: {
    flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md,
  },
  weekArrow: {
    width: 36, height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  weekLabel: { fontFamily: fontFamily.bold, fontSize: fontSize.lg, color: colors.text },
  weekSub: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },

  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.full,
    padding: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
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

  ghPickerWrap: { marginBottom: spacing.md },

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
    fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2,
  },

  warning: {
    padding: spacing.md, borderRadius: borderRadius.md,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    marginBottom: spacing.lg,
  },
  warningText: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.text, lineHeight: 18,
  },

  group: { marginBottom: spacing.lg },
  groupHeader: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, marginBottom: spacing.sm },
  groupHeading: {
    fontFamily: fontFamily.semiBold, fontSize: fontSize.xs,
    color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  groupSubhead: {
    fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textSecondary,
  },

  taskCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm, gap: spacing.md,
    ...shadow.sm,
  },
  taskCardDone: { backgroundColor: colors.surfaceAlt, opacity: 0.7 },
  checkbox: {
    width: 22, height: 22,
    borderRadius: borderRadius.sm,
    borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxDone: { backgroundColor: colors.primary, borderColor: colors.primary },

  taskTitle: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: colors.text },
  taskTitleDone: { textDecorationLine: 'line-through', color: colors.textMuted },
  taskMetaRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2, flexWrap: 'wrap',
  },
  taskMeta: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },
  taskTarget: {
    fontFamily: fontFamily.medium, fontSize: fontSize.xs, color: colors.textSecondary,
    paddingHorizontal: spacing.xs, paddingVertical: 1,
    backgroundColor: colors.surfaceAlt, borderRadius: borderRadius.sm,
  },

  emptyText: {
    fontFamily: fontFamily.regular, fontSize: fontSize.sm,
    color: colors.textMuted, paddingVertical: spacing.xl, textAlign: 'center',
  },
});
