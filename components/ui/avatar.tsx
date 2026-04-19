import React, { createContext, useContext, useState } from 'react';
import { Image, View, type ViewProps } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { Text } from './text';

const avatarVariants = cva(
  'relative overflow-hidden rounded-full bg-muted items-center justify-center',
  {
    variants: {
      size: {
        sm: 'h-8 w-8',
        default: 'h-10 w-10',
        lg: 'h-14 w-14',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
);

const AvatarContext = createContext({ loaded: false, setLoaded: (_: boolean) => {} });

export interface AvatarProps extends ViewProps, VariantProps<typeof avatarVariants> {
  className?: string;
}

export function Avatar({ size, className, children, ...props }: AvatarProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <AvatarContext.Provider value={{ loaded, setLoaded }}>
      <View className={cn(avatarVariants({ size }), className)} {...props}>
        {children}
      </View>
    </AvatarContext.Provider>
  );
}

export interface AvatarImageProps {
  src: string;
  alt?: string;
}

export function AvatarImage({ src, alt }: AvatarImageProps) {
  const { setLoaded } = useContext(AvatarContext);

  return (
    <Animated.View entering={FadeIn.duration(300)} className="absolute inset-0">
      <Image
        source={{ uri: src }}
        style={{ width: '100%', height: '100%' }}
        accessibilityLabel={alt}
        onLoad={() => setLoaded(true)}
      />
    </Animated.View>
  );
}

export interface AvatarFallbackProps {
  className?: string;
  children: React.ReactNode;
}

export function AvatarFallback({ className, children }: AvatarFallbackProps) {
  const { loaded } = useContext(AvatarContext);

  if (loaded) return null;

  return (
    <View className={cn('flex-1 items-center justify-center', className)}>
      <Text size="sm" weight="medium" variant="muted">
        {children}
      </Text>
    </View>
  );
}
