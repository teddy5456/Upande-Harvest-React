import React, { useRef, useCallback, useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';
import { lightHaptic } from '../utils/feedback';

interface QRScannerProps {
  visible: boolean;
  title: string;
  onScanned: (data: string) => void;
  onClose: () => void;
}

interface QRBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SCAN_COOLDOWN_MS = 1500;
const HIGHLIGHT_TIMEOUT_MS = 1500;

export default function QRScanner({ visible, title, onScanned, onClose }: QRScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const lastScanTime = useRef(0);
  const [qrBounds, setQrBounds] = useState<QRBounds | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      setQrBounds(null);
      if (highlightTimer.current) {
        clearTimeout(highlightTimer.current);
        highlightTimer.current = null;
      }
    }
  }, [visible]);

  const handleBarCodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      const { data, bounds } = result;

      lightHaptic();

      if (bounds) {
        setQrBounds({
          x: bounds.origin.x,
          y: bounds.origin.y,
          width: bounds.size.width,
          height: bounds.size.height,
        });

        if (highlightTimer.current) clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => setQrBounds(null), HIGHLIGHT_TIMEOUT_MS);
      }

      const now = Date.now();
      if (now - lastScanTime.current < SCAN_COOLDOWN_MS) return;
      lastScanTime.current = now;
      onScanned(data);
    },
    [onScanned]
  );

  const renderContent = () => {
    if (!permission) {
      return (
        <View style={styles.centered}>
          <Text style={styles.permissionText}>Requesting camera permission...</Text>
        </View>
      );
    }

    if (!permission.granted) {
      return (
        <View style={styles.centered}>
          <Text style={styles.permissionText}>Camera access is needed to scan QR codes</Text>
          <TouchableOpacity style={styles.grantButton} onPress={requestPermission}>
            <Text style={styles.grantButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleBarCodeScanned}
      >
        {qrBounds && (
          <View
            style={[
              styles.qrHighlight,
              {
                left: qrBounds.x,
                top: qrBounds.y,
                width: qrBounds.width,
                height: qrBounds.height,
              },
            ]}
          />
        )}

        <View style={styles.hintContainer}>
          <View style={styles.hintPill}>
            <Ionicons name="qr-code" size={16} color="#fff" />
            <Text style={styles.hintText}>{title}</Text>
          </View>
        </View>
      </CameraView>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <View style={styles.container}>
        {renderContent()}
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Ionicons name="close" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  permissionText: {
    fontFamily: fontFamily.medium,
    color: '#fff',
    fontSize: fontSize.lg,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  grantButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
  },
  grantButtonText: {
    fontFamily: fontFamily.semiBold,
    color: '#fff',
    fontSize: fontSize.md,
  },
  qrHighlight: {
    position: 'absolute',
    borderWidth: 2.5,
    borderColor: colors.success,
    backgroundColor: 'rgba(22, 163, 74, 0.15)',
    borderRadius: 4,
  },
  hintContainer: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    gap: spacing.sm,
  },
  hintText: {
    fontFamily: fontFamily.medium,
    color: '#fff',
    fontSize: fontSize.md,
  },
  closeButton: {
    position: 'absolute',
    top: 54,
    right: spacing.lg,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
