import React, { useCallback, useState } from 'react';
import {
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  withSpring,
} from 'react-native-reanimated';

import { SPRING_CONFIGS, TIMING_CONFIGS } from '@/lib/animations';
import { cn } from '@/lib/utils';
import { Text } from './text';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  className?: string;
}

export const Input = React.forwardRef<TextInput, InputProps>(
  (
    {
      label,
      error,
      helperText,
      leftIcon,
      rightIcon,
      className,
      onFocus,
      onBlur,
      ...props
    },
    ref,
  ) => {
    const [focused, setFocused] = useState(false);
    const shakeX = useSharedValue(0);
    const borderOpacity = useSharedValue(0);

    const handleFocus = useCallback(
      (e: any) => {
        setFocused(true);
        borderOpacity.value = withSpring(1, SPRING_CONFIGS.snappy);
        onFocus?.(e);
      },
      [onFocus, borderOpacity],
    );

    const handleBlur = useCallback(
      (e: any) => {
        setFocused(false);
        borderOpacity.value = withSpring(0, SPRING_CONFIGS.gentle);
        onBlur?.(e);
      },
      [onBlur, borderOpacity],
    );

    const shakeError = useCallback(() => {
      shakeX.value = withSequence(
        withTiming(-8, TIMING_CONFIGS.fast),
        withTiming(8, TIMING_CONFIGS.fast),
        withTiming(-4, TIMING_CONFIGS.fast),
        withTiming(4, TIMING_CONFIGS.fast),
        withTiming(0, TIMING_CONFIGS.fast),
      );
    }, [shakeX]);

    React.useEffect(() => {
      if (error) shakeError();
    }, [error, shakeError]);

    const shakeStyle = useAnimatedStyle(() => ({
      transform: [{ translateX: shakeX.value }],
    }));

    return (
      <Animated.View style={shakeStyle} className="w-full">
        {label && (
          <Text weight="medium" size="sm" className="mb-1.5">
            {label}
          </Text>
        )}
        <View
          className={cn(
            'flex-row items-center rounded-md border bg-background px-3',
            focused ? 'border-ring' : 'border-input',
            error && 'border-destructive',
            className,
          )}
        >
          {leftIcon && <View className="mr-2">{leftIcon}</View>}
          <TextInput
            ref={ref}
            className="flex-1 py-2.5 text-base text-foreground"
            placeholderTextColor="hsl(240, 3.8%, 46.1%)"
            onFocus={handleFocus}
            onBlur={handleBlur}
            accessibilityLabel={label}
            {...props}
          />
          {rightIcon && <View className="ml-2">{rightIcon}</View>}
        </View>
        {error && (
          <Text variant="destructive" size="xs" className="mt-1">
            {error}
          </Text>
        )}
        {helperText && !error && (
          <Text variant="muted" size="xs" className="mt-1">
            {helperText}
          </Text>
        )}
      </Animated.View>
    );
  },
);

Input.displayName = 'Input';
