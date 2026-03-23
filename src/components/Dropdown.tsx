import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  FlatList,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

export interface DropdownOption {
  label: string;
  value: string;
}

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  placeholder: string;
  onSelect: (value: string) => void;
  searchable?: boolean;
  disabled?: boolean;
}

export default function Dropdown({
  value,
  options,
  placeholder,
  onSelect,
  searchable = false,
  disabled = false,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? '',
    [options, value]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  const handleOpen = () => {
    if (disabled) return;
    setSearch('');
    setOpen(true);
  };

  const handleSelect = (val: string) => {
    onSelect(val);
    setOpen(false);
    setSearch('');
  };

  return (
    <>
      {/* Trigger */}
      <TouchableOpacity
        style={[styles.trigger, disabled && styles.triggerDisabled]}
        onPress={handleOpen}
        activeOpacity={0.7}
      >
        <Text
          style={[styles.triggerText, !selectedLabel && styles.placeholder]}
          numberOfLines={1}
        >
          {selectedLabel || placeholder}
        </Text>
        <Ionicons
          name="chevron-down"
          size={16}
          color={disabled ? colors.textMuted : colors.textSecondary}
        />
      </TouchableOpacity>

      {/* Bottom-sheet modal */}
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Select</Text>
            <TouchableOpacity
              onPress={() => setOpen(false)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Search */}
          {searchable && (
            <View style={styles.searchContainer}>
              <Ionicons name="search-outline" size={16} color={colors.textMuted} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder="Search…"
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Options list */}
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.value}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const selected = item.value === value;
              return (
                <TouchableOpacity
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => handleSelect(item.value)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]} numberOfLines={1}>
                    {item.label}
                  </Text>
                  {selected && (
                    <Ionicons name="checkmark" size={18} color={colors.textOnPrimary} />
                  )}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No options found</Text>
            }
          />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  triggerDisabled: {
    backgroundColor: colors.surfaceAlt,
    opacity: 0.6,
  },
  triggerText: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.text,
    marginRight: spacing.sm,
  },
  placeholder: {
    color: colors.textMuted,
  },

  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '65%',
    paddingBottom: spacing.xl,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
  },

  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.text,
    paddingVertical: spacing.sm,
  },

  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.xs,
  },
  optionSelected: {
    backgroundColor: colors.primary,
  },
  optionText: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.text,
  },
  optionTextSelected: {
    fontFamily: fontFamily.medium,
    color: colors.textOnPrimary,
  },
  emptyText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});
