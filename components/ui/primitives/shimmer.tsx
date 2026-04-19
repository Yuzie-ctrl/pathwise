import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { cn } from '@/lib/utils';

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

export interface ShimmerProps {
  width: number;
  duration?: number;
  className?: string;
}

export function Shimmer({ width, duration = 1500, className }: ShimmerProps) {
  const translateX = useSharedValue(-width);

  useEffect(() => {
    translateX.value = withRepeat(
      withTiming(width, { duration, easing: Easing.linear }),
      -1,
      false,
    );
  }, [width, duration, translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View className={cn('overflow-hidden absolute inset-0', className)} pointerEvents="none">
      <AnimatedLinearGradient
        colors={['transparent', 'rgba(255,255,255,0.2)', 'transparent']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[StyleSheet.absoluteFill, { width }, animatedStyle]}
      />
    </View>
  );
}
