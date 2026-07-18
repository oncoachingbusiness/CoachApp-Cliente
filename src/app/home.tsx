import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

type WorkoutToday = {
  name: string;
  programName: string | null;
};

type DashboardData = {
  workoutToday: WorkoutToday | null;
  streakDays: number;
  lastWeightKg: number | null;
  checkinPending: boolean;
  hasUnreadMessage: boolean;
};

const rawDateLabel = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
}).format(new Date());
const TODAY_LABEL = rawDateLabel.charAt(0).toUpperCase() + rawDateLabel.slice(1);

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function computeStreakDays(dates: string[]): number {
  const uniqueSorted = Array.from(new Set(dates)).sort((a, b) => (a < b ? 1 : -1));
  if (uniqueSorted.length === 0) return 0;

  const today = new Date();
  const mostRecent = new Date(uniqueSorted[0]);
  const daysSinceLastEntry = Math.round(
    (today.setHours(0, 0, 0, 0) - mostRecent.setHours(0, 0, 0, 0)) / 86400000
  );
  if (daysSinceLastEntry > 1) return 0;

  let streak = 1;
  let cursor = new Date(uniqueSorted[0]);
  for (let i = 1; i < uniqueSorted.length; i++) {
    const prevDay = new Date(cursor);
    prevDay.setDate(cursor.getDate() - 1);
    if (toISODate(prevDay) === uniqueSorted[i]) {
      streak++;
      cursor = prevDay;
    } else {
      break;
    }
  }
  return streak;
}

async function fetchDashboardData(clientId: string): Promise<DashboardData> {
  const today = new Date();
  const todayISO = toISODate(today);

  const [assignmentRes, entrenamientosRes, metricsRes, checkinsRes, messagesRes] =
    await Promise.all([
      supabase
        .from('client_assignments')
        .select('workout_name, program_name')
        .eq('client_id', clientId)
        .eq('date', todayISO)
        .maybeSingle(),
      supabase
        .from('client_entrenamientos')
        .select('date')
        .eq('client_id', clientId)
        .order('date', { ascending: false })
        .limit(60),
      supabase
        .from('metrics')
        .select('weight')
        .eq('client_id', clientId)
        .not('weight', 'is', null)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('cuestionario_asignaciones')
        .select('id')
        .eq('client_id', clientId)
        .eq('status', 'pendiente')
        .limit(1),
      supabase
        .from('messages')
        .select('id')
        .eq('client_id', clientId)
        .eq('sender', 'coach')
        .is('read_at', null)
        .limit(1),
    ]);

  console.log('[home] dashboard fetch errors:', {
    assignment: assignmentRes.error,
    entrenamientos: entrenamientosRes.error,
    metrics: metricsRes.error,
    checkins: checkinsRes.error,
    messages: messagesRes.error,
  });

  return {
    workoutToday: assignmentRes.data
      ? { name: assignmentRes.data.workout_name, programName: assignmentRes.data.program_name }
      : null,
    streakDays: computeStreakDays((entrenamientosRes.data ?? []).map((row) => row.date)),
    lastWeightKg: metricsRes.data?.weight ?? null,
    checkinPending: (checkinsRes.data ?? []).length > 0,
    hasUnreadMessage: (messagesRes.data ?? []).length > 0,
  };
}

export default function HomeScreen() {
  const { client } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!client?.id) return;

    let cancelled = false;
    setLoading(true);

    fetchDashboardData(client.id)
      .then((data) => {
        if (!cancelled) setDashboard(data);
      })
      .catch((error) => {
        console.log('[home] fetchDashboardData error:', error);
        if (!cancelled) setDashboard(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client?.id]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Hola, {client?.name ?? 'cliente'}</Text>
        <Text style={styles.date}>{TODAY_LABEL}</Text>
      </View>

      <Pressable style={styles.featuredCard} onPress={() => router.push('/entrenamiento-hoy')}>
        <Text style={styles.featuredLabel}>Entrenamiento de hoy</Text>
        {loading ? (
          <ActivityIndicator style={styles.inlineLoader} />
        ) : dashboard?.workoutToday ? (
          <>
            <Text style={styles.featuredTitle}>{dashboard.workoutToday.name}</Text>
            {dashboard.workoutToday.programName && (
              <Text style={styles.featuredMeta}>{dashboard.workoutToday.programName}</Text>
            )}
          </>
        ) : (
          <Text style={styles.emptyText}>No tienes entrenamiento asignado para hoy.</Text>
        )}
      </Pressable>

      <View style={styles.row}>
        <View style={[styles.card, styles.halfCard]}>
          <Text style={styles.cardValue}>{loading ? '—' : dashboard?.streakDays ?? 0}</Text>
          <Text style={styles.cardLabel}>días de racha</Text>
        </View>
        <View style={[styles.card, styles.halfCard]}>
          <Text style={styles.cardValue}>
            {loading ? '—' : dashboard?.lastWeightKg != null ? `${dashboard.lastWeightKg} kg` : 'Sin registros'}
          </Text>
          <Text style={styles.cardLabel}>último peso</Text>
        </View>
      </View>

      <Pressable style={styles.listRow} onPress={() => router.push('/check-in')}>
        <Text style={styles.listIcon}>📋</Text>
        <Text style={styles.listTitle}>Check-in de la semana</Text>
        <Text style={styles.listStatus}>
          {loading ? '—' : dashboard?.checkinPending ? 'Pendiente' : 'Completado'}
        </Text>
      </Pressable>

      <Pressable
        style={styles.listRow}
        onPress={() => Alert.alert('Próximamente', 'Los mensajes con tu coach estarán disponibles pronto.')}
      >
        <Text style={styles.listIcon}>💬</Text>
        <Text style={styles.listTitle}>Mensaje de tu coach</Text>
        <Text style={styles.listStatus}>
          {loading ? '—' : dashboard?.hasUnreadMessage ? 'Sin leer' : 'Al día'}
        </Text>
      </Pressable>
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
    gap: 4,
    marginBottom: 8,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '600',
  },
  date: {
    fontSize: 14,
    color: '#6b7280',
  },
  featuredCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  featuredLabel: {
    fontSize: 13,
    color: '#6b7280',
  },
  featuredTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  featuredMeta: {
    fontSize: 14,
    color: '#374151',
  },
  emptyText: {
    fontSize: 14,
    color: '#6b7280',
  },
  inlineLoader: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 16,
  },
  halfCard: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  cardValue: {
    fontSize: 20,
    fontWeight: '600',
  },
  cardLabel: {
    fontSize: 13,
    color: '#6b7280',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  listIcon: {
    fontSize: 18,
  },
  listTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  listStatus: {
    fontSize: 13,
    color: '#6b7280',
  },
});
