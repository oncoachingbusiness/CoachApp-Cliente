import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/lib/auth-context';

export default function HomeScreen() {
  const { client } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Hola, {client?.name ?? 'cliente'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 24,
    fontWeight: '600',
  },
});
