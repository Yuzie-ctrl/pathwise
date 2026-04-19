import React from 'react';
import { Pressable, type PressableProps } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type WithSpringConfig,
} from 'react-native-reanimated';
import { cssInterop } from 'react-native-css-interop';

import { SPRING_CONFIGS, triggerHaptic } from '@/lib/animations';
import { cn } from '@/lib/utils';

const ReanimatedPressable = Animated.createAnimatedComponent(Pressable);
cssInterop(ReanimatedPressable, { className: 'style' });

export interface AnimatedPressableProps extends PressableProps {
  scaleValue?: number;
  opacityValue?: number;
  hapticFeedback?: 'light' | 'medium' | 'heavy' | 'none';
  springConfig?: WithSpringConfig;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export const AnimatedPressable = React.forwardRef<
  React.ComponentRef<typeof Pressable>,
  AnimatedPressableProps
>(
  (
    {
      scaleValue = 0.97,
      opacityValue = 0.9,
      hapticFeedback = 'light',
      springConfig = SPRING_CONFIGS.snappy,
      disabled,
      className,
      onPressIn,
      onPressOut,
      children,
      ...props
    },
    ref,
  ) => {
    const scale = useSharedValue(1);
    const opacity = useSharedValue(1);

    const animatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: scale.value }],
      opacity: opacity.value,
    }));

    return (
      <ReanimatedPressable
        ref={ref}
        disabled={disabled}
        className={cn(disabled && 'opacity-50', className)}
        style={animatedStyle}
        onPressIn={(e) => {
          scale.value = withSpring(scaleValue, springConfig);
          opacity.value = withSpring(opacityValue, springConfig);
          if (hapticFeedback !== 'none') triggerHaptic(hapticFeedback);
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          scale.value = withSpring(1, springConfig);
          opacity.value = withSpring(1, springConfig);
          onPressOut?.(e);
        }}
        accessibilityState={{ disabled }}
        {...props}
      >
        {children}
      </ReanimatedPressable>
    );
  },
);

AnimatedPressable.displayName = 'AnimatedPressable';
