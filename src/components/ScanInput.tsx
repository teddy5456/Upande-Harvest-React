import React, { useRef, useEffect, useCallback } from 'react';
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
}

export default function ScanInput({
  placeholder,
  scannerTitle,
  onScan,
  autoFocus = true,
  disabled = false,
}: ScanInputProps) {
  const inputRef = useRef<TextInput>(null);
  const [value, setValue] = React.useState('');
  const [cameraOpen, setCameraOpen] = React.useState(false);

  useEffect(() => {
    if (autoFocus && !disabled) {
      const timer = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(timer);
    }
  }, [autoFocus, disabled]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onScan(trimmed);
    setValue('');
    // Re-focus for next scan
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [value, onScan]);

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
          onChangeText={setValue}
          onSubmitEditing={handleSubmit}
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
}

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
