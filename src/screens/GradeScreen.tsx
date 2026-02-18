import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { addToSyncQueue } from '../database/sync-queue';
import { getFarm } from '../database/settings';
import { addGradingEntry } from '../database/grading';
import { submitGrading } from '../services/api';
import {
  parseScannedBunchQR,
  parseScannedGraderQR,
  parseScannedGradingBucketQR,
} from '../utils/grading-utils';
import ScanInput from '../components/ScanInput';
import GradingEntryComponent from '../components/GradingEntry';
import SyncBanner from '../components/SyncBanner';
import ScanConfirmation from '../components/ScanConfirmation';
import { GradingScanPhase, GradedEntry } from '../types';
import { onScanSuccess, onScanError } from '../utils/feedback';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

const STEPS: { key: GradingScanPhase; label: string; title: string; hint: string }[] = [
  {
    key: 'scan-bunch',
    label: 'Bunch',
    title: 'Scan Bunch',
    hint: 'Point your camera at a bunch QR code to begin grading',
  },
  {
    key: 'scan-grader',
    label: 'Grader',
    title: 'Scan Grader',
    hint: "Now scan the grader's employee QR code",
  },
  {
    key: 'scan-bucket',
    label: 'Bucket',
    title: 'Scan Bucket',
    hint: 'Finally, scan the destination bucket QR code',
  },
];

export default function GradeScreen() {
  const { isConnected, refreshStats } = useApp();
  const [phase, setPhase] = useState<GradingScanPhase>('scan-bunch');
  const [bunchId, setBunchId] = useState<string | null>(null);
  const [graderId, setGraderId] = useState<string | null>(null);
  const [entries, setEntries] = useState<GradedEntry[]>([]);
  const [confirmation, setConfirmation] = useState<{
    visible: boolean;
    type: 'success' | 'error';
    message: string;
  }>({ visible: false, type: 'success', message: '' });

  const showConfirmation = (type: 'success' | 'error', message: string) => {
    setConfirmation({ visible: true, type, message });
  };

  const resetToStart = useCallback(() => {
    setPhase('scan-bunch');
    setBunchId(null);
    setGraderId(null);
  }, []);

  const handleBunchScanned = useCallback(
    (data: string) => {
      const parsed = parseScannedBunchQR(data);
      if (!parsed) {
        onScanError();
        Alert.alert('Invalid', 'Could not read a bunch ID.');
        return;
      }
      setBunchId(parsed);
      setPhase('scan-grader');
      onScanSuccess();
      showConfirmation('success', `Bunch ${parsed}`);
    },
    []
  );

  const handleGraderScanned = useCallback(
    (data: string) => {
      const parsed = parseScannedGraderQR(data);
      if (!parsed) {
        onScanError();
        Alert.alert('Invalid', 'Could not read a grader ID.');
        return;
      }
      setGraderId(parsed);
      setPhase('scan-bucket');
      onScanSuccess();
      showConfirmation('success', `Grader ${parsed}`);
    },
    []
  );

  const handleBucketScanned = useCallback(
    async (data: string) => {
      const bucketId = parseScannedGradingBucketQR(data);
      if (!bucketId || !bunchId || !graderId) {
        onScanError();
        Alert.alert('Invalid QR', 'Could not read a bucket ID from this QR code.');
        return;
      }

      const now = new Date().toLocaleTimeString();
      const farm = await getFarm();

      if (isConnected) {
        try {
          const response = await submitGrading(bunchId, graderId, bucketId, farm);

          await addGradingEntry(
            bunchId,
            graderId,
            bucketId,
            farm,
            response.variety ?? '',
            response.stem_length ?? '',
            response.qty ?? 0,
            true
          );

          const newEntry: GradedEntry = {
            bunch_id: bunchId,
            grader: graderId,
            bucket_id: bucketId,
            variety: response.variety ?? '',
            stem_length: response.stem_length ?? '',
            qty: response.qty ?? 0,
            time: now,
            status: 'success',
            message: `${response.qty} stems`,
          };

          setEntries((prev) => [newEntry, ...prev]);
          await refreshStats();
          onScanSuccess();
          showConfirmation('success', `Graded: ${response.qty ?? 0} stems`);
        } catch (error: any) {
          await addToSyncQueue('mobile_grading_entry', {
            bunch_id: bunchId,
            grader: graderId,
            bucket_id: bucketId,
            farm,
          });

          await addGradingEntry(bunchId, graderId, bucketId, farm, '', '', 0, false);

          const newEntry: GradedEntry = {
            bunch_id: bunchId,
            grader: graderId,
            bucket_id: bucketId,
            variety: '',
            stem_length: '',
            qty: 0,
            time: now,
            status: 'error',
            message: error.message,
          };
          setEntries((prev) => [newEntry, ...prev]);
          await refreshStats();
          onScanError();
          showConfirmation('error', error.message);
        }
      } else {
        await addToSyncQueue('mobile_grading_entry', {
          bunch_id: bunchId,
          grader: graderId,
          bucket_id: bucketId,
          farm,
        });

        await addGradingEntry(bunchId, graderId, bucketId, farm, '', '', 0, false);

        const newEntry: GradedEntry = {
          bunch_id: bunchId,
          grader: graderId,
          bucket_id: bucketId,
          variety: '',
          stem_length: '',
          qty: 0,
          time: now,
          status: 'queued',
          message: 'Saved offline',
        };
        setEntries((prev) => [newEntry, ...prev]);
        await refreshStats();
        onScanSuccess();
        showConfirmation('success', 'Saved offline');
      }

      resetToStart();
    },
    [bunchId, graderId, isConnected, refreshStats, resetToStart]
  );

  const currentStepIndex = STEPS.findIndex((s) => s.key === phase);
  const currentStep = STEPS[currentStepIndex];

  const handleScanned =
    phase === 'scan-bunch'
      ? handleBunchScanned
      : phase === 'scan-grader'
        ? handleGraderScanned
        : handleBucketScanned;

  const scannerTitle =
    phase === 'scan-bunch'
      ? 'Scan Bunch QR Code'
      : phase === 'scan-grader'
        ? 'Scan Grader QR Code'
        : 'Scan Bucket QR Code';

  const scanPlaceholder =
    phase === 'scan-bunch'
      ? 'Bunch ID'
      : phase === 'scan-grader'
        ? 'Grader ID'
        : 'Bucket ID';

  return (
    <View style={styles.container}>
      <SyncBanner />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Stepper */}
        <View style={styles.stepper}>
          {STEPS.map((step, idx) => {
            const isCompleted = idx < currentStepIndex;
            const isCurrent = idx === currentStepIndex;
            return (
              <React.Fragment key={step.key}>
                {idx > 0 && (
                  <View
                    style={[
                      styles.stepLine,
                      isCompleted && styles.stepLineCompleted,
                    ]}
                  />
                )}
                <View style={styles.stepItem}>
                  <View
                    style={[
                      styles.stepDot,
                      isCompleted && styles.stepDotCompleted,
                      isCurrent && styles.stepDotActive,
                    ]}
                  >
                    {isCompleted && (
                      <Ionicons name="checkmark" size={10} color={colors.textOnPrimary} />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.stepText,
                      isCurrent && styles.stepTextActive,
                      isCompleted && styles.stepTextCompleted,
                    ]}
                  >
                    {step.label}
                  </Text>
                </View>
              </React.Fragment>
            );
          })}
        </View>

        {/* Collected data cards */}
        {bunchId && (
          <View style={styles.collectedCard}>
            <Ionicons name="leaf-outline" size={16} color={colors.primary} />
            <Text style={styles.collectedLabel}>Bunch:</Text>
            <Text style={styles.collectedValue}>{bunchId}</Text>
          </View>
        )}
        {graderId && (
          <View style={styles.collectedCard}>
            <Ionicons name="person-outline" size={16} color={colors.primary} />
            <Text style={styles.collectedLabel}>Grader:</Text>
            <Text style={styles.collectedValue}>{graderId}</Text>
          </View>
        )}

        {/* Scan input */}
        <View style={styles.inputSection}>
          <Text style={styles.label}>{currentStep.title}</Text>
          <ScanInput
            placeholder={scanPlaceholder}
            scannerTitle={scannerTitle}
            onScan={handleScanned}
          />
        </View>

        {/* Entries list */}
        <View style={styles.entriesSection}>
          <View style={styles.entriesHeader}>
            <Ionicons name="layers-outline" size={18} color={colors.text} />
            <Text style={styles.entriesTitle}>
              Graded Entries ({entries.length})
            </Text>
          </View>
          {entries.length === 0 ? (
            <View style={styles.emptyEntries}>
              <Text style={styles.emptyEntriesText}>No entries graded yet</Text>
            </View>
          ) : (
            entries.map((entry, idx) => (
              <GradingEntryComponent
                key={`${entry.bunch_id}-${entry.time}`}
                entry={entry}
                index={idx}
              />
            ))
          )}
        </View>
      </ScrollView>

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
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  stepItem: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  stepDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepDotActive: {
    backgroundColor: colors.primary,
  },
  stepDotCompleted: {
    backgroundColor: colors.success,
  },
  stepLine: {
    width: 40,
    height: 2,
    backgroundColor: colors.border,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.lg,
  },
  stepLineCompleted: {
    backgroundColor: colors.success,
  },
  stepText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  stepTextActive: {
    fontFamily: fontFamily.semiBold,
    color: colors.primary,
  },
  stepTextCompleted: {
    color: colors.success,
  },
  collectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryMuted,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  collectedLabel: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.primary,
  },
  collectedValue: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: colors.primary,
  },
  inputSection: {
    marginBottom: spacing.lg,
  },
  label: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  entriesSection: {
    marginBottom: spacing.lg,
  },
  entriesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: 6,
  },
  entriesTitle: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: colors.text,
  },
  emptyEntries: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyEntriesText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
});
