import React from 'react';
import { View, type ViewProps } from 'react-native';

import { cn } from '@/lib/utils';

export interface SeparatorProps extends ViewProps {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

export const Separator = React.forwardRef<View, SeparatorProps>(
  ({ orientation = 'horizontal', className, ...props }, ref) => (
    <View
      ref={ref}
      className={cn(
        'bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'w-px h-full',
        className,
      )}
      accessibilityRole="none"
      {...props}
    />
  ),
);

Separator.displayName = 'Separator';
