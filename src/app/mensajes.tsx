import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

type Message = {
  id: string;
  sender: string;
  content: string;
  created_at: string;
  read_at: string | null;
};

type ParsedContent =
  | { type: 'text' }
  | { type: 'image'; url: string }
  | { type: 'video'; url: string }
  | { type: 'doc'; name: string; url: string };

// Mismo formato que el panel web (Messages.jsx: parseContent).
function parseContent(content: string): ParsedContent {
  if (content.startsWith('__img__:')) return { type: 'image', url: content.slice(8) };
  if (content.startsWith('__vid__:')) return { type: 'video', url: content.slice(8) };
  if (content.startsWith('__doc__:')) {
    const idx = content.indexOf('|', 8);
    return { type: 'doc', name: content.slice(8, idx), url: content.slice(idx + 1) };
  }
  return { type: 'text' };
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

export default function MensajesScreen() {
  const { client } = useAuth();
  const clientId = client?.id;
  const coachId = client?.coach_id as string | undefined;

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  const markCoachRead = useCallback(async (id: string) => {
    await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('client_id', id)
      .eq('sender', 'coach')
      .is('read_at', null);
  }, []);

  const load = useCallback(async () => {
    if (!clientId) return;
    const { data, error } = await supabase
      .from('messages')
      .select('id, sender, content, created_at, read_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true });
    if (error) {
      console.log('[mensajes] load error:', error);
      return;
    }
    setMessages((data ?? []) as Message[]);
    await markCoachRead(clientId);
  }, [clientId, markCoachRead]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!clientId) return;
    const channel = supabase
      .channel(`mensajes-${clientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `client_id=eq.${clientId}` },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId, load]);

  async function send() {
    const text = draft.trim();
    if (!text || !clientId || !coachId || sending) return;
    setSending(true);
    setDraft('');
    const { error } = await supabase.from('messages').insert({
      coach_id: coachId,
      client_id: clientId,
      sender: 'client',
      content: text,
    });
    setSending(false);
    if (error) {
      console.log('[mensajes] send error:', error);
      setDraft(text);
      return;
    }
    load();
  }

  function renderItem({ item }: { item: Message }) {
    const isMine = item.sender === 'client';
    const parsed = parseContent(item.content);
    return (
      <View style={[styles.bubbleRow, isMine ? styles.rowMine : styles.rowTheirs]}>
        <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
          {parsed.type === 'image' ? (
            <Image source={{ uri: parsed.url }} style={styles.image} resizeMode="cover" />
          ) : parsed.type === 'video' ? (
            <Pressable onPress={() => Linking.openURL(parsed.url)}>
              <Text style={[styles.msgText, isMine && styles.msgTextMine]}>🎥 Ver video</Text>
            </Pressable>
          ) : parsed.type === 'doc' ? (
            <Pressable onPress={() => Linking.openURL(parsed.url)}>
              <Text style={[styles.msgText, isMine && styles.msgTextMine]}>📎 {parsed.name}</Text>
            </Pressable>
          ) : (
            <Text style={[styles.msgText, isMine && styles.msgTextMine]}>{item.content}</Text>
          )}
          <Text style={[styles.time, isMine && styles.timeMine]}>{timeLabel(item.created_at)}</Text>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.title}>Mensajes</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <Text style={styles.empty}>Aún no tienes mensajes con tu coach.</Text>
          }
        />

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Escribe un mensaje..."
            value={draft}
            onChangeText={setDraft}
            multiline
          />
          <Pressable
            style={[styles.sendButton, (!draft.trim() || sending) && styles.sendButtonDisabled]}
            onPress={send}
            disabled={!draft.trim() || sending}
          >
            <Text style={styles.sendText}>Enviar</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  backButton: { padding: 4 },
  backArrow: { fontSize: 22 },
  title: { fontSize: 20, fontWeight: '600' },
  listContent: { padding: 16, gap: 8 },
  empty: { textAlign: 'center', color: '#6b7280', marginTop: 32, fontSize: 14 },
  bubbleRow: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '80%',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  bubbleMine: { backgroundColor: '#2563eb', borderBottomRightRadius: 4 },
  bubbleTheirs: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderBottomLeftRadius: 4,
  },
  msgText: { fontSize: 15, color: '#111827' },
  msgTextMine: { color: '#fff' },
  image: { width: 200, height: 200, borderRadius: 8 },
  time: { fontSize: 10, color: '#9ca3af', alignSelf: 'flex-end' },
  timeMine: { color: '#dbeafe' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: '#2563eb',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  sendButtonDisabled: { opacity: 0.5 },
  sendText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
