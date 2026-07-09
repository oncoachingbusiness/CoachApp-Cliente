import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAuth } from '@/lib/auth-context';

export default function Index() {
  const { session, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(session ? '/home' : '/login');
  }, [loading, session]);

  return (
    <View style={styles.container}>
      <ActivityIndicator />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
