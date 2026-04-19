import React from 'react';
import { Pressable } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
} from 'react-native-reanimated';
import { cva, type VariantProps } from 'class-variance-authority';

import { SPRING_CONFIGS, triggerHaptic } from '@/lib/animations';
import { cn } from '@/lib/utils';

const switchVariants = cva('rounded-full justify-center p-0.5', {
  variants: {
    size: {
      sm: 'w-9 h-5',
      default: 'w-11 h-6',
      lg: 'w-14 h-8',
    },
  },
  defaultVariants: {
    size: 'default',
  },
});

const thumbSizes = {
  sm: { size: 16, travel: 16 },
  default: { size: 20, travel: 20 },
  lg: { size: 28, travel: 24 },
} as const;

export interface SwitchProps extends VariantProps<typeof switchVariants> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export const Switch = React.forwardRef<React.ComponentRef<typeof Pressable>, SwitchProps>(
  ({ checked, onCheckedChange, disabled, size = 'default', className }, ref) => {
    const progress = useDerivedValue(
      () => withSpring(checked ? 1 : 0, SPRING_CONFIGS.snappy),
      [checked],
    );

    const { size: thumbSize, travel } = thumbSizes[size ?? 'default'];

    const trackStyle = useAnimatedStyle(() => ({
      backgroundColor: interpolateColor(
        progress.value,
        [0, 1],
        ['hsl(240, 4.8%, 95.9%)', 'hsl(240, 5.9%, 10%)'],
      ),
    }));

    const thumbStyle = useAnimatedStyle(() => ({
      transform: [
        { translateX: withSpring(checked ? travel : 0, SPRING_CONFIGS.snappy) },
        {
          scale: withSpring(
            progress.value > 0.3 && progress.value < 0.7 ? 1.1 : 1,
            SPRING_CONFIGS.gentle,
          ),
        },
      ],
    }));

    return (
      <Pressable
        ref={ref}
        onPress={() => {
          if (!disabled) {
            triggerHaptic('light');
            onCheckedChange(!checked);
          }
        }}
        disabled={disabled}
        accessibilityRole="switch"
        accessibilityState={{ checked, disabled }}
        className={cn(disabled && 'opacity-50')}
      >
        <Animated.View
          className={cn(switchVariants({ size }), className)}
          style={trackStyle}
        >
          <Animated.View
            className="rounded-full bg-white"
            style={[
              {
                width: thumbSize,
                height: thumbSize,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.15,
                shadowRadius: 2,
                elevation: 2,
              },
              thumbStyle,
            ]}
          />
        </Animated.View>
      </Pressable>
    );
  },
);

Switch.displayName = 'Switch';
