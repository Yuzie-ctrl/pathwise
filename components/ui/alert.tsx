import React from 'react';
import { View, type ViewProps } from 'react-native';
import Animated, { SlideInLeft } from 'react-native-reanimated';
import { cva, type VariantProps } from 'class-variance-authority';
import { cssInterop } from 'react-native-css-interop';

import { cn } from '@/lib/utils';
import { Text } from './text';

cssInterop(Animated.View, { className: 'style' });

const alertVariants = cva(
  'w-full rounded-lg border p-4',
  {
    variants: {
      variant: {
        default: 'border-border bg-background',
        destructive: 'border-destructive/50 bg-destructive/10',
        success: 'border-emerald-500/50 bg-emerald-500/10',
        warning: 'border-amber-500/50 bg-amber-500/10',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface AlertProps
  extends ViewProps,
    VariantProps<typeof alertVariants> {
  className?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export function Alert({ variant, className, icon, children, ...props }: AlertProps) {
  return (
    <Animated.View
      entering={SlideInLeft.springify().damping(15)}
      className={cn(alertVariants({ variant }), className)}
      accessibilityRole="alert"
      {...props}
    >
      <View className="flex-row gap-3">
        {icon && <View className="mt-0.5">{icon}</View>}
        <View className="flex-1">{children}</View>
      </View>
    </Animated.View>
  );
}

export interface AlertTitleProps {
  className?: string;
  children: React.ReactNode;
}

export function AlertTitle({ className, children }: AlertTitleProps) {
  return (
    <Text weight="semibold" className={cn('mb-1', className)}>
      {children}
    </Text>
  );
}

export interface AlertDescriptionProps {
  className?: string;
  children: React.ReactNode;
}

export function AlertDescription({ className, children }: AlertDescriptionProps) {
  return (
    <Text size="sm" variant="muted" className={className}>
      {children}
    </Text>
  );
}
