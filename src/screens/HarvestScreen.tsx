import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Modal,
  FlatList,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { addToSyncQueue } from '../database/sync-queue';
import { getFarm, getSetting, setSetting, getCachedGreenhouses, setCachedGreenhouses } from '../database/settings';
import { addHarvestEntry } from '../database/harvest';
import { submitHarvest, fetchGreenhouses, cancelHarvestEntry } from '../services/api';
import ScanInput, { ScanInputHandle } from '../components/ScanInput';
import { HarvestFormSkeleton } from '../components/Skeleton';
import ScanConfirmation from '../components/ScanConfirmation';
import EntriesLog from '../components/EntriesLog';
import { HarvestListEntry, Greenhouse, GreenhouseSection, GreenhouseVariety } from '../types';
import { onScanSuccess, onScanError } from '../utils/feedback';
import { parseScannedBucketQR } from '../utils/shelf-utils';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

interface BorrowedHarvester {
  employee_name: string;
  employee?: string; // payroll number
  greenhouse_name: string;
}

export default function HarvestScreen() {
  const { isConnected, refreshStats } = useApp();

  // Data from API / cache
  const [greenhouses, setGreenhouses] = useState<Greenhouse[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  // Shows a subtle "using cached data" badge when offline with stale data
  const [isStaleCache, setIsStaleCache] = useState(false);
  const [cacheAge, setCacheAge] = useState('');

  // Selections
  const [selectedGreenhouse, setSelectedGreenhouse] = useState<Greenhouse | null>(null);
  const [selectedSection, setSelectedSection] = useState<GreenhouseSection | null>(null);
  const [selectedVariety, setSelectedVariety] = useState<GreenhouseVariety | null>(null);
  const [selectedHarvester, setSelectedHarvester] = useState(''); // payroll number sent to API
  const [selectedHarvesterName, setSelectedHarvesterName] = useState(''); // display name
  const [quantity, setQuantity] = useState('');

  // Inline validation — tracks which fields are empty when a scan is attempted,
  // so we can highlight them with a red border instead of an Alert popup.
  const [missingFields, setMissingFields] = useState<Set<string>>(new Set());

  // Team overrides: section_name -> borrowed employees
  const [teamOverrides, setTeamOverrides] = useState<Record<string, BorrowedHarvester[]>>({});

  // Inline dropdowns
  const [ghDropdownOpen, setGhDropdownOpen] = useState(false);
  const [ghSearch, setGhSearch] = useState('');
  const [sectionDropdownOpen, setSectionDropdownOpen] = useState(false);
  const [sectionSearch, setSectionSearch] = useState('');
  const [varietyDropdownOpen, setVarietyDropdownOpen] = useState(false);
  const [varietySearch, setVarietySearch] = useState('');
  const [harvesterDropdownOpen, setHarvesterDropdownOpen] = useState(false);

  // Blur timers (so list item taps register before dropdown closes)
  const ghBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const varietyBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Quantity input → focus chain to scan input (skip tapping the scan field)
  const quantityRef = useRef<TextInput>(null);
  const scanInputRef = useRef<ScanInputHandle>(null);

  // Fade-in when the form becomes ready (skeleton → real content transition)
  const contentFade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!dataLoading) {
      Animated.timing(contentFade, { toValue: 1, duration: 280, useNativeDriver: true }).start();
    }
  }, [dataLoading, contentFade]);

  // Team modal
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [addingToSection, setAddingToSection] = useState<string | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState('');

  // Scan results
  const [entries, setEntries] = useState<HarvestListEntry[]>([]);
  const [confirmation, setConfirmation] = useState<{
    visible: boolean;
    type: 'success' | 'error';
    message: string;
  }>({ visible: false, type: 'success', message: '' });

  // Last-scans quick actions (edit qty / cancel SE) — capped at last 4
  // successful entries to keep the panel tight on a 5" handset.
  const [editingEntry, setEditingEntry] = useState<HarvestListEntry | null>(null);
  const [editQty, setEditQty] = useState('');
  const [editing, setEditing] = useState(false);
  const [deletingEntry, setDeletingEntry] = useState<string | null>(null); // stock_entry being cancelled

  const showConfirmation = (type: 'success' | 'error', message: string) => {
    setConfirmation({ visible: true, type, message });
  };

  // Computed: harvesters for selected section
  const sectionHarvesters: { employee_name: string; employee?: string; greenhouse_name: string }[] = selectedSection
    ? [
        { employee_name: selectedSection.employee_name, employee: selectedSection.employee, greenhouse_name: selectedGreenhouse?.warehouse_name ?? '' },
        ...(teamOverrides[selectedSection.section_name] ?? []),
      ]
    : [];

  // Auto-select harvester when section changes or team changes
  useEffect(() => {
    if (!selectedSection) {
      setSelectedHarvester('');
      setSelectedHarvesterName('');
      return;
    }
    const borrowed = teamOverrides[selectedSection.section_name] ?? [];
    if (borrowed.length === 0) {
      setSelectedHarvester(selectedSection.employee ?? selectedSection.employee_name);
      setSelectedHarvesterName(selectedSection.employee_name);
    } else {
      setSelectedHarvester(prev => {
        const allPayrolls = [
          selectedSection.employee ?? selectedSection.employee_name,
          ...borrowed.map(b => b.employee ?? b.employee_name),
        ];
        return allPayrolls.includes(prev) ? prev : '';
      });
      setSelectedHarvesterName(prev => {
        const all = [
          { payroll: selectedSection.employee ?? selectedSection.employee_name, name: selectedSection.employee_name },
          ...borrowed.map(b => ({ payroll: b.employee ?? b.employee_name, name: b.employee_name })),
        ];
        const current = all.find(h => h.name === prev || h.payroll === prev);
        return current ? current.name : '';
      });
    }
  }, [selectedSection, teamOverrides]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [cached, lastGhName, lastVariety] = await Promise.all([
      getCachedGreenhouses(),
      getSetting('last_greenhouse'),
      getSetting('last_variety'),
    ]);

    // Helper — apply a greenhouse list and restore the user's previous selections
    const applyGreenhouses = (ghs: Greenhouse[]) => {
      setGreenhouses(ghs);
      if (lastGhName) {
        const gh = ghs.find((g) => g.name === lastGhName);
        if (gh) {
          setSelectedGreenhouse(gh);
          if (lastVariety) {
            const v = gh.custom_varieties_grown?.find((vr) => vr.variety === lastVariety);
            if (v) setSelectedVariety(v);
          }
        }
      }
    };

    if (cached) {
      // Render immediately from cache — no spinner shown to the user
      applyGreenhouses(cached.data as Greenhouse[]);
      setDataLoading(false);

      // Show a "stale" badge if the cache is older than 5 minutes
      const ageMins = Math.floor((Date.now() - new Date(cached.cachedAt).getTime()) / 60_000);
      if (ageMins > 5) {
        setIsStaleCache(true);
        setCacheAge(ageMins > 60 ? `${Math.floor(ageMins / 60)}h ago` : `${ageMins}m ago`);
      }
    }

    // Always fetch fresh data in the background.
    // If no cache existed the spinner is still showing during this fetch.
    try {
      const res = await fetchGreenhouses();
      const ghs = res.greenhouses ?? [];
      await setCachedGreenhouses(ghs);
      // If we already rendered from cache, just silently update the list
      // (don't disrupt the user's current dropdown selection).
      if (cached) {
        setGreenhouses(ghs);
      } else {
        applyGreenhouses(ghs);
      }
      setIsStaleCache(false);
      setCacheAge('');
    } catch {
      // Network unavailable — cached data is fine; first-launch without cache
      // means the dropdowns stay empty until the user is online.
    } finally {
      setDataLoading(false);
    }
  };

  const handleSelectGreenhouse = useCallback((gh: Greenhouse) => {
    setSelectedGreenhouse(gh);
    setSelectedSection(null);
    setSelectedVariety(null);
    setSelectedHarvester('');
    setSelectedHarvesterName('');
    setTeamOverrides({});
    setGhDropdownOpen(false);
    setGhSearch('');
    setSetting('last_greenhouse', gh.name);
    setSetting('last_variety', '');
  }, []);

  const handleSelectSection = useCallback((sec: GreenhouseSection) => {
    setSelectedSection(sec);
    setSectionDropdownOpen(false);
    setSectionSearch('');
    // Auto-open variety dropdown only if variety not yet selected
    if (!selectedVariety) setTimeout(() => setVarietyDropdownOpen(true), 150);
  }, [selectedVariety]);

  const handleSelectVariety = useCallback((v: GreenhouseVariety) => {
    setSelectedVariety(v);
    setVarietyDropdownOpen(false);
    setVarietySearch('');
    setSetting('last_variety', v.variety);
    // Auto-focus quantity after variety is chosen
    setTimeout(() => quantityRef.current?.focus(), 150);
  }, []);

  const handleAddBorrowed = useCallback((section: string, emp: BorrowedHarvester) => {
    setTeamOverrides(prev => ({
      ...prev,
      [section]: [...(prev[section] ?? []), emp],
    }));
    setAddingToSection(null);
    setEmployeeSearch('');
  }, []);

  const handleRemoveBorrowed = useCallback((section: string, idx: number) => {
    setTeamOverrides(prev => {
      const updated = [...(prev[section] ?? [])];
      updated.splice(idx, 1);
      const result = { ...prev };
      if (updated.length === 0) {
        delete result[section];
      } else {
        result[section] = updated;
      }
      return result;
    });
  }, []);

  const handleBucketScanned = useCallback(
    async (data: string) => {
      const bucketId = parseScannedBucketQR(data);
      if (!bucketId) {
        onScanError();
        showConfirmation('error', 'Scan a Bucket QR — that QR is not a bucket.');
        return;
      }

      // Collect all missing fields in one pass and highlight them inline
      // rather than firing a series of Alert popups.
      const qty = parseFloat(quantity);
      const missing = new Set<string>();
      if (!selectedGreenhouse) missing.add('greenhouse');
      if (!selectedSection)    missing.add('section');
      if (!selectedHarvester)  missing.add('harvester');
      if (!selectedVariety)    missing.add('variety');
      if (!quantity.trim() || isNaN(qty) || qty <= 0) missing.add('quantity');

      if (missing.size > 0) {
        onScanError();
        setMissingFields(missing);
        return;
      }
      // Hard cap: one bucket can hold at most 130 stems. Server enforces the
      // same limit; failing fast here saves a round-trip and surfaces a
      // clearer message than the server's ValidationError.
      if (qty > 130) {
        onScanError();
        setMissingFields(new Set(['quantity']));
        showConfirmation('error', `${qty} stems exceeds the 130-stem bucket cap. Split into two buckets.`);
        return;
      }
      setMissingFields(new Set());

      const now = new Date().toLocaleTimeString();
      const farm = await getFarm();
      const section = selectedSection.section_name;
      const harvester = selectedHarvester;
      const itemCode = selectedVariety.variety;
      const gh = selectedGreenhouse.name;

      if (isConnected) {
        try {
          const response = await submitHarvest(
            itemCode, qty, section, harvester, bucketId, farm, gh
          );

          await addHarvestEntry(
            itemCode, qty, section, harvester, bucketId, farm, gh,
            response.stock_entry ?? '', true
          );

          setEntries((prev) => [{
            bucket_id: bucketId, item_code: itemCode, quantity: qty,
            time: now, status: 'success', message: response.stock_entry ?? 'Created',
            stock_entry: response.stock_entry,
            section, harvester, greenhouse: gh, farm,
          }, ...prev]);
          await refreshStats();
          onScanSuccess();
          setSelectedSection(null);
          setSelectedHarvester('');
          setSelectedHarvesterName('');
          showConfirmation('success', bucketId);
        } catch (error: any) {
          await addToSyncQueue('createHarvestEntry', {
            item_code: itemCode, quantity: qty, section, harvester,
            bucket_id: bucketId, farm, greenhouse: gh,
          });
          try {
            await addHarvestEntry(itemCode, qty, section, harvester, bucketId, farm, gh, '', false);
          } catch {}

          // If the API call failed due to a network error (as opposed to a
          // server-side validation error), treat it the same as offline:
          // show a calm "saved for sync" message rather than a red error.
          const isNetworkError =
            !error.message ||
            error.message.toLowerCase().includes('network') ||
            error.message.toLowerCase().includes('fetch') ||
            error.message.toLowerCase().includes('connect');

          setEntries((prev) => [{
            bucket_id: bucketId, item_code: itemCode, quantity: qty,
            time: now,
            status: isNetworkError ? 'queued' : 'error',
            message: isNetworkError ? 'Saved for sync' : error.message,
          }, ...prev]);
          await refreshStats();
          if (isNetworkError) {
            onScanSuccess(); // treat as success from the user's perspective
          } else {
            onScanError();
          }
          setSelectedSection(null);
          setSelectedHarvester('');
          setSelectedHarvesterName('');
          showConfirmation(
            isNetworkError ? 'queued' : 'error',
            isNetworkError ? 'Saved for sync' : error.message
          );
        }
      } else {
        await addToSyncQueue('createHarvestEntry', {
          item_code: itemCode, quantity: qty, section, harvester,
          bucket_id: bucketId, farm, greenhouse: gh,
        });
        try {
          await addHarvestEntry(itemCode, qty, section, harvester, bucketId, farm, gh, '', false);
        } catch {}

        setEntries((prev) => [{
          bucket_id: bucketId, item_code: itemCode, quantity: qty,
          time: now, status: 'queued', message: 'Saved for sync',
        }, ...prev]);
        await refreshStats();
        onScanSuccess();
        setSelectedSection(null);
        setSelectedHarvester('');
        setSelectedHarvesterName('');
        showConfirmation('queued', 'Saved for sync');
      }
    },
    [isConnected, refreshStats, selectedGreenhouse, selectedSection, selectedHarvester, selectedVariety, quantity]
  );

  // ── Recent-scans actions ────────────────────────────────────────────────
  const handleDeleteEntry = useCallback((entry: HarvestListEntry) => {
    if (!entry.stock_entry) return;
    Alert.alert(
      'Delete scan?',
      `Cancel ${entry.bucket_id} (${entry.quantity} × ${entry.item_code})? The bucket goes back to Available so it can be re-scanned.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingEntry(entry.stock_entry!);
            try {
              await cancelHarvestEntry(entry.stock_entry!);
              setEntries((prev) => prev.filter((e) => e.stock_entry !== entry.stock_entry));
              await refreshStats();
              showConfirmation('success', `${entry.bucket_id} cancelled`);
            } catch (e: any) {
              showConfirmation('error', e?.message || 'Could not cancel');
            } finally {
              setDeletingEntry(null);
            }
          },
        },
      ],
    );
  }, [refreshStats]);

  const openEditEntry = useCallback((entry: HarvestListEntry) => {
    if (!entry.stock_entry) return;
    setEditingEntry(entry);
    setEditQty(String(entry.quantity));
  }, []);

  const saveEditEntry = useCallback(async () => {
    if (!editingEntry || !editingEntry.stock_entry) return;
    const newQty = parseFloat(editQty);
    if (!editQty.trim() || isNaN(newQty) || newQty <= 0) {
      showConfirmation('error', 'Enter a valid quantity');
      return;
    }
    if (newQty === editingEntry.quantity) {
      // No-op edit — just close
      setEditingEntry(null);
      return;
    }
    if (!isConnected) {
      showConfirmation('error', 'Editing needs internet — try again when reconnected.');
      return;
    }

    setEditing(true);
    try {
      // Cancel the old SE, then re-submit with new qty. submitHarvest is
      // serialized, so the cancel ACK lands before the new entry posts.
      await cancelHarvestEntry(editingEntry.stock_entry);
      const resp = await submitHarvest(
        editingEntry.item_code,
        newQty,
        editingEntry.section || '',
        editingEntry.harvester || '',
        editingEntry.bucket_id,
        editingEntry.farm || '',
        editingEntry.greenhouse || '',
      );
      // Replace in-place — preserve list order
      setEntries((prev) => prev.map((e) =>
        e.stock_entry === editingEntry.stock_entry
          ? {
              ...e,
              quantity: newQty,
              stock_entry: resp.stock_entry,
              time: new Date().toLocaleTimeString(),
              message: resp.stock_entry,
            }
          : e
      ));
      await refreshStats();
      showConfirmation('success', `${editingEntry.bucket_id} → ${newQty}`);
      setEditingEntry(null);
    } catch (e: any) {
      showConfirmation('error', e?.message || 'Edit failed');
    } finally {
      setEditing(false);
    }
  }, [editingEntry, editQty, isConnected, refreshStats]);

  // Most recent 4 successful entries, used by the inline Recent panel
  const recentScans = useMemo(
    () => entries.filter((e) => e.status === 'success' && e.stock_entry).slice(0, 4),
    [entries],
  );

  // Lists are always sorted A→Z — the sort toggle has been removed to keep
  // the UI simple. Alphabetical is the sensible default for greenhouse names.
  const sortedGreenhouses = [...greenhouses].sort((a, b) =>
    a.warehouse_name.localeCompare(b.warehouse_name)
  );
  const filteredGreenhouses = ghSearch
    ? sortedGreenhouses.filter((g) =>
        g.warehouse_name.toLowerCase().includes(ghSearch.toLowerCase()) ||
        g.name.toLowerCase().includes(ghSearch.toLowerCase())
      )
    : sortedGreenhouses;

  const sections = selectedGreenhouse?.custom_sections ?? [];
  const filteredSections = sectionSearch
    ? [...sections]
        .sort((a, b) => a.section_name.localeCompare(b.section_name))
        .filter((s) =>
          s.section_name.toLowerCase().includes(sectionSearch.toLowerCase()) ||
          s.employee_name.toLowerCase().includes(sectionSearch.toLowerCase())
        )
    : [...sections].sort((a, b) => a.section_name.localeCompare(b.section_name));

  const varieties = selectedGreenhouse?.custom_varieties_grown ?? [];
  const filteredVarieties = varietySearch
    ? [...varieties]
        .sort((a, b) => a.variety.localeCompare(b.variety))
        .filter((v) => v.variety.toLowerCase().includes(varietySearch.toLowerCase()))
    : [...varieties].sort((a, b) => a.variety.localeCompare(b.variety));

  // Employees from OTHER greenhouses (for borrowing)
  const otherEmployees = greenhouses
    .filter((gh) => gh.name !== selectedGreenhouse?.name)
    .flatMap((gh) =>
      (gh.custom_sections ?? []).map((sec) => ({
        employee_name: sec.employee_name,
        employee: sec.employee,
        greenhouse_name: gh.warehouse_name,
      }))
    );
  const filteredOtherEmployees = employeeSearch
    ? otherEmployees.filter((e) =>
        e.employee_name.toLowerCase().includes(employeeSearch.toLowerCase()) ||
        e.greenhouse_name.toLowerCase().includes(employeeSearch.toLowerCase())
      )
    : otherEmployees;

  const totalBorrowed = Object.values(teamOverrides).flat().length;

  // First launch with no cache — show skeleton while greenhouses load.
  // Once cache exists this block never shows; data renders immediately.
  if (dataLoading) {
    return (
      <View style={styles.container}>
        <HarvestFormSkeleton />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Animated.View style={{ flex: 1, opacity: contentFade }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'android' ? 80 : 0}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Offline stale-cache notice — shown when not connected and data
              is coming from a previous session's cache */}
          {!isConnected && isStaleCache && (
            <View style={styles.staleBadge}>
              <Ionicons name="cloud-offline-outline" size={12} color={colors.warning} />
              <Text style={styles.staleBadgeText}>
                Offline · using data from {cacheAge}
              </Text>
            </View>
          )}

          {/* ── Greenhouse ── */}
          <Text style={[styles.label, missingFields.has('greenhouse') && styles.labelError]}>
            Greenhouse{missingFields.has('greenhouse') ? '  ← required' : ''}
          </Text>
          <View style={styles.dropdownWrapper}>
            <View style={[
              styles.dropdownField,
              ghDropdownOpen && styles.dropdownFieldActive,
              missingFields.has('greenhouse') && styles.dropdownFieldError,
            ]}>
              <Ionicons name="search" size={15} color={colors.textMuted} />
              <TextInput
                style={styles.dropdownTextInput}
                value={ghDropdownOpen ? ghSearch : (selectedGreenhouse?.warehouse_name ?? '')}
                onChangeText={setGhSearch}
                onFocus={() => {
                  if (ghBlurTimer.current) clearTimeout(ghBlurTimer.current);
                  setGhSearch('');
                  setGhDropdownOpen(true);
                }}
                onBlur={() => {
                  ghBlurTimer.current = setTimeout(() => setGhDropdownOpen(false), 200);
                }}
                placeholder="Search greenhouse..."
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {selectedGreenhouse && !ghDropdownOpen && (
                <TouchableOpacity
                  onPress={() => {
                    setSelectedGreenhouse(null);
                    setSelectedSection(null);
                    setSelectedVariety(null);
                    setSelectedHarvester('');
                    setSelectedHarvesterName('');
                    setTeamOverrides({});
                    setGhSearch('');
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => {
                  if (ghBlurTimer.current) clearTimeout(ghBlurTimer.current);
                  if (ghDropdownOpen) {
                    setGhDropdownOpen(false);
                  } else {
                    setGhSearch('');
                    setGhDropdownOpen(true);
                  }
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.7}
              >
                <Ionicons name={ghDropdownOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {ghDropdownOpen && (
              <View style={styles.dropdownList}>
                <ScrollView style={styles.dropdownScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {filteredGreenhouses.map((item) => {
                    const isSelected = selectedGreenhouse?.name === item.name;
                    const secCount = item.custom_sections?.length ?? 0;
                    const varCount = item.custom_varieties_grown?.length ?? 0;
                    return (
                      <TouchableOpacity
                        key={item.name}
                        style={[styles.listRow, isSelected && styles.listRowSelected]}
                        onPress={() => handleSelectGreenhouse(item)}
                        activeOpacity={0.7}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.listRowTitle}>{item.warehouse_name}</Text>
                          <Text style={styles.listRowSub}>
                            {secCount} sections · {varCount} varieties
                          </Text>
                        </View>
                        {isSelected && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                      </TouchableOpacity>
                    );
                  })}
                  {filteredGreenhouses.length === 0 && (
                    <Text style={styles.emptyText}>No greenhouses found</Text>
                  )}
                </ScrollView>
              </View>
            )}
          </View>

          {/* Manage Team link */}
          {selectedGreenhouse && (
            <TouchableOpacity
              style={styles.manageTeamRow}
              onPress={() => setTeamModalOpen(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="people-outline" size={14} color={colors.primary} />
              <Text style={styles.manageTeamText}>Manage Team</Text>
              {totalBorrowed > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{totalBorrowed}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}

          {/* ── Section ── */}
          <Text style={[styles.label, missingFields.has('section') && styles.labelError]}>
            Section{missingFields.has('section') ? '  ← required' : ''}
          </Text>
          <View style={styles.dropdownWrapper}>
            <View style={[
              styles.dropdownField,
              sectionDropdownOpen && styles.dropdownFieldActive,
              !selectedGreenhouse && styles.dropdownFieldDisabled,
              missingFields.has('section') && styles.dropdownFieldError,
            ]}>
              <Ionicons name="search" size={15} color={colors.textMuted} />
              <TextInput
                style={styles.dropdownTextInput}
                value={sectionDropdownOpen ? sectionSearch : (selectedSection?.section_name ?? '')}
                onChangeText={setSectionSearch}
                onFocus={() => {
                  if (!selectedGreenhouse) {
                    Alert.alert('Missing', 'Select a greenhouse first.');
                    return;
                  }
                  if (sectionBlurTimer.current) clearTimeout(sectionBlurTimer.current);
                  setSectionSearch('');
                  setSectionDropdownOpen(true);
                }}
                onBlur={() => {
                  sectionBlurTimer.current = setTimeout(() => setSectionDropdownOpen(false), 200);
                }}
                placeholder="Search section..."
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
                autoCapitalize="none"
                editable={!!selectedGreenhouse}
              />
              {selectedSection && !sectionDropdownOpen && (
                <TouchableOpacity
                  onPress={() => {
                    setSelectedSection(null);
                    setSelectedHarvester('');
                    setSelectedHarvesterName('');
                    setSectionSearch('');
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => {
                  if (!selectedGreenhouse) {
                    Alert.alert('Missing', 'Select a greenhouse first.');
                    return;
                  }
                  if (sectionBlurTimer.current) clearTimeout(sectionBlurTimer.current);
                  if (sectionDropdownOpen) {
                    setSectionDropdownOpen(false);
                  } else {
                    setSectionSearch('');
                    setSectionDropdownOpen(true);
                  }
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.7}
              >
                <Ionicons name={sectionDropdownOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {sectionDropdownOpen && (
              <View style={styles.dropdownList}>
                <ScrollView style={styles.dropdownScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {filteredSections.map((item) => {
                    const isSelected = selectedSection?.section_name === item.section_name;
                    const borrowed = teamOverrides[item.section_name] ?? [];
                    const names = [item.employee_name, ...borrowed.map(b => b.employee_name)];
                    return (
                      <TouchableOpacity
                        key={item.section_name}
                        style={[styles.listRow, isSelected && styles.listRowSelected]}
                        onPress={() => handleSelectSection(item)}
                        activeOpacity={0.7}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.listRowTitle}>{item.section_name}</Text>
                          <Text style={styles.listRowSub}>{names.join(', ')}</Text>
                        </View>
                        {isSelected && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                      </TouchableOpacity>
                    );
                  })}
                  {filteredSections.length === 0 && (
                    <Text style={styles.emptyText}>
                      {selectedGreenhouse ? 'No sections found' : 'Select a greenhouse first'}
                    </Text>
                  )}
                </ScrollView>
              </View>
            )}
          </View>

          {/* ── Harvester (auto-filled or inline picker) ── */}
          {selectedSection && (
            sectionHarvesters.length > 1 ? (
              <>
                <Text style={styles.label}>Harvester</Text>
                <View style={styles.dropdownWrapper}>
                  <TouchableOpacity
                    style={[styles.dropdownField, harvesterDropdownOpen && styles.dropdownFieldActive]}
                    onPress={() => setHarvesterDropdownOpen(!harvesterDropdownOpen)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[{ flex: 1 }, selectedHarvester ? styles.dropdownValue : styles.dropdownPlaceholder]}
                      numberOfLines={1}
                    >
                      {selectedHarvesterName || 'Select harvester...'}
                    </Text>
                    <Ionicons name={harvesterDropdownOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
                  </TouchableOpacity>

                  {harvesterDropdownOpen && (
                    <View style={styles.dropdownList}>
                      {sectionHarvesters.map((item, index) => {
                        const isSelected = selectedHarvester === (item.employee ?? item.employee_name);
                        return (
                          <TouchableOpacity
                            key={`${item.employee_name}-${index}`}
                            style={[styles.listRow, isSelected && styles.listRowSelected]}
                            onPress={() => {
                              setSelectedHarvester(item.employee ?? item.employee_name);
                              setSelectedHarvesterName(item.employee_name);
                              setHarvesterDropdownOpen(false);
                            }}
                            activeOpacity={0.7}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={styles.listRowTitle}>{item.employee_name}</Text>
                              <Text style={styles.listRowSub}>
                                {index === 0 ? selectedGreenhouse?.warehouse_name ?? '' : item.greenhouse_name}
                              </Text>
                            </View>
                            {isSelected && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              </>
            ) : (
              <View style={styles.harvesterRow}>
                <Ionicons name="person" size={14} color={colors.textSecondary} />
                <Text style={styles.harvesterName}>
                  Harvester: {selectedHarvesterName}
                </Text>
              </View>
            )
          )}

          {/* ── Item / Variety ── */}
          <Text style={[styles.label, missingFields.has('variety') && styles.labelError]}>
            Item{missingFields.has('variety') ? '  ← required' : ''}
          </Text>
          <View style={styles.dropdownWrapper}>
            <View style={[
              styles.dropdownField,
              varietyDropdownOpen && styles.dropdownFieldActive,
              !selectedGreenhouse && styles.dropdownFieldDisabled,
              missingFields.has('variety') && styles.dropdownFieldError,
            ]}>
              <Ionicons name="search" size={15} color={colors.textMuted} />
              <TextInput
                style={styles.dropdownTextInput}
                value={varietyDropdownOpen ? varietySearch : (selectedVariety?.variety ?? '')}
                onChangeText={setVarietySearch}
                onFocus={() => {
                  if (!selectedGreenhouse) {
                    Alert.alert('Missing', 'Select a greenhouse first.');
                    return;
                  }
                  if (varietyBlurTimer.current) clearTimeout(varietyBlurTimer.current);
                  setVarietySearch('');
                  setVarietyDropdownOpen(true);
                }}
                onBlur={() => {
                  varietyBlurTimer.current = setTimeout(() => setVarietyDropdownOpen(false), 200);
                }}
                placeholder="Search item..."
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
                autoCapitalize="none"
                editable={!!selectedGreenhouse}
              />
              {selectedVariety && !varietyDropdownOpen && (
                <TouchableOpacity
                  onPress={() => {
                    setSelectedVariety(null);
                    setVarietySearch('');
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => {
                  if (!selectedGreenhouse) {
                    Alert.alert('Missing', 'Select a greenhouse first.');
                    return;
                  }
                  if (varietyBlurTimer.current) clearTimeout(varietyBlurTimer.current);
                  if (varietyDropdownOpen) {
                    setVarietyDropdownOpen(false);
                  } else {
                    setVarietySearch('');
                    setVarietyDropdownOpen(true);
                  }
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.7}
              >
                <Ionicons name={varietyDropdownOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {varietyDropdownOpen && (
              <View style={styles.dropdownList}>
                <ScrollView style={styles.dropdownScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {filteredVarieties.map((item) => {
                    const isSelected = selectedVariety?.variety === item.variety;
                    return (
                      <TouchableOpacity
                        key={item.variety}
                        style={[styles.listRow, isSelected && styles.listRowSelected]}
                        onPress={() => handleSelectVariety(item)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.listRowTitle, { flex: 1 }]}>{item.variety}</Text>
                        {isSelected && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                      </TouchableOpacity>
                    );
                  })}
                  {filteredVarieties.length === 0 && (
                    <Text style={styles.emptyText}>
                      {selectedGreenhouse ? 'No varieties found' : 'Select a greenhouse first'}
                    </Text>
                  )}
                </ScrollView>
              </View>
            )}
          </View>

          {/* Quantity */}
          <Text style={[styles.label, missingFields.has('quantity') && styles.labelError]}>
            Quantity{missingFields.has('quantity') ? '  ← required' : ''}
          </Text>
          <TextInput
            ref={quantityRef}
            style={[styles.textInput, missingFields.has('quantity') && styles.textInputError]}
            value={quantity}
            onChangeText={(v) => {
              setQuantity(v);
              if (missingFields.has('quantity')) {
                setMissingFields((prev) => { const n = new Set(prev); n.delete('quantity'); return n; });
              }
            }}
            // "next" moves focus directly into the scan field — one less tap per entry
            onSubmitEditing={() => scanInputRef.current?.focus()}
            placeholder="Enter quantity"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            returnKeyType="next"
            blurOnSubmit={false}
          />

          {/* Bucket scan */}
          <Text style={styles.label}>Scan Bucket</Text>
          <ScanInput
            ref={scanInputRef}
            placeholder="Bucket ID"
            scannerTitle="Scan Bucket QR Code"
            onScan={handleBucketScanned}
          />

          {/* Recent scans — last 4 successful entries with quick edit / cancel */}
          {recentScans.length > 0 && (
            <View style={styles.recentSection}>
              <Text style={styles.recentHeader}>Recent · last {recentScans.length}</Text>
              {recentScans.map((entry) => {
                const isDeleting = deletingEntry === entry.stock_entry;
                return (
                  <View key={entry.stock_entry} style={styles.recentRow}>
                    <View style={styles.recentDot} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.recentTitle} numberOfLines={1}>
                        {entry.bucket_id}
                      </Text>
                      <Text style={styles.recentMeta} numberOfLines={1}>
                        {entry.quantity} × {entry.item_code} · {entry.time}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => openEditEntry(entry)}
                      style={styles.recentBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      disabled={isDeleting}
                    >
                      <Ionicons name="create-outline" size={16} color={colors.text} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDeleteEntry(entry)}
                      style={[styles.recentBtn, styles.recentBtnDanger]}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      disabled={isDeleting}
                    >
                      <Ionicons
                        name={isDeleting ? 'hourglass-outline' : 'trash-outline'}
                        size={16}
                        color={colors.error}
                      />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}

          {/* Entries */}
          <EntriesLog
            entries={entries}
            label="bucket"
            renderEntry={(entry, idx) => (
              <View key={`${entry.bucket_id}-${idx}`} style={styles.entryRow}>
                <Ionicons
                  name={entry.status === 'success' ? 'checkmark-circle' : entry.status === 'queued' ? 'time' : 'alert-circle'}
                  size={18}
                  color={entry.status === 'success' ? colors.success : entry.status === 'queued' ? colors.warning : colors.error}
                />
                <View style={styles.entryInfo}>
                  <Text style={styles.entryId}>{entry.bucket_id}</Text>
                  <Text style={styles.entryMeta}>{entry.quantity} x {entry.item_code} · {entry.time}</Text>
                </View>
                {entry.message ? <Text style={styles.entryMsg} numberOfLines={1}>{entry.message}</Text> : null}
              </View>
            )}
          />
        </ScrollView>
      </KeyboardAvoidingView>
      </Animated.View>

      {/* ── Manage Team modal ── */}
      <Modal
        visible={teamModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => { setTeamModalOpen(false); setAddingToSection(null); setEmployeeSearch(''); }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {addingToSection ? (
              <>
                <View style={styles.modalHeader}>
                  <TouchableOpacity onPress={() => { setAddingToSection(null); setEmployeeSearch(''); }} activeOpacity={0.7}>
                    <Ionicons name="arrow-back" size={22} color={colors.text} />
                  </TouchableOpacity>
                  <Text style={[styles.modalTitle, { flex: 1, marginLeft: spacing.md }]} numberOfLines={1}>
                    Add to {addingToSection}
                  </Text>
                  <TouchableOpacity onPress={() => { setTeamModalOpen(false); setAddingToSection(null); setEmployeeSearch(''); }} activeOpacity={0.7}>
                    <Ionicons name="close" size={24} color={colors.text} />
                  </TouchableOpacity>
                </View>
                <View style={styles.searchRow}>
                  <Ionicons name="search" size={16} color={colors.textMuted} />
                  <TextInput
                    style={styles.searchInput}
                    value={employeeSearch}
                    onChangeText={setEmployeeSearch}
                    placeholder="Search employees..."
                    placeholderTextColor={colors.textMuted}
                    autoCorrect={false}
                  />
                </View>
                <FlatList
                  data={filteredOtherEmployees}
                  keyExtractor={(item, idx) => `${item.greenhouse_name}-${item.employee_name}-${idx}`}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.listRow}
                      onPress={() => handleAddBorrowed(addingToSection, item)}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.listRowTitle}>{item.employee_name}</Text>
                        <Text style={styles.listRowSub}>{item.greenhouse_name}</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={<Text style={styles.emptyText}>No employees found</Text>}
                  keyboardShouldPersistTaps="handled"
                />
              </>
            ) : (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Manage Team</Text>
                  <TouchableOpacity onPress={() => setTeamModalOpen(false)} activeOpacity={0.7}>
                    <Ionicons name="close" size={24} color={colors.text} />
                  </TouchableOpacity>
                </View>
                <ScrollView keyboardShouldPersistTaps="handled">
                  {sections.length === 0 && (
                    <Text style={styles.emptyText}>No sections in this greenhouse</Text>
                  )}
                  {sections.map((sec) => {
                    const borrowed = teamOverrides[sec.section_name] ?? [];
                    return (
                      <View key={sec.section_name} style={styles.teamSection}>
                        <Text style={styles.teamSectionTitle}>{sec.section_name}</Text>

                        {/* Default employee */}
                        <View style={styles.teamMemberRow}>
                          <Ionicons name="person" size={14} color={colors.textSecondary} />
                          <Text style={styles.teamMemberName}>{sec.employee_name}</Text>
                        </View>

                        {/* Borrowed employees */}
                        {borrowed.map((emp, idx) => (
                          <View key={`${emp.employee_name}-${idx}`} style={styles.teamMemberRow}>
                            <Ionicons name="person-add" size={14} color={colors.primary} />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.teamMemberName}>{emp.employee_name}</Text>
                              <Text style={styles.teamMemberSub}>from {emp.greenhouse_name}</Text>
                            </View>
                            <TouchableOpacity
                              onPress={() => handleRemoveBorrowed(sec.section_name, idx)}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              activeOpacity={0.7}
                            >
                              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                            </TouchableOpacity>
                          </View>
                        ))}

                        {/* Add button */}
                        <TouchableOpacity
                          style={styles.teamAddButton}
                          onPress={() => setAddingToSection(sec.section_name)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="add" size={16} color={colors.primary} />
                          <Text style={styles.teamAddText}>Add employee</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Edit harvest qty modal ── */}
      <Modal
        visible={!!editingEntry}
        transparent
        animationType="fade"
        onRequestClose={() => !editing && setEditingEntry(null)}
      >
        <View style={styles.editScrim}>
          <View style={styles.editCard}>
            <View style={styles.editHeader}>
              <Text style={styles.editTitle}>Edit quantity</Text>
              <TouchableOpacity
                onPress={() => !editing && setEditingEntry(null)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {editingEntry && (
              <>
                <Text style={styles.editMeta}>
                  {editingEntry.bucket_id} · {editingEntry.item_code}
                </Text>
                <TextInput
                  style={styles.editInput}
                  value={editQty}
                  onChangeText={setEditQty}
                  keyboardType="numeric"
                  placeholder="Quantity"
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                  editable={!editing}
                />
                <View style={styles.editActions}>
                  <TouchableOpacity
                    style={styles.editCancel}
                    onPress={() => setEditingEntry(null)}
                    disabled={editing}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.editCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.editSave, editing && styles.editSaveDisabled]}
                    onPress={saveEditEntry}
                    disabled={editing}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.editSaveText}>
                      {editing ? 'Saving…' : 'Save'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <ScanConfirmation
        visible={confirmation.visible}
        type={confirmation.type}
        message={confirmation.message}
        onDismiss={() => setConfirmation((prev) => ({ ...prev, visible: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  label: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  labelError: {
    color: colors.error,
  },
  textInput: {
    backgroundColor: colors.surface,
    // Slightly darker border than the default #E5E5E5 so fields
    // are clearly identifiable as input areas at a glance.
    borderWidth: 1.5,
    borderColor: '#C4C4C4',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    height: 48,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  textInputError: {
    borderColor: colors.error,
    borderWidth: 2,
  },

  // Stale-cache notice shown at the top of the form when offline
  staleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#FFFBEB',
    borderRadius: borderRadius.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  staleBadgeText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.warning,
  },

  // Inline dropdown
  dropdownWrapper: {
    marginBottom: spacing.lg,
  },
  dropdownField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: '#C4C4C4',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    height: 48,
  },
  dropdownFieldActive: {
    borderColor: colors.primary,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  dropdownFieldDisabled: {
    backgroundColor: colors.surfaceAlt,
    opacity: 0.6,
  },
  dropdownFieldError: {
    borderColor: colors.error,
    borderWidth: 2,
  },
  dropdownTextInput: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.text,
    padding: 0,
  },
  dropdownValue: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  dropdownPlaceholder: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  dropdownList: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: colors.primary,
    borderBottomLeftRadius: borderRadius.md,
    borderBottomRightRadius: borderRadius.md,
    overflow: 'hidden',
  },
  dropdownScroll: {
    maxHeight: 220,
  },
  // Manage Team link
  manageTeamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.lg,
    marginTop: -spacing.sm,
  },
  manageTeamText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.primary,
  },
  badge: {
    backgroundColor: colors.primary,
    borderRadius: 9999,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    color: colors.textOnPrimary,
  },

  // Single harvester readonly
  harvesterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    marginTop: -spacing.sm,
  },
  harvesterName: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.text,
  },

  // Entries
  countText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  entryInfo: {
    flex: 1,
  },
  entryId: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  entryMeta: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 1,
  },
  entryMsg: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    maxWidth: 100,
  },

  // ── Recent scans panel ──
  recentSection: { marginTop: spacing.lg },
  recentHeader: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: spacing.sm,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
  },
  recentDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.success,
  },
  recentTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.text,
    letterSpacing: -0.2,
  },
  recentMeta: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 1,
  },
  recentBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  recentBtnDanger: { backgroundColor: 'rgba(239, 68, 68, 0.10)' },

  // ── Edit qty modal ──
  editScrim: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  editCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
  },
  editHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  editTitle: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.text,
    letterSpacing: -0.3,
  },
  editMeta: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  editInput: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.lg,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  editActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  editCancel: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  editCancelText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  editSave: {
    flex: 1.4,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  editSaveDisabled: { opacity: 0.6 },
  editSaveText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.textOnPrimary,
  },
  emptyText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xxl,
  },

  // Modal (team modal only)
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    maxHeight: '70%',
    paddingBottom: spacing.xxl,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.lg,
    color: colors.text,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    margin: spacing.lg,
    paddingHorizontal: spacing.md,
    height: 40,
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.text,
    padding: 0,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  listRowSelected: {
    backgroundColor: colors.primaryMuted,
  },
  listRowTitle: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  listRowSub: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 1,
  },

  // Team modal
  teamSection: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  teamSectionTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  teamMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  teamMemberName: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.text,
    flex: 1,
  },
  teamMemberSub: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  teamAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  teamAddText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.primary,
  },
});
