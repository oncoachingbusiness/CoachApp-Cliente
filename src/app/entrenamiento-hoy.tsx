import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

// Réplica exacta del cálculo de fecha local del panel web (ClientProfile.jsx:
// eDateStr / eTodayStr). Usa el offset local para no desfasarse un día por UTC,
// de modo que coincida con las filas que el web insertó en client_entrenamientos.
function localDateStr(date: Date): string {
  const dt = new Date(date);
  dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
  return dt.toISOString().slice(0, 10);
}
const TODAY = localDateStr(new Date());

type ExerciseSet = {
  reps?: string;
  weight?: string;
  rest?: string;
  time?: string;
};
type Exercise = {
  id?: string;
  name?: string;
  note?: string;
  supersetGroup?: string;
  sets?: ExerciseSet[];
};
type WorkoutRow = {
  id: string;
  workout_name: string | null;
  exercises: Exercise[] | null;
  completado?: boolean | null;
  ejercicios_completados?: number[] | null;
};

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'no-program' }
  | { kind: 'rest' }
  | { kind: 'workout'; row: WorkoutRow };

const dateLabel = (() => {
  const raw = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
  return raw.charAt(0).toUpperCase() + raw.slice(1);
})();

export default function EntrenamientoHoyScreen() {
  const { client } = useAuth();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [completedIdx, setCompletedIdx] = useState<Set<number>>(new Set());
  const [workoutDone, setWorkoutDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const clientId = client?.id;
    if (!clientId) return;
    try {
      // Entrenamiento asignado para hoy (la proyección de ciclo ya está
      // materializada por el web: una fila por fecha, descanso = sin fila).
      const todayRes = await supabase
        .from('client_entrenamientos')
        .select('id, workout_name, exercises, completado, ejercicios_completados')
        .eq('client_id', clientId)
        .eq('date', TODAY)
        .maybeSingle();

      if (todayRes.data) {
        const row = todayRes.data as WorkoutRow;
        setCompletedIdx(new Set(row.ejercicios_completados ?? []));
        setWorkoutDone(!!row.completado);
        setState({ kind: 'workout', row });
        return;
      }

      // Sin fila hoy: distinguir descanso (tiene programa vigente) de
      // sin-programa (no tiene ninguna fila alrededor de hoy).
      const anyRes = await supabase
        .from('client_entrenamientos')
        .select('id')
        .eq('client_id', clientId)
        .gte('date', TODAY)
        .limit(1);

      setState({ kind: (anyRes.data ?? []).length > 0 ? 'rest' : 'no-program' });
    } catch (error) {
      console.log('[entrenamiento-hoy] load error:', error);
      setState({ kind: 'no-program' });
    }
  }, [client?.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: si el coach asigna o cambia el entrenamiento, se refleja solo.
  useEffect(() => {
    const clientId = client?.id;
    if (!clientId) return;

    const channel = supabase
      .channel(`entrenamiento-hoy-${clientId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'client_entrenamientos', filter: `client_id=eq.${clientId}` },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [client?.id, load]);

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
    if (error) console.log('[entrenamiento-hoy] toggleExercise error:', error);
  }

  async function markWorkoutComplete() {
    if (state.kind !== 'workout') return;
    setSaving(true);
    setWorkoutDone(true);

    const { error } = await supabase
      .from('client_entrenamientos')
      .update({ completado: true, completado_at: new Date().toISOString() })
      .eq('id', state.row.id);
    setSaving(false);
    if (error) console.log('[entrenamiento-hoy] markWorkoutComplete error:', error);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Entrenamiento de hoy</Text>
          <Text style={styles.date}>{dateLabel}</Text>
        </View>
      </View>

      {state.kind === 'loading' && <ActivityIndicator style={styles.loader} />}

      {state.kind === 'no-program' && (
        <View style={styles.messageCard}>
          <Text style={styles.messageText}>
            Aún no tienes un programa de entrenamiento asignado. Tu coach lo configurará pronto.
          </Text>
        </View>
      )}

      {state.kind === 'rest' && (
        <View style={styles.messageCard}>
          <Text style={styles.restIcon}>😴</Text>
          <Text style={styles.messageTitle}>Día de descanso</Text>
          <Text style={styles.messageText}>Hoy toca recuperar. Nos vemos en el próximo entrenamiento.</Text>
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
                <Pressable key={ex.id ?? ei} style={styles.exerciseCard} onPress={() => toggleExercise(ei)}>
                  <View style={styles.exerciseHeader}>
                    <View style={[styles.checkbox, done && styles.checkboxDone]}>
                      {done && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <Text style={[styles.exerciseName, done && styles.exerciseNameDone]}>
                      {ex.name || `Ejercicio ${ei + 1}`}
                    </Text>
                  </View>

                  {ex.note ? <Text style={styles.exerciseNote}>{ex.note}</Text> : null}

                  {(ex.sets ?? []).length > 0 && (
                    <View style={styles.setsTable}>
                      <View style={styles.setRowHeader}>
                        <Text style={[styles.setCell, styles.setCellNum]}>#</Text>
                        <Text style={styles.setCell}>Reps</Text>
                        <Text style={styles.setCell}>Peso</Text>
                      </View>
                      {(ex.sets ?? []).map((s, si) => (
                        <View key={si} style={styles.setRow}>
                          <Text style={[styles.setCell, styles.setCellNum]}>{si + 1}</Text>
                          <Text style={styles.setCell}>{s.reps || s.time || '–'}</Text>
                          <Text style={styles.setCell}>{s.weight ? `${s.weight} kg` : '–'}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </Pressable>
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 24,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerText: {
    gap: 2,
  },
  backButton: {
    padding: 4,
  },
  backArrow: {
    fontSize: 22,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  date: {
    fontSize: 13,
    color: '#6b7280',
  },
  loader: {
    marginTop: 32,
  },
  messageCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  restIcon: {
    fontSize: 32,
  },
  messageTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  messageText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  workoutName: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 4,
  },
  exerciseCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  exerciseName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  exerciseNameDone: {
    color: '#9ca3af',
    textDecorationLine: 'line-through',
  },
  exerciseNote: {
    fontSize: 12,
    color: '#6b7280',
    fontStyle: 'italic',
  },
  setsTable: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    overflow: 'hidden',
  },
  setRowHeader: {
    flexDirection: 'row',
    backgroundColor: '#f9fafb',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  setRow: {
    flexDirection: 'row',
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  setCell: {
    flex: 2,
    fontSize: 13,
    textAlign: 'center',
    color: '#374151',
  },
  setCellNum: {
    flex: 1,
    color: '#9ca3af',
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
