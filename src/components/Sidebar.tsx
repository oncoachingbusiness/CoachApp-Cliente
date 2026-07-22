import { router, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';

const PANEL_WIDTH = Math.min(300, Dimensions.get('window').width * 0.8);

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const NAV_ITEMS: { label: string; icon: string; href: Href }[] = [
  { label: 'Inicio', icon: '🏠', href: '/home' },
  { label: 'Entrenamiento', icon: '💪', href: '/entrenamiento-hoy' },
  { label: 'Check-in', icon: '📋', href: '/check-in' },
  { label: 'Mensajes', icon: '💬', href: '/mensajes' },
];

export function Sidebar({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { client, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const translateX = useRef(new Animated.Value(-PANEL_WIDTH)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(translateX, { toValue: 0, duration: 220, useNativeDriver: true }),
        Animated.timing(backdrop, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(translateX, { toValue: -PANEL_WIDTH, duration: 200, useNativeDriver: true }),
        Animated.timing(backdrop, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!mounted) return null;

  function go(href: Href) {
    onClose();
    router.navigate(href);
  }

  async function handleSignOut() {
    onClose();
    await signOut();
    router.replace('/');
  }

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <AnimatedPressable style={[styles.backdrop, { opacity: backdrop }]} onPress={onClose} />

        <Animated.View
          style={[
            styles.panel,
            { width: PANEL_WIDTH, transform: [{ translateX }], paddingTop: insets.top + 16 },
          ]}
        >
          <View style={styles.nav}>
            {NAV_ITEMS.map((item) => (
              <Pressable key={item.label} style={styles.navItem} onPress={() => go(item.href)}>
                <Text style={styles.navIcon}>{item.icon}</Text>
                <Text style={styles.navLabel}>{item.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
            <Pressable style={styles.signOutButton} onPress={handleSignOut}>
              <Text style={styles.signOutIcon}>⎋</Text>
              <Text style={styles.signOutText}>Cerrar sesión</Text>
            </Pressable>

            <Pressable style={styles.profile} onPress={() => go('/perfil')}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(client?.name ?? '?').charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.profileInfo}>
                <Text style={styles.profileName} numberOfLines={1}>
                  {client?.name ?? 'Cliente'}
                </Text>
                <Text style={styles.profileEmail} numberOfLines={1}>
                  {client?.email ?? ''}
                </Text>
              </View>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  panel: {
    height: '100%',
    backgroundColor: '#fff',
    borderRightWidth: 1,
    borderRightColor: '#e5e7eb',
    paddingHorizontal: 16,
    justifyContent: 'space-between',
  },
  nav: {
    gap: 4,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  navIcon: {
    fontSize: 18,
    width: 24,
    textAlign: 'center',
  },
  navLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
  footer: {
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 16,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    paddingVertical: 12,
  },
  signOutIcon: {
    fontSize: 16,
    color: '#dc2626',
  },
  signOutText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#dc2626',
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  profileInfo: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  profileEmail: {
    fontSize: 12,
    color: '#6b7280',
  },
});
