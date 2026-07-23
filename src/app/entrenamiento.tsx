import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

function localDateStr(date: Date): string {
  const dt = new Date(date);
  dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
  return dt.toISOString().slice(0, 10);
}
const TODAY = localDateStr(new Date());

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

type DayInfo = { name: string | null; completado: boolean };
type MonthMap = Record<string, DayInfo>;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function monthLabel(cursor: Date): string {
  const raw = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(cursor);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export default function EntrenamientoMesScreen() {
  const { client } = useAuth();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [monthMap, setMonthMap] = useState<MonthMap>({});
  const [loading, setLoading] = useState(true);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstStr = `${year}-${pad(month + 1)}-01`;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lastStr = `${year}-${pad(month + 1)}-${pad(daysInMonth)}`;

  const load = useCallback(async () => {
    const clientId = client?.id;
    if (!clientId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('client_entrenamientos')
      .select('date, workout_name, completado')
      .eq('client_id', clientId)
      .gte('date', firstStr)
      .lte('date', lastStr);
    if (error) console.log('[entrenamiento] load error:', error);
    const map: MonthMap = {};
    for (const row of data ?? []) {
      map[row.date as string] = {
        name: (row.workout_name as string) ?? null,
        completado: !!row.completado,
      };
    }
    setMonthMap(map);
    setLoading(false);
  }, [client?.id, firstStr, lastStr]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const clientId = client?.id;
    if (!clientId) return;
    const channel = supabase
      .channel(`entrenamiento-mes-${clientId}`)
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

  // Celdas de la grilla (blancos al inicio para alinear lunes-primero).
  const cells = useMemo(() => {
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // 0 = lunes
    const arr: (number | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    return arr;
  }, [year, month, daysInMonth]);

  const workoutDays = useMemo(
    () => Object.keys(monthMap).sort(),
    [monthMap]
  );

  function openDay(dateStr: string) {
    router.push({ pathname: '/entrenamiento-dia', params: { date: dateStr } });
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Entrenamiento</Text>

        <View style={styles.monthNav}>
          <Pressable
            hitSlop={8}
            onPress={() => setCursor(new Date(year, month - 1, 1))}
            style={styles.navBtn}
          >
            <Text style={styles.navArrow}>‹</Text>
          </Pressable>
          <Text style={styles.monthLabel}>{monthLabel(cursor)}</Text>
          <Pressable
            hitSlop={8}
            onPress={() => setCursor(new Date(year, month + 1, 1))}
            style={styles.navBtn}
          >
            <Text style={styles.navArrow}>›</Text>
          </Pressable>
        </View>

        <View style={styles.calendarCard}>
          <View style={styles.weekRow}>
            {WEEKDAYS.map((w, i) => (
              <Text key={i} style={styles.weekLabel}>
                {w}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((day, i) => {
              if (day === null) return <View key={i} style={styles.cell} />;
              const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`;
              const info = monthMap[dateStr];
              const isToday = dateStr === TODAY;
              const inner = (
                <View
                  style={[
                    styles.cellInner,
                    info && styles.cellWorkout,
                    isToday && styles.cellToday,
                  ]}
                >
                  <Text style={[styles.cellDay, info && styles.cellDayWorkout]}>{day}</Text>
                  {info && <View style={[styles.dot, info.completado && styles.dotDone]} />}
                </View>
              );
              return info ? (
                <Pressable key={i} style={styles.cell} onPress={() => openDay(dateStr)}>
                  {inner}
                </Pressable>
              ) : (
                <View key={i} style={styles.cell}>
                  {inner}
                </View>
              );
            })}
          </View>
        </View>

        {loading && <ActivityIndicator style={styles.loader} />}

        {!loading && workoutDays.length === 0 && (
          <View style={styles.messageCard}>
            <Text style={styles.messageText}>No tienes entrenamientos planificados este mes.</Text>
          </View>
        )}

        {!loading && workoutDays.length > 0 && (
          <View style={styles.list}>
            <Text style={styles.listTitle}>Rutinas del mes</Text>
            {workoutDays.map((dateStr) => {
              const info = monthMap[dateStr];
              const d = new Date(dateStr + 'T12:00:00');
              const label = new Intl.DateTimeFormat('es-ES', {
                weekday: 'short',
                day: 'numeric',
              }).format(d);
              return (
                <Pressable key={dateStr} style={styles.listRow} onPress={() => openDay(dateStr)}>
                  <Text style={styles.listDate}>{label}</Text>
                  <Text style={styles.listName} numberOfLines={1}>
                    {info.name ?? 'Entrenamiento'}
                  </Text>
                  {info.completado && <Text style={styles.listDone}>✓</Text>}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },
  content: { padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: '600' },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navBtn: { padding: 8 },
  navArrow: { fontSize: 24, color: '#2563eb', fontWeight: '600' },
  monthLabel: { fontSize: 16, fontWeight: '600' },
  calendarCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
  },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: '#9ca3af',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    padding: 3,
  },
  cellInner: {
    flex: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  cellWorkout: { backgroundColor: '#e6f1fb' },
  cellToday: { borderWidth: 2, borderColor: '#2563eb' },
  cellDay: { fontSize: 14, color: '#374151' },
  cellDayWorkout: { color: '#1d4ed8', fontWeight: '700' },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#2563eb',
  },
  dotDone: { backgroundColor: '#16a34a' },
  loader: { marginTop: 16 },
  messageCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
  },
  messageText: { fontSize: 14, color: '#6b7280', textAlign: 'center' },
  list: { gap: 8 },
  listTitle: { fontSize: 15, fontWeight: '600', color: '#374151', marginBottom: 2 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 14,
  },
  listDate: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
    width: 64,
    textTransform: 'capitalize',
  },
  listName: { flex: 1, fontSize: 15, fontWeight: '500', color: '#111827' },
  listDone: { fontSize: 15, color: '#16a34a', fontWeight: '700' },
});
