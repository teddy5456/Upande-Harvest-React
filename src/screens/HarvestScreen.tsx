import React, { useState, useCallback, useEffect } from 'react';
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
  Platform,
  Modal,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { addToSyncQueue } from '../database/sync-queue';
import { getFarm } from '../database/settings';
import { addHarvestEntry } from '../database/harvest';
import { submitHarvest, fetchGreenhouses } from '../services/api';
import ScanInput from '../components/ScanInput';
import SyncBanner from '../components/SyncBanner';
import ScanConfirmation from '../components/ScanConfirmation';
import { HarvestListEntry, Greenhouse, GreenhouseSection, GreenhouseVariety } from '../types';
import { onScanSuccess, onScanError } from '../utils/feedback';
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

  // Picker modals
  const [ghPickerOpen, setGhPickerOpen] = useState(false);
  const [ghSearch, setGhSearch] = useState('');
  const [sectionPickerOpen, setSectionPickerOpen] = useState(false);
  const [sectionSearch, setSectionSearch] = useState('');
  const [varietyPickerOpen, setVarietyPickerOpen] = useState(false);
  const [varietySearch, setVarietySearch] = useState('');
  const [harvesterPickerOpen, setHarvesterPickerOpen] = useState(false);

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
      const res = await fetchGreenhouses();
      setGreenhouses(res.greenhouses ?? []);
    } catch (error: any) {
      console.log('Failed to load greenhouses:', error.message);
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
    setGhPickerOpen(false);
    setGhSearch('');
  }, []);

  const handleSelectSection = useCallback((sec: GreenhouseSection) => {
    setSelectedSection(sec);
    setSectionPickerOpen(false);
    setSectionSearch('');
  }, []);

  const handleSelectVariety = useCallback((v: GreenhouseVariety) => {
    setSelectedVariety(v);
    setVarietyPickerOpen(false);
    setVarietySearch('');
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
      const bucketId = data.trim();
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
        showConfirmation('success', 'Saved offline');
      }
    },
    [isConnected, refreshStats, selectedGreenhouse, selectedSection, selectedHarvester, selectedVariety, quantity]
  );

  // Filtered lists
  const filteredGreenhouses = ghSearch
    ? greenhouses.filter((g) =>
        g.warehouse_name.toLowerCase().includes(ghSearch.toLowerCase()) ||
        g.name.toLowerCase().includes(ghSearch.toLowerCase())
      )
    : greenhouses;

  const sections = selectedGreenhouse?.custom_sections ?? [];
  const filteredSections = sectionSearch
    ? sections.filter((s) =>
        s.section_name.toLowerCase().includes(sectionSearch.toLowerCase()) ||
        s.employee_name.toLowerCase().includes(sectionSearch.toLowerCase())
      )
    : sections;

  const varieties = selectedGreenhouse?.custom_varieties_grown ?? [];
  const filteredVarieties = varietySearch
    ? varieties.filter((v) => v.variety.toLowerCase().includes(varietySearch.toLowerCase()))
    : varieties;

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
          {/* Greenhouse */}
          <Text style={styles.label}>Greenhouse</Text>
          <TouchableOpacity
            style={styles.pickerButton}
            onPress={() => setGhPickerOpen(true)}
            activeOpacity={0.7}
          >
            <Text
              style={selectedGreenhouse ? styles.pickerValue : styles.pickerPlaceholder}
              numberOfLines={1}
            >
              {selectedGreenhouse?.warehouse_name ?? 'Select greenhouse...'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
          </TouchableOpacity>

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

          {/* Section */}
          <Text style={styles.label}>Section</Text>
          <TouchableOpacity
            style={styles.pickerButton}
            onPress={() => {
              if (!selectedGreenhouse) {
                Alert.alert('Missing', 'Select a greenhouse first.');
                return;
              }
              setSectionPickerOpen(true);
            }}
            activeOpacity={0.7}
          >
            <Text
              style={selectedSection ? styles.pickerValue : styles.pickerPlaceholder}
              numberOfLines={1}
            >
              {selectedSection
                ? selectedSection.section_name
                : 'Select section...'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Harvester — auto-filled if single, picker if multiple */}
          {selectedSection && (
            sectionHarvesters.length > 1 ? (
              <>
                <Text style={styles.label}>Harvester</Text>
                <TouchableOpacity
                  style={styles.pickerButton}
                  onPress={() => setHarvesterPickerOpen(true)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={selectedHarvester ? styles.pickerValue : styles.pickerPlaceholder}
                    numberOfLines={1}
                  >
                    {selectedHarvester || 'Select harvester...'}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
                </TouchableOpacity>
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

          {/* Item / Variety */}
          <Text style={styles.label}>Item</Text>
          <TouchableOpacity
            style={styles.pickerButton}
            onPress={() => {
              if (!selectedGreenhouse) {
                Alert.alert('Missing', 'Select a greenhouse first.');
                return;
              }
              setVarietyPickerOpen(true);
            }}
            activeOpacity={0.7}
          >
            <Text
              style={selectedVariety ? styles.pickerValue : styles.pickerPlaceholder}
              numberOfLines={1}
            >
              {selectedVariety?.variety ?? 'Select item...'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Quantity */}
          <Text style={styles.label}>Quantity</Text>
          <TextInput
            style={styles.textInput}
            value={quantity}
            onChangeText={setQuantity}
            placeholder="Enter quantity"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
          />

          {/* Bucket scan */}
          <Text style={styles.label}>Scan Bucket</Text>
          <ScanInput
            placeholder="Bucket ID"
            scannerTitle="Scan Bucket QR Code"
            onScan={handleBucketScanned}
          />

          {/* Entries */}
          {entries.length > 0 && (
            <Text style={styles.countText}>{entries.length} harvested</Text>
          )}
          {entries.map((entry, idx) => (
            <View key={`${entry.bucket_id}-${idx}`} style={styles.entryRow}>
              <Ionicons
                name={
                  entry.status === 'success'
                    ? 'checkmark-circle'
                    : entry.status === 'queued'
                      ? 'time'
                      : 'alert-circle'
                }
                size={18}
                color={
                  entry.status === 'success'
                    ? colors.success
                    : entry.status === 'queued'
                      ? colors.warning
                      : colors.error
                }
              />
              <View style={styles.entryInfo}>
                <Text style={styles.entryId}>{entry.bucket_id}</Text>
                <Text style={styles.entryMeta}>
                  {entry.quantity} x {entry.item_code} · {entry.time}
                </Text>
              </View>
              {entry.message ? (
                <Text style={styles.entryMsg} numberOfLines={1}>{entry.message}</Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Greenhouse picker ── */}
      <Modal visible={ghPickerOpen} transparent animationType="slide" onRequestClose={() => setGhPickerOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Greenhouse</Text>
              <TouchableOpacity onPress={() => { setGhPickerOpen(false); setGhSearch(''); }} activeOpacity={0.7}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={ghSearch}
                onChangeText={setGhSearch}
                placeholder="Search greenhouses..."
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
              />
            </View>
            <FlatList
              data={filteredGreenhouses}
              keyExtractor={(item) => item.name}
              renderItem={({ item }) => {
                const isSelected = selectedGreenhouse?.name === item.name;
                const secCount = item.custom_sections?.length ?? 0;
                const varCount = item.custom_varieties_grown?.length ?? 0;
                return (
                  <TouchableOpacity
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
              }}
              ListEmptyComponent={<Text style={styles.emptyText}>No greenhouses found</Text>}
              keyboardShouldPersistTaps="handled"
            />
          </View>
        </View>
      </Modal>

      {/* ── Section picker ── */}
      <Modal visible={sectionPickerOpen} transparent animationType="slide" onRequestClose={() => setSectionPickerOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Section</Text>
              <TouchableOpacity onPress={() => { setSectionPickerOpen(false); setSectionSearch(''); }} activeOpacity={0.7}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={sectionSearch}
                onChangeText={setSectionSearch}
                placeholder="Search sections..."
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
              />
            </View>
            <FlatList
              data={filteredSections}
              keyExtractor={(item) => item.section_name}
              renderItem={({ item }) => {
                const isSelected = selectedSection?.section_name === item.section_name;
                const borrowed = teamOverrides[item.section_name] ?? [];
                const names = [item.employee_name, ...borrowed.map(b => b.employee_name)];
                return (
                  <TouchableOpacity
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
              }}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  {selectedGreenhouse ? 'No sections found' : 'Select a greenhouse first'}
                </Text>
              }
              keyboardShouldPersistTaps="handled"
            />
          </View>
        </View>
      </Modal>

      {/* ── Harvester picker (when section has multiple) ── */}
      <Modal visible={harvesterPickerOpen} transparent animationType="slide" onRequestClose={() => setHarvesterPickerOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Harvester</Text>
              <TouchableOpacity onPress={() => setHarvesterPickerOpen(false)} activeOpacity={0.7}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={sectionHarvesters}
              keyExtractor={(item, idx) => `${item.employee_name}-${idx}`}
              renderItem={({ item, index }) => {
                const isSelected = selectedHarvester === item.employee_name;
                return (
                  <TouchableOpacity
                    style={[styles.listRow, isSelected && styles.listRowSelected]}
                    onPress={() => { setSelectedHarvester(item.employee_name); setHarvesterPickerOpen(false); }}
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
              }}
              keyboardShouldPersistTaps="handled"
            />
          </View>
        </View>
      </Modal>

      {/* ── Variety picker ── */}
      <Modal visible={varietyPickerOpen} transparent animationType="slide" onRequestClose={() => setVarietyPickerOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Item</Text>
              <TouchableOpacity onPress={() => { setVarietyPickerOpen(false); setVarietySearch(''); }} activeOpacity={0.7}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={varietySearch}
                onChangeText={setVarietySearch}
                placeholder="Search varieties..."
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
              />
            </View>
            <FlatList
              data={filteredVarieties}
              keyExtractor={(item) => item.variety}
              renderItem={({ item }) => {
                const isSelected = selectedVariety?.variety === item.variety;
                return (
                  <TouchableOpacity
                    style={[styles.listRow, isSelected && styles.listRowSelected]}
                    onPress={() => handleSelectVariety(item)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.listRowTitle, { flex: 1 }]}>{item.variety}</Text>
                    {isSelected && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  {selectedGreenhouse ? 'No varieties found' : 'Select a greenhouse first'}
                </Text>
              }
              keyboardShouldPersistTaps="handled"
            />
          </View>
        </View>
      </Modal>

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

  // Picker button
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    height: 48,
    marginBottom: spacing.lg,
  },
  pickerValue: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  pickerPlaceholder: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
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

  // Modal (shared)
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
