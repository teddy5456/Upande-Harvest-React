import React, { useEffect, useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { captureRef } from 'react-native-view-shot';
import { useApp } from '../context/AppContext';
import { submitIssue, uploadAttachment } from '../services/api';
import { captureDiagnostics, bundleToText, DiagnosticBundle } from '../services/diagnostics';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

interface SupportModalProps {
  visible: boolean;
  onClose: () => void;
  /** Optional ref to the screen view the modal should snapshot before opening. */
  screenshotTargetRef?: React.RefObject<any>;
}

export default function SupportModal({ visible, onClose, screenshotTargetRef }: SupportModalProps) {
  const { isConnected, userEmail } = useApp();

  const [subject, setSubject] = useState('');
  const [statement, setStatement] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticBundle | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [capturing, setCapturing] = useState(true);

  const reset = () => {
    setSubject('');
    setStatement('');
    setDetailsOpen(false);
    setScreenshotUri(null);
    setDiagnostics(null);
  };

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setCapturing(true);
    (async () => {
      try {
        const [shotUri, bundle] = await Promise.all([
          captureScreenshot(screenshotTargetRef),
          captureDiagnostics({ online: isConnected }),
        ]);
        if (cancelled) return;
        setScreenshotUri(shotUri);
        setDiagnostics(bundle);
      } finally {
        if (!cancelled) setCapturing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, isConnected, screenshotTargetRef]);

  const handleSubmit = useCallback(async () => {
    if (!subject.trim()) {
      Alert.alert('Subject required', 'Enter a short subject before sending.');
      return;
    }
    if (!diagnostics) {
      Alert.alert('Just a moment', 'Still gathering diagnostics — try again in a second.');
      return;
    }
    setSubmitting(true);
    try {
      const description = composeDescription({
        statement: statement.trim(),
        bundle: diagnostics,
      });
      const resp = await submitIssue(subject.trim(), description);

      if (screenshotUri) {
        await uploadAttachment({
          fileUri: screenshotUri,
          fileName: `${resp.issue}-screenshot.png`,
          attachedTo: { doctype: 'Issue', name: resp.issue },
          isPrivate: true,
        });
      }
      Alert.alert(
        'Sent',
        `Logged as ${resp.issue}. We'll follow up.`,
        [{ text: 'OK', onPress: () => { reset(); onClose(); } }],
      );
    } catch (e: any) {
      Alert.alert('Could not send', e?.message ?? 'Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }, [subject, statement, diagnostics, screenshotUri, onClose]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.scrim}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Report an issue</Text>
              <Text style={styles.subtitle}>
                We'll attach your screen and device info to help diagnose.
                For a back-and-forth conversation, use the <Text style={{ fontFamily: fontFamily.semiBold, color: colors.text }}>Chat</Text> tab in the drawer.
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Subject */}
            <Text style={styles.label}>Subject</Text>
            <TextInput
              style={styles.input}
              placeholder="What's wrong, in one line"
              placeholderTextColor={colors.textMuted}
              value={subject}
              onChangeText={setSubject}
              maxLength={140}
              editable={!submitting}
            />

            {/* Description */}
            <Text style={[styles.label, { marginTop: spacing.md }]}>Describe the issue</Text>
            <TextInput
              style={[styles.input, styles.inputMulti]}
              placeholder="What you were doing, what happened, what you expected…"
              placeholderTextColor={colors.textMuted}
              value={statement}
              onChangeText={setStatement}
              multiline
              editable={!submitting}
            />

            {/* Attachments preview — quiet, informative */}
            <View style={styles.attachmentsRow}>
              <View style={styles.attachThumb}>
                {capturing ? (
                  <ActivityIndicator size="small" color={colors.textMuted} />
                ) : screenshotUri ? (
                  <Image source={{ uri: screenshotUri }} style={styles.attachImg} resizeMode="cover" />
                ) : (
                  <Ionicons name="image-outline" size={18} color={colors.textMuted} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.attachTitle}>
                  {capturing ? 'Capturing…' : screenshotUri ? 'Screenshot attached' : 'No screenshot'}
                </Text>
                <Text style={styles.attachSub}>
                  Of the screen you came from
                </Text>
              </View>
            </View>

            {/* Diagnostics — collapsible, calm */}
            <TouchableOpacity
              style={styles.detailsHeader}
              onPress={() => setDetailsOpen((v) => !v)}
              activeOpacity={0.7}
            >
              <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
              <Text style={styles.detailsLabel}>What we'll send with your report</Text>
              <Ionicons
                name={detailsOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textMuted}
              />
            </TouchableOpacity>

            {detailsOpen && (
              <View style={styles.detailsBody}>
                {diagnostics ? (
                  <>
                    <DetailLine k="User"        v={diagnostics.user.email} />
                    <DetailLine k="Server"      v={diagnostics.user.serverUrl} />
                    <DetailLine k="App version" v={`${diagnostics.app.version} (build ${diagnostics.app.nativeBuildVersion})`} />
                    <DetailLine k="Device"      v={`${diagnostics.device.manufacturer} ${diagnostics.device.modelName}`} />
                    <DetailLine k="OS"          v={`${diagnostics.device.platform} ${diagnostics.device.osVersion}`} />
                    <DetailLine k="Network"     v={diagnostics.network.online ? 'Online' : 'Offline'} />
                    <DetailLine k="Sync queue"  v={`${diagnostics.sync.pending} pending · ${diagnostics.sync.failed} failed`} />
                    <DetailLine k="API trace"   v={`Last ${diagnostics.apiTraces.length} calls`} />
                  </>
                ) : (
                  <Text style={styles.detailsBodyText}>Loading…</Text>
                )}
              </View>
            )}

            <View style={{ height: spacing.md }} />
          </ScrollView>

          {/* Submit bar (report tab only) */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onClose}
              disabled={submitting}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sendBtn, (submitting || capturing) && styles.sendBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting || capturing}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="send" size={16} color="#fff" />
                  <Text style={styles.sendText}>Send</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          </>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function DetailLine({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailKey}>{k}</Text>
      <Text style={styles.detailVal} numberOfLines={2}>{v}</Text>
    </View>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function captureScreenshot(ref?: React.RefObject<any>): Promise<string | null> {
  if (!ref?.current) return null;
  try {
    return await captureRef(ref, { format: 'png', quality: 0.7, result: 'tmpfile' });
  } catch {
    return null;
  }
}

function composeDescription(args: { statement: string; bundle: DiagnosticBundle }): string {
  const { statement, bundle } = args;
  const body = statement || '(no description provided)';
  return [
    body,
    '',
    '— — — Diagnostic details (attached automatically) — — —',
    bundleToText(bundle),
  ].join('\n');
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '92%',
    overflow: 'hidden',
  },
  // The Chat tab needs a bounded height because ChatPanel uses flex:1
  // internally — without an explicit height the sheet collapses around its
  // header/tabs and the chat renders at 0px.
  chatContainer: {
    height: 520,
    minHeight: 420,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.lg,
    color: colors.text,
  },
  subtitle: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 18,
  },

  // Tabs
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -StyleSheet.hairlineWidth,
  },
  tabActive: { borderBottomColor: colors.text },
  tabLabel: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  tabLabelActive: { color: colors.text, fontFamily: fontFamily.semiBold },

  // Body
  body: {},
  bodyContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },

  label: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.text,
  },
  inputMulti: { minHeight: 110, textAlignVertical: 'top', paddingTop: spacing.sm + 4 },

  // Attachments row
  attachmentsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  attachThumb: {
    width: 56, height: 56,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachImg: { width: '100%', height: '100%' },
  attachTitle: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  attachSub: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Details accordion
  detailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  detailsLabel: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  detailsBody: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  detailsBodyText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  detailLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 3,
  },
  detailKey: {
    width: 92,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  detailVal: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 18,
  },

  // Footer
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  cancelBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  cancelText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.md,
    color: colors.textMuted,
  },
  sendBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: '#fff',
  },
});
