import { decode } from 'base64-arraybuffer';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

const ANGULOS = ['frente', 'lado', 'espalda'] as const;
const ANGULO_LABEL: Record<string, string> = { frente: 'Frente', lado: 'Lado', espalda: 'Espalda' };

type Question = {
  id: string;
  text: string;
  type: string;
  destino?: string;
  options?: string[];
};
type Assignment = {
  id: string;
  name: string | null;
  coach_id: string;
  questions: Question[];
};
type AnswerMap = Record<string, unknown>;

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'form'; assignment: Assignment }
  | { kind: 'success' };

// Sube una imagen al bucket 'fotos' con la misma convención de ruta que la web
// (ProspectoPublico.jsx): cuestionarios/{coachId}/{timestamp}-{rand}.{ext}
async function pickAndUploadPhoto(
  source: 'camera' | 'library',
  coachId: string
): Promise<string | null> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert(
      'Permiso necesario',
      source === 'camera'
        ? 'Necesitamos acceso a la cámara para tomar tu foto de progreso.'
        : 'Necesitamos acceso a tus fotos para adjuntar tu progreso.'
    );
    return null;
  }

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: 'images',
    quality: 0.7,
    base64: true,
  };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

  const asset = result.canceled ? null : result.assets?.[0];
  const base64 = asset?.base64;
  if (!asset || !base64) return null;
  const contentType = asset.mimeType ?? 'image/jpeg';
  const ext = contentType.split('/')[1] || 'jpg';
  const path = `cuestionarios/${coachId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage
    .from('fotos')
    .upload(path, decode(base64), { contentType, upsert: false });
  if (error) {
    console.log('[check-in] upload error:', error);
    Alert.alert('Error', 'No se pudo subir la imagen. Intenta de nuevo.');
    return null;
  }
  const { data } = supabase.storage.from('fotos').getPublicUrl(path);
  return data.publicUrl;
}

export default function CheckInScreen() {
  const { client } = useAuth();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [uploadingAngle, setUploadingAngle] = useState<string | null>(null);

  useEffect(() => {
    if (!client?.id) return;
    let cancelled = false;

    supabase
      .from('cuestionario_asignaciones')
      .select('id, name, coach_id, questions')
      .eq('client_id', client.id)
      .eq('status', 'pendiente')
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.log('[check-in] load error:', error);
        if (data && Array.isArray((data as Assignment).questions) && (data as Assignment).questions.length > 0) {
          setState({ kind: 'form', assignment: data as Assignment });
        } else {
          setState({ kind: 'none' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client?.id]);

  function setAnswer(qid: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  }

  async function handlePhoto(qid: string, angle: string, source: 'camera' | 'library', coachId: string) {
    setUploadingAngle(`${qid}:${angle}`);
    const url = await pickAndUploadPhoto(source, coachId);
    setUploadingAngle(null);
    if (!url) return;
    const current = (answers[qid] && typeof answers[qid] === 'object' ? answers[qid] : {}) as Record<string, string>;
    setAnswer(qid, { ...current, [angle]: url });
  }

  async function handleSubmit(assignment: Assignment) {
    setSubmitting(true);

    const respuestas = assignment.questions.map((q) => ({
      questionId: q.id,
      question: q.text,
      type: q.type,
      destino: q.destino || '',
      answer: answers[q.id] ?? null,
    }));

    const { data, error } = await supabase.rpc('responder_cuestionario_cliente', {
      p_asignacion_id: assignment.id,
      p_respuestas: respuestas,
    });

    setSubmitting(false);
    if (error || data !== true) {
      console.log('[check-in] submit error:', error, 'data:', data);
      Alert.alert('Error', 'No pudimos enviar tu check-in. Intenta de nuevo.');
      return;
    }
    setState({ kind: 'success' });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.title}>Check-in</Text>
      </View>

      {state.kind === 'loading' && <ActivityIndicator style={styles.loader} />}

      {state.kind === 'none' && (
        <View style={styles.messageCard}>
          <Text style={styles.messageText}>No tienes check-ins pendientes.</Text>
        </View>
      )}

      {state.kind === 'success' && (
        <View style={styles.messageCard}>
          <Text style={styles.successIcon}>✅</Text>
          <Text style={styles.messageTitle}>¡Check-in enviado!</Text>
          <Text style={styles.messageText}>Tu coach ya puede ver tus respuestas. ¡Gracias!</Text>
          <Pressable style={styles.button} onPress={() => router.back()}>
            <Text style={styles.buttonText}>Volver al inicio</Text>
          </Pressable>
        </View>
      )}

      {state.kind === 'form' && (
        <>
          <Text style={styles.formName}>{state.assignment.name ?? 'Cuestionario'}</Text>

          {state.assignment.questions.map((q, i) => (
            <View key={q.id} style={styles.field}>
              <Text style={styles.label}>
                {i + 1}. {q.text}
              </Text>
              <QuestionControl
                question={q}
                value={answers[q.id]}
                onChange={(v) => setAnswer(q.id, v)}
                onPhoto={(angle, source) => handlePhoto(q.id, angle, source, state.assignment.coach_id)}
                uploadingAngle={uploadingAngle}
                qid={q.id}
              />
            </View>
          ))}

          <Pressable
            style={[styles.button, submitting && styles.buttonDisabled]}
            onPress={() => handleSubmit(state.assignment)}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Enviar check-in</Text>
            )}
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

function QuestionControl({
  question,
  value,
  onChange,
  onPhoto,
  uploadingAngle,
  qid,
}: {
  question: Question;
  value: unknown;
  onChange: (v: unknown) => void;
  onPhoto: (angle: string, source: 'camera' | 'library') => void;
  uploadingAngle: string | null;
  qid: string;
}) {
  const { type } = question;

  if (type === 'sino') {
    return (
      <View style={styles.rowGap}>
        {['Sí', 'No'].map((opt) => (
          <OptionButton key={opt} label={opt} selected={value === opt} onPress={() => onChange(opt)} flex />
        ))}
      </View>
    );
  }

  if (type === 'opcion') {
    return (
      <View style={styles.optionsWrap}>
        {(question.options ?? []).map((opt, idx) => (
          <OptionButton key={idx} label={opt} selected={value === opt} onPress={() => onChange(opt)} />
        ))}
      </View>
    );
  }

  if (type === 'escala') {
    return (
      <View style={styles.optionsWrap}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <OptionButton key={n} label={String(n)} selected={value === n} onPress={() => onChange(n)} compact />
        ))}
      </View>
    );
  }

  if (type === 'estrellas') {
    return (
      <View style={styles.rowGap}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => onChange(n)}>
            <Text style={[styles.star, (Number(value) || 0) >= n && styles.starOn]}>★</Text>
          </Pressable>
        ))}
      </View>
    );
  }

  if (type === 'numero' || type === 'metrica') {
    return (
      <TextInput
        style={styles.input}
        placeholder="0"
        keyboardType="decimal-pad"
        value={value != null ? String(value) : ''}
        onChangeText={onChange}
      />
    );
  }

  if (type === 'fecha') {
    return (
      <TextInput
        style={styles.input}
        placeholder="AAAA-MM-DD"
        autoCapitalize="none"
        value={value != null ? String(value) : ''}
        onChangeText={onChange}
      />
    );
  }

  if (type === 'firma') {
    return (
      <TextInput
        style={styles.input}
        placeholder="Escribe tu nombre completo como firma"
        value={value != null ? String(value) : ''}
        onChangeText={onChange}
      />
    );
  }

  if (type === 'fotos_progreso') {
    const fotos = (value && typeof value === 'object' ? value : {}) as Record<string, string>;
    return (
      <View style={styles.photoRow}>
        {ANGULOS.map((ang) => {
          const url = fotos[ang];
          const busy = uploadingAngle === `${qid}:${ang}`;
          return (
            <View key={ang} style={styles.photoSlot}>
              <Text style={styles.photoLabel}>{ANGULO_LABEL[ang]}</Text>
              <View style={[styles.photoPreview, url && styles.photoPreviewDone]}>
                {busy ? (
                  <ActivityIndicator />
                ) : (
                  <Text style={styles.photoIcon}>{url ? '✓' : '📷'}</Text>
                )}
              </View>
              <View style={styles.photoButtons}>
                <Pressable style={styles.photoMiniBtn} onPress={() => onPhoto(ang, 'camera')} disabled={busy}>
                  <Text style={styles.photoMiniText}>Cámara</Text>
                </Pressable>
                <Pressable style={styles.photoMiniBtn} onPress={() => onPhoto(ang, 'library')} disabled={busy}>
                  <Text style={styles.photoMiniText}>Galería</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
    );
  }

  if (type === 'video') {
    return (
      <View style={styles.noticeBox}>
        <Text style={styles.noticeText}>La grabación de video estará disponible pronto en la app.</Text>
      </View>
    );
  }

  // texto libre (default)
  return (
    <TextInput
      style={styles.textarea}
      placeholder="Escribe tu respuesta..."
      multiline
      numberOfLines={4}
      textAlignVertical="top"
      value={value != null ? String(value) : ''}
      onChangeText={onChange}
    />
  );
}

function OptionButton({
  label,
  selected,
  onPress,
  flex,
  compact,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  flex?: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.option,
        flex && styles.optionFlex,
        compact && styles.optionCompact,
        selected && styles.optionSelected,
      ]}
    >
      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 24, gap: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backButton: { padding: 4 },
  backArrow: { fontSize: 22 },
  title: { fontSize: 20, fontWeight: '600' },
  loader: { marginTop: 32 },
  formName: { fontSize: 18, fontWeight: '600' },
  messageCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  successIcon: { fontSize: 40 },
  messageTitle: { fontSize: 17, fontWeight: '600' },
  messageText: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20 },
  field: { gap: 8 },
  label: { fontSize: 15, fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  textarea: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 100,
  },
  rowGap: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  optionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
  },
  optionFlex: { flex: 1, alignItems: 'center' },
  optionCompact: { width: 44, alignItems: 'center', paddingHorizontal: 0 },
  optionSelected: { borderColor: '#2563eb', backgroundColor: '#2563eb' },
  optionText: { fontSize: 15, color: '#374151', fontWeight: '500' },
  optionTextSelected: { color: '#fff' },
  star: { fontSize: 32, color: '#d1d5db', paddingHorizontal: 2 },
  starOn: { color: '#f59e0b' },
  photoRow: { flexDirection: 'row', gap: 10 },
  photoSlot: { flex: 1, gap: 6 },
  photoLabel: { fontSize: 12, color: '#6b7280', textAlign: 'center' },
  photoPreview: {
    aspectRatio: 1,
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    borderStyle: 'dashed',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9fafb',
  },
  photoPreviewDone: { borderColor: '#2563eb', backgroundColor: '#e6f1fb', borderStyle: 'solid' },
  photoIcon: { fontSize: 22 },
  photoButtons: { flexDirection: 'row', gap: 4 },
  photoMiniBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    paddingVertical: 5,
    alignItems: 'center',
  },
  photoMiniText: { fontSize: 11, color: '#374151', fontWeight: '500' },
  noticeBox: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
  },
  noticeText: { fontSize: 13, color: '#6b7280' },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
