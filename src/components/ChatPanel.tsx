import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import {
  listSupportContacts,
  openSupportThread,
  sendSupportMessage,
  pollSupportMessages,
  SupportContact,
  SupportMessage,
} from '../services/api';
import { getSetting, setSetting } from '../database/settings';
import { colors, fontFamily, fontSize, spacing, borderRadius } from '../theme';

/**
 * In-app chat with Upande support staff. Mounted inside the Support modal
 * as the "Chat" tab. State machine:
 *
 *   1. Loading contacts (first open)
 *   2. Pick contact (if not previously chosen → default_support_contact cached)
 *   3. Open thread → poll messages every 4s
 *
 * Caller-ID rule enforced server-side: list_support_contacts only returns
 * @upande.com users. open_thread rejects non-staff pairings.
 */

const POLL_INTERVAL_MS = 4000;
const STORED_CONTACT_KEY = 'support_contact_email';

interface ChatPanelProps {
  /** When true, polling is active. When false, it pauses (saves battery / API load). */
  active: boolean;
}

export default function ChatPanel({ active }: ChatPanelProps) {
  const { userEmail } = useApp();
  const [contacts, setContacts] = useState<SupportContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedAt = useRef<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const listRef = useRef<FlatList<SupportMessage>>(null);

  // Initial: load saved contact + the contacts list
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [stored, list] = await Promise.all([
          getSetting(STORED_CONTACT_KEY),
          listSupportContacts(),
        ]);
        if (!alive) return;
        setContacts(list.contacts);
        if (stored) setSelectedContact(stored);
      } catch (e: any) {
        if (alive) setError(e?.message || 'Could not load contacts');
      } finally {
        if (alive) setLoadingContacts(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Open thread when contact selected
  useEffect(() => {
    if (!selectedContact) return;
    let alive = true;
    (async () => {
      try {
        const resp = await openSupportThread(selectedContact);
        if (!alive) return;
        setThread(resp.thread);
        setMessages([]);
        lastFetchedAt.current = null;
        await setSetting(STORED_CONTACT_KEY, selectedContact);
      } catch (e: any) {
        if (alive) setError(e?.message || 'Could not open thread');
      }
    })();
    return () => { alive = false; };
  }, [selectedContact]);

  // Poll messages
  const fetchMessages = useCallback(async () => {
    if (!thread) return;
    try {
      const since = lastFetchedAt.current ?? undefined;
      const resp = await pollSupportMessages(thread, since);
      if (resp.messages.length === 0) return;
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.name));
        const next = [...prev, ...resp.messages.filter((m) => !seen.has(m.name))];
        return next;
      });
      lastFetchedAt.current = resp.messages[resp.messages.length - 1].sent_at;
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch {
      // transient; will retry next tick
    }
  }, [thread]);

  useEffect(() => {
    if (!active || !thread) {
      if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
      return;
    }
    fetchMessages();
    pollTimer.current = setInterval(fetchMessages, POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
    };
  }, [active, thread, fetchMessages]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || !thread || sending) return;
    setSending(true);
    setDraft('');
    try {
      const resp = await sendSupportMessage(thread, text);
      setMessages((prev) => [...prev, {
        name: resp.name,
        sender: userEmail || 'me',
        sent_at: resp.sent_at,
        text,
        read_by_recipient: 0,
      }]);
      lastFetchedAt.current = resp.sent_at;
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e: any) {
      setError(e?.message || 'Send failed');
      setDraft(text); // restore the draft on failure
    } finally {
      setSending(false);
    }
  }, [draft, thread, sending, userEmail]);

  // ── Render ───────────────────────────────────────────────────────────────

  if (loadingContacts) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.textMuted} />
        <Text style={styles.muted}>Loading contacts…</Text>
      </View>
    );
  }

  if (contacts.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="cloud-offline-outline" size={28} color={colors.textMuted} />
        <Text style={styles.muted}>No Upande staff available right now.</Text>
      </View>
    );
  }

  if (!selectedContact) {
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
      >
        <Text style={styles.sectionLabel}>Pick a contact</Text>
        {contacts.map((c) => (
          <TouchableOpacity
            key={c.name}
            style={styles.contactRow}
            onPress={() => setSelectedContact(c.name)}
            activeOpacity={0.7}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(c.full_name || c.name)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactName}>{c.full_name || c.name}</Text>
              <Text style={styles.contactEmail}>{c.name}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
        {!!error && <Text style={styles.errorText}>{error}</Text>}
      </ScrollView>
    );
  }

  const selectedName = contacts.find((c) => c.name === selectedContact)?.full_name || selectedContact;

  // NOTE: no KeyboardAvoidingView here — the parent SupportModal already
  // wraps the sheet in one. Nesting them causes layout thrash and crashes
  // on Android when the keyboard opens inside the chat composer.
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.chatHeader}>
        <TouchableOpacity onPress={() => setSelectedContact(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.avatarSm}>
          <Text style={styles.avatarSmText}>{initials(selectedName)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.chatHeaderName}>{selectedName}</Text>
          <Text style={styles.chatHeaderSub}>{selectedContact}</Text>
        </View>
      </View>

      <FlatList
        ref={listRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs }}
        data={messages}
        keyExtractor={(m) => m.name}
        renderItem={({ item }) => (
          <MessageBubble msg={item} mine={item.sender === userEmail} />
        )}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={28} color={colors.textMuted} />
            <Text style={styles.muted}>No messages yet — say hi.</Text>
          </View>
        }
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.composerInput}
          placeholder="Type a message…"
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          multiline
          editable={!sending}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!draft.trim() || sending}
          activeOpacity={0.8}
        >
          {sending
            ? <ActivityIndicator size="small" color="#fff" />
            : <Ionicons name="arrow-up" size={18} color="#fff" />
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

function MessageBubble({ msg, mine }: { msg: SupportMessage; mine: boolean }) {
  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : null]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{msg.text}</Text>
        <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>
          {formatTime(msg.sent_at)}
        </Text>
      </View>
    </View>
  );
}

function initials(name: string): string {
  return (name || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((s) => s[0]?.toUpperCase())
    .slice(0, 2)
    .join('') || '?';
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z');
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  muted: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
  errorText: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.error, marginTop: spacing.sm },

  sectionLabel: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  contactRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: fontFamily.semiBold, fontSize: fontSize.sm, color: '#fff' },
  contactName: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.text },
  contactEmail: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },

  chatHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  avatarSm: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarSmText: { fontFamily: fontFamily.semiBold, fontSize: 11, color: '#fff' },
  chatHeaderName: { fontFamily: fontFamily.semiBold, fontSize: fontSize.md, color: colors.text },
  chatHeaderSub: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },

  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },

  bubbleRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  bubbleTheirs: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  bubbleMine:   { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleText:    { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.text, lineHeight: 20 },
  bubbleTextMine:{ color: '#fff' },
  bubbleTime:    { fontFamily: fontFamily.regular, fontSize: 10, color: colors.textMuted, marginTop: 4, textAlign: 'right' },
  bubbleTimeMine:{ color: 'rgba(255,255,255,0.75)' },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  composerInput: {
    flex: 1,
    maxHeight: 110,
    backgroundColor: colors.background,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.text,
    borderWidth: 1, borderColor: colors.border,
  },
  sendBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.45 },
});
