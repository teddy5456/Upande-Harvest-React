import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Modal,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { addToSyncQueue } from '../database/sync-queue';
import { getFarm, getSetting, setSetting } from '../database/settings';
import { addHarvestEntry } from '../database/harvest';
import { submitHarvest, fetchGreenhouses } from '../services/api';
import ScanInput from '../components/ScanInput';
import SyncBanner from '../components/SyncBanner';
import ScanConfirmation from '../components/ScanConfirmation';
import EntriesLog from '../components/EntriesLog';
import { HarvestListEntry, Greenhouse, GreenhouseSection, GreenhouseVariety } from '../types';
import { onScanSuccess, onScanError } from '../utils/feedback';
import { parseScannedBucketQR } from '../utils/shelf-utils';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

interface BorrowedHarvester {
  employee_name: string;
  greenhouse_name: string;
}

export default function HarvestScreen() {
  const { isConnected, refreshStats } = useApp();

  // Data from API
  const [greenhouses, setGreenhouses] = useState<Greenhouse[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Selections
  const [selectedGreenhouse, setSelectedGreenhouse] = useState<Greenhouse | null>(null);
  const [selectedSection, setSelectedSection] = useState<GreenhouseSection | null>(null);
  const [selectedVariety, setSelectedVariety] = useState<GreenhouseVariety | null>(null);
  const [selectedHarvester, setSelectedHarvester] = useState('');
  const [quantity, setQuantity] = useState('');

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

  // Sort order per dropdown (true = A→Z, false = Z→A)
  const [ghSortAZ, setGhSortAZ] = useState(true);
  const [sectionSortAZ, setSectionSortAZ] = useState(true);
  const [varietySortAZ, setVarietySortAZ] = useState(true);

  // Blur timers (so list item taps register before dropdown closes)
  const ghBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const varietyBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Quantity input ref for auto-focus after variety selection
  const quantityRef = useRef<TextInput>(null);

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

  const showConfirmation = (type: 'success' | 'error', message: string) => {
    setConfirmation({ visible: true, type, message });
  };

  // Computed: harvesters for selected section
  const sectionHarvesters: { employee_name: string; greenhouse_name: string }[] = selectedSection
    ? [
        { employee_name: selectedSection.employee_name, greenhouse_name: selectedGreenhouse?.warehouse_name ?? '' },
        ...(teamOverrides[selectedSection.section_name] ?? []),
      ]
    : [];

  // Auto-select harvester when section changes or team changes
  useEffect(() => {
    if (!selectedSection) {
      setSelectedHarvester('');
      return;
    }
    const borrowed = teamOverrides[selectedSection.section_name] ?? [];
    if (borrowed.length === 0) {
      setSelectedHarvester(selectedSection.employee_name);
    } else {
      setSelectedHarvester(prev => {
        const allNames = [selectedSection.employee_name, ...borrowed.map(b => b.employee_name)];
        return allNames.includes(prev) ? prev : '';
      });
    }
  }, [selectedSection, teamOverrides]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setDataLoading(true);
    try {
      const [res, lastGhName, lastVariety] = await Promise.all([
        fetchGreenhouses(),
        getSetting('last_greenhouse'),
        getSetting('last_variety'),
      ]);
      const ghs = res.greenhouses ?? [];
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
    } catch {
      // silently continue — user can retry
    } finally {
      setDataLoading(false);
    }
  };

  const handleSelectGreenhouse = useCallback((gh: Greenhouse) => {
    setSelectedGreenhouse(gh);
    setSelectedSection(null);
    setSelectedVariety(null);
    setSelectedHarvester('');
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
    // Auto-open variety dropdown after section is chosen
    setTimeout(() => setVarietyDropdownOpen(true), 150);
  }, []);

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
      if (!bucketId) return;

      if (!selectedGreenhouse) {
        onScanError();
        Alert.alert('Missing', 'Select a greenhouse first.');
        return;
      }
      if (!selectedSection) {
        onScanError();
        Alert.alert('Missing', 'Select a section first.');
        return;
      }
      if (!selectedHarvester) {
        onScanError();
        Alert.alert('Missing', 'Select a harvester.');
        return;
      }
      if (!selectedVariety) {
        onScanError();
        Alert.alert('Missing', 'Select an item first.');
        return;
      }

      const qty = parseFloat(quantity);
      if (!quantity.trim() || isNaN(qty) || qty <= 0) {
        onScanError();
        Alert.alert('Invalid', 'Enter a valid quantity.');
        return;
      }

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
          }, ...prev]);
          await refreshStats();
          onScanSuccess();
          setSelectedSection(null);
          setSelectedHarvester('');
          showConfirmation('success', bucketId);
        } catch (error: any) {
          await addToSyncQueue('createHarvestEntry', {
            item_code: itemCode, quantity: qty, section, harvester,
            bucket_id: bucketId, farm, greenhouse: gh,
          });
          try {
            await addHarvestEntry(itemCode, qty, section, harvester, bucketId, farm, gh, '', false);
          } catch {}

          setEntries((prev) => [{
            bucket_id: bucketId, item_code: itemCode, quantity: qty,
            time: now, status: 'error', message: error.message,
          }, ...prev]);
          await refreshStats();
          onScanError();
          setSelectedSection(null);
          setSelectedHarvester('');
          showConfirmation('error', error.message);
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
          time: now, status: 'queued', message: 'Saved offline',
        }, ...prev]);
        await refreshStats();
        onScanSuccess();
        setSelectedSection(null);
        setSelectedHarvester('');
        showConfirmation('success', 'Saved offline');
      }
    },
    [isConnected, refreshStats, selectedGreenhouse, selectedSection, selectedHarvester, selectedVariety, quantity]
  );

  // Sorted + filtered lists (all items always included, sorted A→Z by default)
  const sortedGreenhouses = [...greenhouses].sort((a, b) =>
    ghSortAZ
      ? a.warehouse_name.localeCompare(b.warehouse_name)
      : b.warehouse_name.localeCompare(a.warehouse_name)
  );
  const filteredGreenhouses = ghSearch
    ? sortedGreenhouses.filter((g) =>
        g.warehouse_name.toLowerCase().includes(ghSearch.toLowerCase()) ||
        g.name.toLowerCase().includes(ghSearch.toLowerCase())
      )
    : sortedGreenhouses;

  const sections = selectedGreenhouse?.custom_sections ?? [];
  const sortedSections = [...sections].sort((a, b) =>
    sectionSortAZ
      ? a.section_name.localeCompare(b.section_name)
      : b.section_name.localeCompare(a.section_name)
  );
  const filteredSections = sectionSearch
    ? sortedSections.filter((s) =>
        s.section_name.toLowerCase().includes(sectionSearch.toLowerCase()) ||
        s.employee_name.toLowerCase().includes(sectionSearch.toLowerCase())
      )
    : sortedSections;

  const varieties = selectedGreenhouse?.custom_varieties_grown ?? [];
  const sortedVarieties = [...varieties].sort((a, b) =>
    varietySortAZ
      ? a.variety.localeCompare(b.variety)
      : b.variety.localeCompare(a.variety)
  );
  const filteredVarieties = varietySearch
    ? sortedVarieties.filter((v) => v.variety.toLowerCase().includes(varietySearch.toLowerCase()))
    : sortedVarieties;

  // Employees from OTHER greenhouses (for borrowing)
  const otherEmployees = greenhouses
    .filter((gh) => gh.name !== selectedGreenhouse?.name)
    .flatMap((gh) =>
      (gh.custom_sections ?? []).map((sec) => ({
        employee_name: sec.employee_name,
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

  if (dataLoading) {
    return (
      <View style={styles.container}>
        <SyncBanner />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.text} />
          <Text style={styles.loadingText}>Loading greenhouses...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SyncBanner />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Greenhouse ── */}
          <Text style={styles.label}>Greenhouse</Text>
          <View style={styles.dropdownWrapper}>
            <View style={[styles.dropdownField, ghDropdownOpen && styles.dropdownFieldActive]}>
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
                <TouchableOpacity
                  style={styles.sortRow}
                  onPress={() => setGhSortAZ(!ghSortAZ)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="swap-vertical" size={12} color={colors.textMuted} />
                  <Text style={styles.sortRowText}>{ghSortAZ ? 'A → Z' : 'Z → A'}</Text>
                </TouchableOpacity>
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
          <Text style={styles.label}>Section</Text>
          <View style={styles.dropdownWrapper}>
            <View style={[
              styles.dropdownField,
              sectionDropdownOpen && styles.dropdownFieldActive,
              !selectedGreenhouse && styles.dropdownFieldDisabled,
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
                <TouchableOpacity
                  style={styles.sortRow}
                  onPress={() => setSectionSortAZ(!sectionSortAZ)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="swap-vertical" size={12} color={colors.textMuted} />
                  <Text style={styles.sortRowText}>{sectionSortAZ ? 'A → Z' : 'Z → A'}</Text>
                </TouchableOpacity>
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
                      {selectedHarvester || 'Select harvester...'}
                    </Text>
                    <Ionicons name={harvesterDropdownOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
                  </TouchableOpacity>

                  {harvesterDropdownOpen && (
                    <View style={styles.dropdownList}>
                      {sectionHarvesters.map((item, index) => {
                        const isSelected = selectedHarvester === item.employee_name;
                        return (
                          <TouchableOpacity
                            key={`${item.employee_name}-${index}`}
                            style={[styles.listRow, isSelected && styles.listRowSelected]}
                            onPress={() => {
                              setSelectedHarvester(item.employee_name);
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
                  Harvester: {selectedHarvester}
                </Text>
              </View>
            )
          )}

          {/* ── Item / Variety ── */}
          <Text style={styles.label}>Item</Text>
          <View style={styles.dropdownWrapper}>
            <View style={[
              styles.dropdownField,
              varietyDropdownOpen && styles.dropdownFieldActive,
              !selectedGreenhouse && styles.dropdownFieldDisabled,
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
                <TouchableOpacity
                  style={styles.sortRow}
                  onPress={() => setVarietySortAZ(!varietySortAZ)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="swap-vertical" size={12} color={colors.textMuted} />
                  <Text style={styles.sortRowText}>{varietySortAZ ? 'A → Z' : 'Z → A'}</Text>
                </TouchableOpacity>
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
          <Text style={styles.label}>Quantity</Text>
          <TextInput
            ref={quantityRef}
            style={styles.textInput}
            value={quantity}
            onChangeText={setQuantity}
            onSubmitEditing={() => Keyboard.dismiss()}
            placeholder="Enter quantity"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            returnKeyType="done"
            blurOnSubmit
          />

          {/* Bucket scan */}
          <Text style={styles.label}>Scan Bucket</Text>
          <ScanInput
            placeholder="Bucket ID"
            scannerTitle="Scan Bucket QR Code"
            onScan={handleBucketScanned}
          />

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
  textInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    height: 48,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.text,
    marginBottom: spacing.lg,
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
    borderWidth: 1,
    borderColor: colors.border,
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
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  sortRowText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
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
