import { ImpactFeedbackStyle, impactAsync } from 'expo-haptics';
import { Platform } from 'react-native';
import type { WithSpringConfig, WithTimingConfig } from 'react-native-reanimated';

export const SPRING_CONFIGS = {
  gentle: { damping: 20, stiffness: 120, mass: 1 } satisfies WithSpringConfig,
  snappy: { damping: 15, stiffness: 200, mass: 0.8 } satisfies WithSpringConfig,
  bouncy: { damping: 10, stiffness: 150, mass: 1 } satisfies WithSpringConfig,
  stiff: { damping: 20, stiffness: 300, mass: 1 } satisfies WithSpringConfig,
} as const;

export const TIMING_CONFIGS = {
  fast: { duration: 150 } satisfies WithTimingConfig,
  normal: { duration: 250 } satisfies WithTimingConfig,
  slow: { duration: 400 } satisfies WithTimingConfig,
} as const;

export function triggerHaptic(style: 'light' | 'medium' | 'heavy' = 'light') {
  if (Platform.OS === 'web') return;
  const map = {
    light: ImpactFeedbackStyle.Light,
    medium: ImpactFeedbackStyle.Medium,
    heavy: ImpactFeedbackStyle.Heavy,
  } as const;
  impactAsync(map[style]).catch(() => {});
}
