import React, { useEffect } from 'react';
import { View, type ViewProps } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  FadeIn,
} from 'react-native-reanimated';
import { cva, type VariantProps } from 'class-variance-authority';
import { cssInterop } from 'react-native-css-interop';

import { cn } from '@/lib/utils';
import { Text } from './text';

cssInterop(Animated.View, { className: 'style' });

const badgeVariants = cva(
  'flex-row items-center rounded-full px-2.5 py-0.5',
  {
    variants: {
      variant: {
        default: 'bg-primary',
        secondary: 'bg-secondary',
        destructive: 'bg-destructive',
        outline: 'border border-border bg-transparent',
        success: 'bg-emerald-500',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const badgeTextVariants = cva('text-xs font-semibold', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      destructive: 'text-destructive-foreground',
      outline: 'text-foreground',
      success: 'text-white',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface BadgeProps
  extends ViewProps,
    VariantProps<typeof badgeVariants> {
  className?: string;
  textClassName?: string;
  animated?: boolean;
  pulse?: boolean;
  children: React.ReactNode;
}

export function Badge({
  variant,
  className,
  textClassName,
  animated,
  pulse,
  children,
  ...props
}: BadgeProps) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (pulse) {
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.6, { duration: 800 }),
          withTiming(1, { duration: 800 }),
        ),
        -1,
        false,
      );
    } else {
      opacity.value = 1;
    }
  }, [pulse, opacity]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const content = (
    <Text className={cn(badgeTextVariants({ variant }), textClassName)}>
      {children}
    </Text>
  );

  if (animated || pulse) {
    return (
      <Animated.View
        entering={animated ? FadeIn.springify() : undefined}
        className={cn(badgeVariants({ variant }), className)}
        style={pulse ? pulseStyle : undefined}
        {...props}
      >
        {content}
      </Animated.View>
    );
  }

  return (
    <View className={cn(badgeVariants({ variant }), className)} {...props}>
      {content}
    </View>
  );
}
