import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { colors } from '@/lib/theme';
import { Glass } from './ui';

type ToastState = { message: string | null; id: number; show: (message: string) => void };

export const useToast = create<ToastState>((set) => ({
  message: null,
  id: 0,
  show: (message) => set((s) => ({ message, id: s.id + 1 })),
}));

export function toast(message: string) {
  useToast.getState().show(message);
}

/** Timed, non-blocking feedback at the top of the screen. */
export function ToastHost() {
  const { message, id } = useToast();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => useToast.setState({ message: null }), 2200);
    return () => clearTimeout(timer);
  }, [id, message]);
  if (!message) return null;
  return (
    <Animated.View
      key={id}
      entering={FadeInUp}
      exiting={FadeOutUp}
      pointerEvents="none"
      style={[styles.wrap, { top: insets.top + 8 }]}
    >
      <Glass intensity={60} style={styles.toast}>
        <Text style={styles.text}>{message}</Text>
      </Glass>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 100 },
  toast: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999 },
  text: { color: colors.text, fontSize: 15, fontWeight: '500' },
});
