import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  StatusBar,
  RefreshControl,
  Modal,
  Linking,
  Alert,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import {
  listSupportContacts,
  openSupportThread,
  sendSupportMessage,
  pollSupportMessages,
  getMySupportThreads,
  SupportContact,
  SupportMessage,
  SupportThread,
} from '../services/api';
import {
  colors,
  fontFamily,
  fontSize,
  spacing,
  borderRadius,
} from '../theme';

const POLL_INTERVAL_MS = 4000;

/**
 * Chat screen. Three views, one screen:
 *   1. Thread list — landing view. Shows existing conversations with the most
 *      recent message preview. Empty-state CTA when nothing yet.
 *   2. New-chat sheet — modal contact picker, triggered by the "+" button.
 *   3. Thread view — full message history + composer.
 *
 * State machine is owned at the top level; the three views are mutually
 * exclusive.
 */
type ChatView = 'list' | 'thread';

export default function ChatScreen() {
  const { userEmail } = useApp();

  // ── Thread list state ────────────────────────────────────────────────
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [refreshingThreads, setRefreshingThreads] = useState(false);
  const [threadsError, setThreadsError] = useState<string | null>(null);

  // ── Contact picker state ─────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);
  const [contacts, setContacts] = useState<SupportContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [contactSearch, setContactSearch] = useState('');

  // ── Active thread state ──────────────────────────────────────────────
  const [activeThread, setActiveThread] = useState<{
    name: string;
    other_user: string;
    other_full_name: string;
    other_mobile_no?: string | null;
  } | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [openingThread, setOpeningThread] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const view: ChatView = activeThread ? 'thread' : 'list';

  const lastFetchedAt = useRef<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const listRef = useRef<FlatList<SupportMessage>>(null);

  // ── Threads load ─────────────────────────────────────────────────────
  const loadThreads = useCallback(async (mode: 'initial' | 'refresh' | 'silent') => {
    if (mode === 'initial') setLoadingThreads(true);
    if (mode === 'refresh') setRefreshingThreads(true);
    setThreadsError(null);
    try {
      const resp = await getMySupportThreads();
      setThreads(resp.threads || []);
    } catch (e: any) {
      if (mode !== 'silent') setThreadsError(e?.message || 'Could not load chats');
    } finally {
      setLoadingThreads(false);
      setRefreshingThreads(false);
    }
  }, []);

  useEffect(() => { loadThreads('initial'); }, [loadThreads]);

  // ── Contacts load (on demand when picker opens) ──────────────────────
  const loadContacts = useCallback(async () => {
    setLoadingContacts(true);
    setContactsError(null);
    try {
      const resp = await listSupportContacts();
      setContacts(resp.contacts || []);
    } catch (e: any) {
      setContactsError(e?.message || 'Could not load contacts');
    } finally {
      setLoadingContacts(false);
    }
  }, []);

  const openPicker = useCallback(() => {
    setPickerOpen(true);
    setContactSearch('');
    if (contacts.length === 0) loadContacts();
  }, [contacts.length, loadContacts]);

  // ── Start / open a thread by contact email ───────────────────────────
  const startThreadWith = useCallback(async (contact: SupportContact) => {
    setPickerOpen(false);
    setOpeningThread(true);
    try {
      const resp = await openSupportThread(contact.name);
      setActiveThread({
        name: resp.thread,
        other_user: contact.name,
        other_full_name: contact.full_name || contact.name,
        other_mobile_no: contact.mobile_no || contact.phone || null,
      });
      setMessages([]);
      lastFetchedAt.current = null;
    } catch (e: any) {
      Alert.alert('Could not open chat', e?.message || 'Try again.');
    } finally {
      setOpeningThread(false);
    }
  }, []);

  const openExistingThread = useCallback((t: SupportThread) => {
    setActiveThread({
      name: t.name,
      other_user: t.other_user,
      other_full_name: t.other_full_name,
      other_mobile_no: t.other_mobile_no || t.other_phone || null,
    });
    setMessages([]);
    lastFetchedAt.current = null;
  }, []);

  const goBackToList = useCallback(() => {
    setActiveThread(null);
    setMessages([]);
    lastFetchedAt.current = null;
    // Silent refresh so the thread list shows the latest preview when we come back
    loadThreads('silent');
  }, [loadThreads]);

  // ── Poll messages for the active thread ──────────────────────────────
  const fetchMessages = useCallback(async () => {
    if (!activeThread) return;
    try {
      const since = lastFetchedAt.current ?? undefined;
      const resp = await pollSupportMessages(activeThread.name, since);
      const fresh = resp?.messages || [];
      if (fresh.length === 0) return;
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.name));
        return [...prev, ...fresh.filter((m) => !seen.has(m.name))];
      });
      const last = fresh[fresh.length - 1];
      if (last?.sent_at) lastFetchedAt.current = last.sent_at;
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch {
      // transient — retry on next tick
    }
  }, [activeThread]);

  useEffect(() => {
    if (!activeThread) {
      if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
      return;
    }
    fetchMessages();
    pollTimer.current = setInterval(fetchMessages, POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
    };
  }, [activeThread, fetchMessages]);

  // ── Send ─────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || !activeThread || sending) return;
    setSending(true);
    setDraft('');
    try {
      const resp = await sendSupportMessage(activeThread.name, text);
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
      Alert.alert('Send failed', e?.message || 'Check your connection.');
      setDraft(text);
    } finally {
      setSending(false);
    }
  }, [draft, activeThread, sending, userEmail]);

  // ── Call ─────────────────────────────────────────────────────────────
  const dial = useCallback(async (phone?: string | null) => {
    const number = (phone || '').trim();
    if (!number) return;
    const url = `tel:${number.replace(/[^\d+]/g, '')}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert('Calling not available', 'This device cannot place phone calls.');
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert('Could not start call', `Dial ${number} manually.`);
    }
  }, []);

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      (c.full_name || '').toLowerCase().includes(q) ||
      (c.name || '').toLowerCase().includes(q)
    );
  }, [contacts, contactSearch]);

  // ────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
    >
      <StatusBar barStyle="dark-content" />

      {view === 'list' ? (
        <ThreadListView
          threads={threads}
          loading={loadingThreads}
          refreshing={refreshingThreads}
          error={threadsError}
          onRefresh={() => loadThreads('refresh')}
          onRetry={() => loadThreads('initial')}
          onOpen={openExistingThread}
          onStartNew={openPicker}
          onCall={dial}
          openingThread={openingThread}
        />
      ) : (
        <ThreadView
          thread={activeThread!}
          messages={messages}
          openingThread={openingThread}
          draft={draft}
          sending={sending}
          userEmail={userEmail}
          listRef={listRef}
          onBack={goBackToList}
          onChangeDraft={setDraft}
          onSend={handleSend}
          onCall={() => dial(activeThread!.other_mobile_no)}
        />
      )}

      {/* New-chat picker sheet */}
      <Modal
        visible={pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable
          style={pickerStyles.scrim}
          onPress={() => setPickerOpen(false)}
        >
          <Pressable
            style={pickerStyles.sheet}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={pickerStyles.handle} />
            <View style={pickerStyles.header}>
              <Text style={pickerStyles.title}>New conversation</Text>
              <TouchableOpacity
                onPress={() => setPickerOpen(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={pickerStyles.searchWrap}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                style={pickerStyles.searchInput}
                placeholder="Search staff…"
                placeholderTextColor={colors.textMuted}
                value={contactSearch}
                onChangeText={setContactSearch}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {contactSearch.length > 0 && (
                <TouchableOpacity onPress={() => setContactSearch('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {loadingContacts ? (
              <View style={styles.centerState}>
                <ActivityIndicator size="small" color={colors.text} />
                <Text style={styles.centerStateText}>Loading staff…</Text>
              </View>
            ) : contactsError ? (
              <View style={styles.centerState}>
                <Ionicons name="warning-outline" size={20} color={colors.warning} />
                <Text style={styles.centerStateText}>{contactsError}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={loadContacts}>
                  <Text style={styles.retryBtnText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : filteredContacts.length === 0 ? (
              <View style={styles.centerState}>
                <Text style={styles.centerStateText}>
                  {contactSearch ? `No staff match "${contactSearch}"` : 'No staff available.'}
                </Text>
              </View>
            ) : (
              <FlatList
                data={filteredContacts}
                keyExtractor={(c) => c.name}
                ItemSeparatorComponent={() => <View style={pickerStyles.separator} />}
                contentContainerStyle={pickerStyles.listContent}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={pickerStyles.row}
                    onPress={() => startThreadWith(item)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{initials(item.full_name || item.name)}</Text>
                    </View>
                    <View style={pickerStyles.rowBody}>
                      <Text style={pickerStyles.rowName} numberOfLines={1}>
                        {item.full_name || item.name}
                      </Text>
                      <Text style={pickerStyles.rowEmail} numberOfLines={1}>
                        {item.name}
                      </Text>
                    </View>
                    <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.primary} />
                  </TouchableOpacity>
                )}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Thread list view
// ─────────────────────────────────────────────────────────────────────────
function ThreadListView({
  threads, loading, refreshing, error, openingThread,
  onRefresh, onRetry, onOpen, onStartNew, onCall,
}: {
  threads: SupportThread[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  openingThread: boolean;
  onRefresh: () => void;
  onRetry: () => void;
  onOpen: (t: SupportThread) => void;
  onStartNew: () => void;
  onCall: (phone?: string | null) => void;
}) {
  if (loading && threads.length === 0) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="small" color={colors.text} />
        <Text style={styles.centerStateText}>Loading conversations…</Text>
      </View>
    );
  }

  if (error && threads.length === 0) {
    return (
      <View style={styles.centerState}>
        <View style={styles.errorIconWrap}>
          <Ionicons name="warning-outline" size={24} color={colors.warning} />
        </View>
        <Text style={styles.centerStateTitle}>Couldn't load chats</Text>
        <Text style={styles.centerStateText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.85}>
          <Text style={styles.retryBtnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (threads.length === 0) {
    // First-time empty state — gentle CTA, not a wall of explanation
    return (
      <View style={styles.flex}>
        <View style={styles.emptyList}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="chatbubbles-outline" size={32} color={colors.text} />
          </View>
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptySub}>
            Reach out to Upande staff for help, follow-ups, or anything you need.
          </Text>
          <TouchableOpacity style={styles.primaryCta} onPress={onStartNew} activeOpacity={0.85}>
            <Ionicons name="create-outline" size={18} color={colors.textOnPrimary} />
            <Text style={styles.primaryCtaText}>Start a chat</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <FlatList
        data={threads}
        keyExtractor={(t) => t.name}
        contentContainerStyle={threadListStyles.listContent}
        ItemSeparatorComponent={() => <View style={threadListStyles.separator} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.textMuted}
          />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={threadListStyles.row}
            onPress={() => onOpen(item)}
            activeOpacity={0.7}
          >
            <View style={[styles.avatar, threadListStyles.avatar]}>
              <Text style={styles.avatarText}>{initials(item.other_full_name)}</Text>
              {item.unread_count > 0 && (
                <View style={threadListStyles.unreadDot}>
                  <Text style={threadListStyles.unreadDotText}>
                    {item.unread_count > 9 ? '9+' : item.unread_count}
                  </Text>
                </View>
              )}
            </View>
            <View style={threadListStyles.body}>
              <View style={threadListStyles.topRow}>
                <Text style={[
                  threadListStyles.name,
                  item.unread_count > 0 && threadListStyles.nameUnread,
                ]} numberOfLines={1}>
                  {item.other_full_name}
                </Text>
                <Text style={threadListStyles.time}>
                  {formatThreadTime(item.last_message_at)}
                </Text>
              </View>
              <View style={threadListStyles.bottomRow}>
                <Text style={[
                  threadListStyles.preview,
                  item.unread_count > 0 && threadListStyles.previewUnread,
                ]} numberOfLines={1}>
                  {item.last_message_preview || 'No messages yet'}
                </Text>
                {!!(item.other_mobile_no || item.other_phone) && (
                  <TouchableOpacity
                    onPress={(e) => { e.stopPropagation(); onCall(item.other_mobile_no || item.other_phone); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={threadListStyles.callIcon}
                  >
                    <Ionicons name="call-outline" size={16} color={colors.primary} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </TouchableOpacity>
        )}
      />

      {/* FAB — "New chat" */}
      <TouchableOpacity
        style={styles.fab}
        onPress={onStartNew}
        activeOpacity={0.85}
        accessibilityLabel="New chat"
        accessibilityRole="button"
      >
        {openingThread
          ? <ActivityIndicator size="small" color={colors.textOnPrimary} />
          : <Ionicons name="create-outline" size={22} color={colors.textOnPrimary} />
        }
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Thread view (single conversation)
// ─────────────────────────────────────────────────────────────────────────
function ThreadView({
  thread, messages, openingThread, draft, sending, userEmail,
  listRef, onBack, onChangeDraft, onSend, onCall,
}: {
  thread: { name: string; other_user: string; other_full_name: string; other_mobile_no?: string | null };
  messages: SupportMessage[];
  openingThread: boolean;
  draft: string;
  sending: boolean;
  userEmail: string | null;
  listRef: React.RefObject<FlatList<SupportMessage> | null>;
  onBack: () => void;
  onChangeDraft: (s: string) => void;
  onSend: () => void;
  onCall: () => void;
}) {
  return (
    <View style={styles.flex}>
      <View style={styles.threadHeader}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.threadAvatar}>
          <Text style={styles.threadAvatarText}>{initials(thread.other_full_name)}</Text>
        </View>
        <View style={styles.threadHeaderText}>
          <Text style={styles.threadName} numberOfLines={1}>{thread.other_full_name}</Text>
          <Text style={styles.threadSub} numberOfLines={1}>
            {thread.other_mobile_no || thread.other_user}
          </Text>
        </View>
        {thread.other_mobile_no && (
          <TouchableOpacity
            onPress={onCall}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.callBtn}
            activeOpacity={0.85}
            accessibilityLabel={`Call ${thread.other_full_name}`}
          >
            <Ionicons name="call" size={18} color={colors.textOnPrimary} />
          </TouchableOpacity>
        )}
      </View>

      {openingThread ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          style={styles.flex}
          contentContainerStyle={styles.threadBody}
          data={messages}
          keyExtractor={(m) => m.name}
          renderItem={({ item, index }) => (
            <Bubble
              msg={item}
              prev={messages[index - 1]}
              mine={item.sender === userEmail}
            />
          )}
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({ animated: false })
          }
          ListEmptyComponent={
            <View style={styles.emptyThread}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="chatbubbles-outline" size={28} color={colors.text} />
              </View>
              <Text style={styles.emptyTitle}>Say hi to {firstName(thread.other_full_name)}</Text>
              <Text style={styles.emptySub}>
                Messages arrive in real time on web + mobile.
              </Text>
            </View>
          }
        />
      )}

      <View style={styles.composer}>
        <TextInput
          style={styles.composerInput}
          placeholder="Message…"
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={onChangeDraft}
          multiline
          editable={!sending}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
          onPress={onSend}
          disabled={!draft.trim() || sending}
          activeOpacity={0.85}
        >
          {sending
            ? <ActivityIndicator size="small" color="#fff" />
            : <Ionicons name="arrow-up" size={20} color="#fff" />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Bubble row
// ─────────────────────────────────────────────────────────────────────────
function Bubble({ msg, prev, mine }: { msg: SupportMessage; prev?: SupportMessage; mine: boolean }) {
  const sameAsPrev = prev?.sender === msg.sender;
  return (
    <View style={[
      bubbleStyles.row,
      mine && bubbleStyles.rowMine,
      sameAsPrev ? bubbleStyles.rowTight : bubbleStyles.rowSpaced,
    ]}>
      <View style={[
        bubbleStyles.bubble,
        mine ? bubbleStyles.bubbleMine : bubbleStyles.bubbleTheirs,
      ]}>
        <Text style={[bubbleStyles.text, mine && bubbleStyles.textMine]}>
          {msg.text}
        </Text>
        <Text style={[bubbleStyles.time, mine && bubbleStyles.timeMine]}>
          {formatTime(msg.sent_at)}
        </Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────
function initials(name: string): string {
  return (name || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((s) => s[0]?.toUpperCase())
    .slice(0, 2)
    .join('') || '?';
}

function firstName(name: string): string {
  if (!name) return 'them';
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  return parts[0] || name;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z');
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatThreadTime(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z');
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const diffMs = now.getTime() - d.getTime();
    const days = Math.floor(diffMs / 86400000);
    if (days === 1) return 'Yesterday';
    if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  } catch { return ''; }
}

// ─────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },

  // Avatar (shared)
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  avatarText: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.sm,
    color: colors.textOnPrimary,
    letterSpacing: 0.5,
  },

  // Center / empty states
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  centerStateTitle: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
  },
  centerStateText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
  errorIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  retryBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
  },
  retryBtnText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.sm,
    color: colors.textOnPrimary,
  },

  // Empty list (no conversations yet)
  emptyList: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  emptyIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.text,
    letterSpacing: -0.3,
  },
  emptySub: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  primaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
  },
  primaryCtaText: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.textOnPrimary,
  },

  // FAB ("New chat") for non-empty lists
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg + 8,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 6,
  },

  // Thread view header
  threadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  threadAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  threadAvatarText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    color: colors.textOnPrimary,
  },
  threadHeaderText: { flex: 1, minWidth: 0 },
  callBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.success,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: spacing.xs,
  },
  threadName: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
    letterSpacing: -0.2,
  },
  threadSub: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 1,
  },

  threadBody: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    flexGrow: 1,
  },

  // Empty thread
  emptyThread: {
    alignItems: 'center',
    paddingTop: spacing.xxl * 2,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },

  // Composer
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  composerInput: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.background,
    borderRadius: 22,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});

const threadListStyles = StyleSheet.create({
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 120, // room for the FAB
  },
  separator: { height: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
  },
  avatar: {},
  unreadDot: {
    position: 'absolute',
    top: -2, right: -2,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.error,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2, borderColor: colors.background,
  },
  unreadDotText: {
    fontFamily: fontFamily.bold,
    fontSize: 10,
    color: '#fff',
    letterSpacing: 0.2,
  },
  body: { flex: 1, minWidth: 0, gap: 4 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  name: {
    flex: 1,
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
    letterSpacing: -0.2,
  },
  nameUnread: { fontFamily: fontFamily.bold },
  time: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  preview: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  previewUnread: {
    color: colors.text,
    fontFamily: fontFamily.medium,
  },
  callIcon: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(23, 23, 23, 0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
});

const pickerStyles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '85%',
    minHeight: 380,
    paddingBottom: spacing.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: 8, marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.lg,
    color: colors.text,
    letterSpacing: -0.3,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.text,
    padding: 0,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  separator: { height: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: {
    fontFamily: fontFamily.semiBold,
    fontSize: fontSize.md,
    color: colors.text,
    letterSpacing: -0.2,
  },
  rowEmail: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
});

const bubbleStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'flex-start' },
  rowMine: { justifyContent: 'flex-end' },
  rowTight: { marginTop: 2 },
  rowSpaced: { marginTop: spacing.sm },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 18,
  },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 6,
  },
  bubbleMine: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 6,
  },
  text: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.text,
    lineHeight: 21,
  },
  textMine: { color: colors.textOnPrimary },
  time: {
    fontFamily: fontFamily.regular,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 4,
    textAlign: 'right',
  },
  timeMine: { color: 'rgba(255,255,255,0.78)' },
});
