import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Text,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRScanner from './QRScanner';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

interface ScanInputProps {
  placeholder: string;
  scannerTitle: string;
  onScan: (data: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  keepFocused?: boolean;
}

/** Ref handle — lets parent screens call scanInputRef.current?.focus() */
export interface ScanInputHandle {
  focus: () => void;
}

const ScanInput = forwardRef<ScanInputHandle, ScanInputProps>(function ScanInput(
  { placeholder, scannerTitle, onScan, autoFocus = true, disabled = false, keepFocused = false },
  ref
) {
  const inputRef = useRef<TextInput>(null);

  // Expose focus() so parent can chain keyboard focus from the quantity field
  useImperativeHandle(ref, () => ({
    focus: () => { inputRef.current?.focus(); },
  }));
  const [value, setValue] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef('');

  useEffect(() => {
    if (autoFocus && !disabled) {
      const timer = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(timer);
    }
  }, [autoFocus, disabled]);

  const submitCurrent = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const trimmed = valueRef.current.trim();
    if (!trimmed) return;
    onScan(trimmed);
    setValue('');
    valueRef.current = '';
    // Re-focus for next scan
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [onScan]);

  const handleSubmit = submitCurrent;

  // Auto-submit after 200ms of no new input — handles Honeywell scanners
  // that output all characters instantly without an Enter suffix
  const handleChangeText = useCallback((text: string) => {
    setValue(text);
    valueRef.current = text;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim()) {
      debounceRef.current = setTimeout(submitCurrent, 200);
    }
  }, [submitCurrent]);

  const handleCameraScan = useCallback(
    (data: string) => {
      setCameraOpen(false);
      onScan(data);
      setValue('');
      setTimeout(() => inputRef.current?.focus(), 300);
    },
    [onScan]
  );

  const openCamera = () => {
    Keyboard.dismiss();
    setCameraOpen(true);
  };

  return (
    <>
      <View style={[styles.container, disabled && styles.containerDisabled]}>
        <Ionicons name="barcode-outline" size={18} color={colors.textMuted} />
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={value}
          onChangeText={handleChangeText}
          onSubmitEditing={handleSubmit}
          onBlur={() => { if (keepFocused && !disabled) setTimeout(() => inputRef.current?.focus(), 100); }}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          blurOnSubmit={false}
          editable={!disabled}
          selectTextOnFocus
        />
        {value.length > 0 && (
          <TouchableOpacity onPress={handleSubmit} style={styles.goButton} activeOpacity={0.6}>
            <Ionicons name="arrow-forward" size={16} color={colors.textOnPrimary} />
          </TouchableOpacity>
        )}
        <View style={styles.separator} />
        <TouchableOpacity onPress={openCamera} style={styles.cameraButton} activeOpacity={0.6} disabled={disabled}>
          <Ionicons name="camera-outline" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>
      <Text style={styles.hint}>Scan with Honeywell or tap camera</Text>
      <QRScanner
        visible={cameraOpen}
        title={scannerTitle}
        onScanned={handleCameraScan}
        onClose={() => setCameraOpen(false)}
      />
    </>
  );
});

export default ScanInput;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    height: 48,
    gap: spacing.sm,
  },
  containerDisabled: {
    opacity: 0.5,
  },
  input: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.text,
    padding: 0,
  },
  goButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.text,
    justifyContent: 'center',
    alignItems: 'center',
  },
  separator: {
    width: StyleSheet.hairlineWidth,
    height: 24,
    backgroundColor: colors.border,
  },
  cameraButton: {
    padding: spacing.xs,
  },
  hint: {
    fontFamily: fontFamily.regular,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
});
