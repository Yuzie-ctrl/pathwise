import React from 'react';
import { View, type ViewProps } from 'react-native';
import { BlurView } from 'expo-blur';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { AnimatedPressable } from './primitives/animated-pressable';
import { Text } from './text';

const cardVariants = cva('rounded-lg border overflow-hidden', {
  variants: {
    variant: {
      default: 'border-border bg-card',
      glass: 'border-border/50',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface CardProps extends ViewProps, VariantProps<typeof cardVariants> {
  className?: string;
  pressable?: boolean;
  onPress?: () => void;
}

export function Card({
  variant = 'default',
  className,
  pressable,
  onPress,
  children,
  ...props
}: CardProps) {
  const isGlass = variant === 'glass';

  const inner = (
    <>
      {isGlass && (
        <BlurView
          intensity={40}
          tint="default"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        />
      )}
      {children}
    </>
  );

  if (pressable && onPress) {
    return (
      <AnimatedPressable
        onPress={onPress}
        className={cn(cardVariants({ variant }), className)}
        accessibilityRole="button"
        {...props}
      >
        {inner}
      </AnimatedPressable>
    );
  }

  return (
    <View className={cn(cardVariants({ variant }), className)} {...props}>
      {inner}
    </View>
  );
}

export function CardHeader({ className, children, ...props }: ViewProps & { className?: string }) {
  return (
    <View className={cn('p-6 pb-2', className)} {...props}>
      {children}
    </View>
  );
}

export function CardTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <Text weight="semibold" size="lg" className={className}>
      {children}
    </Text>
  );
}

export function CardDescription({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <Text variant="muted" size="sm" className={cn('mt-1', className)}>
      {children}
    </Text>
  );
}

export function CardContent({ className, children, ...props }: ViewProps & { className?: string }) {
  return (
    <View className={cn('p-6 pt-0', className)} {...props}>
      {children}
    </View>
  );
}

export function CardFooter({ className, children, ...props }: ViewProps & { className?: string }) {
  return (
    <View className={cn('flex-row items-center p-6 pt-0', className)} {...props}>
      {children}
    </View>
  );
}
