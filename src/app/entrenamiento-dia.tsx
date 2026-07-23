import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

function localDateStr(date: Date): string {
  const dt = new Date(date);
  dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
  return dt.toISOString().slice(0, 10);
}
const TODAY = localDateStr(new Date());

type ExerciseSet = { reps?: string; weight?: string; rest?: string; time?: string };
type Exercise = { id?: string; name?: string; note?: string; supersetGroup?: string; sets?: ExerciseSet[] };
type ActualSet = { reps?: string; weight?: string };
type Registro = Record<string, Record<string, ActualSet>>;
type WorkoutRow = {
  id: string;
  workout_name: string | null;
  exercises: Exercise[] | null;
  completado?: boolean | null;
  ejercicios_completados?: number[] | null;
  registro_cliente?: Registro | null;
};

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'no-workout' }
  | { kind: 'workout'; row: WorkoutRow };

function formatDateLabel(dateStr: string): string {
  const raw = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(dateStr + 'T12:00:00'));
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export default function EntrenamientoDiaScreen() {
  const { client } = useAuth();
  const { date } = useLocalSearchParams<{ date?: string }>();
  const targetDate = date ?? TODAY;

  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [completedIdx, setCompletedIdx] = useState<Set<number>>(new Set());
  const [workoutDone, setWorkoutDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [registro, setRegistro] = useState<Registro>({});
  // Espejo síncrono para persistir el valor más reciente al perder foco.
  const registroRef = useRef<Registro>({});
  registroRef.current = registro;
  const rowIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const clientId = client?.id;
    if (!clientId) return;
    try {
      const res = await supabase
        .from('client_entrenamientos')
        .select('id, workout_name, exercises, completado, ejercicios_completados, registro_cliente')
        .eq('client_id', clientId)
        .eq('date', targetDate)
        .maybeSingle();

      if (res.data) {
        const row = res.data as WorkoutRow;
        rowIdRef.current = row.id;
        setCompletedIdx(new Set(row.ejercicios_completados ?? []));
        setWorkoutDone(!!row.completado);
        setRegistro(row.registro_cliente ?? {});
        setState({ kind: 'workout', row });
      } else {
        setState({ kind: 'no-workout' });
      }
    } catch (error) {
      console.log('[entrenamiento-dia] load error:', error);
      setState({ kind: 'no-workout' });
    }
  }, [client?.id, targetDate]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const clientId = client?.id;
    if (!clientId) return;
    const channel = supabase
      .channel(`entrenamiento-dia-${clientId}-${targetDate}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'client_entrenamientos', filter: `client_id=eq.${clientId}` },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [client?.id, targetDate, load]);

  async function toggleExercise(index: number) {
    if (state.kind !== 'workout') return;
    const next = new Set(completedIdx);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setCompletedIdx(next);
    const { error } = await supabase
      .from('client_entrenamientos')
      .update({ ejercicios_completados: Array.from(next) })
      .eq('id', state.row.id);
    if (error) console.log('[entrenamiento-dia] toggleExercise error:', error);
  }

  function setActual(ei: number, si: number, field: keyof ActualSet, value: string) {
    setRegistro((prev) => ({
      ...prev,
      [ei]: { ...(prev[ei] ?? {}), [si]: { ...(prev[ei]?.[si] ?? {}), [field]: value } },
    }));
  }

  async function persistRegistro() {
    const id = rowIdRef.current;
    if (!id) return;
    const { error } = await supabase
      .from('client_entrenamientos')
      .update({ registro_cliente: registroRef.current })
      .eq('id', id);
    if (error) console.log('[entrenamiento-dia] persistRegistro error:', error);
  }

  async function markWorkoutComplete() {
    if (state.kind !== 'workout') return;
    setSaving(true);
    setWorkoutDone(true);
    // Asegura que el último registro editado quede guardado junto con el estado.
    await persistRegistro();
    const { error } = await supabase
      .from('client_entrenamientos')
      .update({ completado: true, completado_at: new Date().toISOString() })
      .eq('id', state.row.id);
    setSaving(false);
    if (error) console.log('[entrenamiento-dia] markWorkoutComplete error:', error);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backArrow}>←</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Entrenamiento</Text>
            <Text style={styles.date}>{formatDateLabel(targetDate)}</Text>
          </View>
        </View>

        {state.kind === 'loading' && <ActivityIndicator style={styles.loader} />}

        {state.kind === 'no-workout' && (
          <View style={styles.messageCard}>
            <Text style={styles.restIcon}>😴</Text>
            <Text style={styles.messageTitle}>Día de descanso</Text>
            <Text style={styles.messageText}>No tienes entrenamiento asignado para este día.</Text>
          </View>
        )}

        {state.kind === 'workout' && (
          <>
            <Text style={styles.workoutName}>{state.row.workout_name ?? 'Entrenamiento'}</Text>

            {(state.row.exercises ?? []).length === 0 ? (
              <View style={styles.messageCard}>
                <Text style={styles.messageText}>Este entrenamiento no tiene ejercicios detallados.</Text>
              </View>
            ) : (
              (state.row.exercises ?? []).map((ex, ei) => {
                const done = completedIdx.has(ei);
                return (
                  <View key={ex.id ?? ei} style={styles.exerciseCard}>
                    <View style={styles.exerciseHeader}>
                      <Pressable
                        onPress={() => toggleExercise(ei)}
                        hitSlop={8}
                        style={[styles.checkbox, done && styles.checkboxDone]}
                      >
                        {done && <Text style={styles.checkmark}>✓</Text>}
                      </Pressable>
                      <Text style={[styles.exerciseName, done && styles.exerciseNameDone]}>
                        {ex.name || `Ejercicio ${ei + 1}`}
                      </Text>
                    </View>

                    {ex.note ? <Text style={styles.exerciseNote}>{ex.note}</Text> : null}

                    {(ex.sets ?? []).length > 0 && (
                      <View style={styles.setsTable}>
                        <View style={styles.setRowHeader}>
                          <Text style={[styles.hCell, styles.cNum]}>#</Text>
                          <Text style={[styles.hCell, styles.cObj]}>Objetivo</Text>
                          <Text style={[styles.hCell, styles.cInput]}>Reps</Text>
                          <Text style={[styles.hCell, styles.cInput]}>Peso</Text>
                        </View>
                        {(ex.sets ?? []).map((s, si) => {
                          const actual = registro[ei]?.[si] ?? {};
                          const objReps = s.reps || s.time || '–';
                          const objWeight = s.weight ? `${s.weight}kg` : '–';
                          return (
                            <View key={si} style={styles.setRow}>
                              <Text style={[styles.cell, styles.cNum]}>{si + 1}</Text>
                              <Text style={[styles.cell, styles.cObj]}>
                                {objReps} × {objWeight}
                              </Text>
                              <TextInput
                                style={[styles.input, styles.cInput]}
                                placeholder={s.reps || s.time || '–'}
                                keyboardType="number-pad"
                                value={actual.reps ?? ''}
                                onChangeText={(v) => setActual(ei, si, 'reps', v)}
                                onBlur={persistRegistro}
                              />
                              <TextInput
                                style={[styles.input, styles.cInput]}
                                placeholder={s.weight || '–'}
                                keyboardType="decimal-pad"
                                value={actual.weight ?? ''}
                                onChangeText={(v) => setActual(ei, si, 'weight', v)}
                                onBlur={persistRegistro}
                              />
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })
            )}

            <Pressable
              style={[styles.button, (workoutDone || saving) && styles.buttonDisabled]}
              onPress={markWorkoutComplete}
              disabled={workoutDone || saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>
                  {workoutDone ? '✓ Entrenamiento completado' : 'Marcar entrenamiento completo'}
                </Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },
  content: { padding: 24, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerText: { gap: 2 },
  backButton: { padding: 4 },
  backArrow: { fontSize: 22 },
  title: { fontSize: 20, fontWeight: '600' },
  date: { fontSize: 13, color: '#6b7280' },
  loader: { marginTop: 32 },
  messageCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  restIcon: { fontSize: 32 },
  messageTitle: { fontSize: 17, fontWeight: '600' },
  messageText: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20 },
  workoutName: { fontSize: 18, fontWeight: '600', marginTop: 4 },
  exerciseCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  exerciseHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  exerciseName: { flex: 1, fontSize: 15, fontWeight: '600' },
  exerciseNameDone: { color: '#9ca3af', textDecorationLine: 'line-through' },
  exerciseNote: { fontSize: 12, color: '#6b7280', fontStyle: 'italic' },
  setsTable: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, overflow: 'hidden' },
  setRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 6,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 6,
  },
  hCell: { fontSize: 11, fontWeight: '700', color: '#6b7280', textAlign: 'center' },
  cell: { fontSize: 13, color: '#374151', textAlign: 'center' },
  cNum: { flex: 0.6 },
  cObj: { flex: 2 },
  cInput: { flex: 1.4 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 14,
    textAlign: 'center',
    backgroundColor: '#fff',
  },
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
