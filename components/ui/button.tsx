import React from 'react';
import { ActivityIndicator, type PressableProps } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { AnimatedPressable } from './primitives/animated-pressable';
import { Text } from './text';

const buttonVariants = cva(
  'flex-row items-center justify-center rounded-md overflow-hidden',
  {
    variants: {
      variant: {
        default: '',
        destructive: 'bg-destructive',
        outline: 'border border-input bg-transparent',
        secondary: 'bg-secondary',
        ghost: 'bg-transparent',
        link: 'bg-transparent',
      },
      size: {
        default: 'h-11 px-5 py-2.5',
        sm: 'h-9 px-3',
        lg: 'h-12 px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

const buttonTextVariants = cva('text-sm font-semibold text-center', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      destructive: 'text-destructive-foreground',
      outline: 'text-foreground',
      secondary: 'text-secondary-foreground',
      ghost: 'text-foreground',
      link: 'text-primary underline',
    },
    size: {
      default: '',
      sm: 'text-xs',
      lg: 'text-base',
      icon: '',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export interface ButtonProps
  extends Omit<PressableProps, 'children'>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  className?: string;
  textClassName?: string;
  children: React.ReactNode;
}

export const Button = React.forwardRef<
  React.ComponentRef<typeof AnimatedPressable>,
  ButtonProps
>(
  (
    {
      variant = 'default',
      size = 'default',
      loading,
      disabled,
      className,
      textClassName,
      children,
      ...props
    },
    ref,
  ) => {
    const isDefault = variant === 'default';
    const haptic = variant === 'destructive' ? 'medium' : 'light';
    const isDisabled = disabled || loading;

    const content =
      typeof children === 'string' ? (
        <Text
          className={cn(
            buttonTextVariants({ variant, size }),
            loading && 'opacity-0',
            textClassName,
          )}
        >
          {children}
        </Text>
      ) : (
        children
      );

    const inner = (
      <>
        {content}
        {loading && (
          <Animated.View
            entering={FadeIn.duration(150)}
            exiting={FadeOut.duration(100)}
            className="absolute inset-0 items-center justify-center"
          >
            <ActivityIndicator
              size="small"
              color={isDefault ? 'hsl(0, 0%, 98%)' : 'hsl(240, 5.9%, 10%)'}
            />
          </Animated.View>
        )}
      </>
    );

    if (isDefault) {
      return (
        <AnimatedPressable
          ref={ref}
          disabled={isDisabled}
          hapticFeedback={haptic}
          className={cn(buttonVariants({ variant, size }), className)}
          accessibilityRole="button"
          {...props}
        >
          <LinearGradient
            colors={['hsl(240, 5.9%, 12%)', 'hsl(240, 5.9%, 10%)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />
          {inner}
        </AnimatedPressable>
      );
    }

    return (
      <AnimatedPressable
        ref={ref}
        disabled={isDisabled}
        hapticFeedback={haptic}
        className={cn(buttonVariants({ variant, size }), className)}
        accessibilityRole="button"
        {...props}
      >
        {inner}
      </AnimatedPressable>
    );
  },
);

Button.displayName = 'Button';
