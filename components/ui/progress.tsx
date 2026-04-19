import React from 'react';
import { View, type ViewProps } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';

import { SPRING_CONFIGS } from '@/lib/animations';
import { cn } from '@/lib/utils';

export interface ProgressProps extends ViewProps {
  value: number;
  max?: number;
  variant?: 'default' | 'gradient';
  className?: string;
}

export function Progress({
  value,
  max = 100,
  variant = 'default',
  className,
  ...props
}: ProgressProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${withSpring(percentage, SPRING_CONFIGS.gentle)}%`,
  }));

  return (
    <View
      className={cn('h-3 w-full overflow-hidden rounded-full bg-secondary', className)}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max, now: value }}
      {...props}
    >
      <Animated.View className="h-full rounded-full" style={animatedStyle}>
        {variant === 'gradient' ? (
          <LinearGradient
            colors={['hsl(240, 5.9%, 10%)', 'hsl(240, 5.9%, 25%)']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1, borderRadius: 9999 }}
          />
        ) : (
          <View className="flex-1 rounded-full bg-primary" />
        )}
      </Animated.View>
    </View>
  );
}
