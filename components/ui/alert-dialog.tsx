import React, { createContext, useContext } from 'react';
import { Modal, Pressable, View, type ViewProps } from 'react-native';
import Animated, {
  FadeOut,
  ZoomIn,
} from 'react-native-reanimated';
import { cssInterop } from 'react-native-css-interop';

import { triggerHaptic } from '@/lib/animations';
import { cn } from '@/lib/utils';
import { BlurOverlay } from './primitives/blur-overlay';
import { Button, type ButtonProps } from './button';
import { Text } from './text';

cssInterop(Animated.View, { className: 'style' });

interface AlertDialogContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const AlertDialogContext = createContext<AlertDialogContextValue>({
  open: false,
  onOpenChange: () => {},
});

export interface AlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function AlertDialog({ open, onOpenChange, children }: AlertDialogProps) {
  return (
    <AlertDialogContext.Provider value={{ open, onOpenChange }}>
      {children}
    </AlertDialogContext.Provider>
  );
}

export interface AlertDialogTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
}

export function AlertDialogTrigger({ children }: AlertDialogTriggerProps) {
  const { onOpenChange } = useContext(AlertDialogContext);

  return (
    <Pressable onPress={() => onOpenChange(true)} accessibilityRole="button">
      {children}
    </Pressable>
  );
}

export interface AlertDialogContentProps extends ViewProps {
  className?: string;
  children: React.ReactNode;
}

export function AlertDialogContent({ className, children, ...props }: AlertDialogContentProps) {
  const { open, onOpenChange } = useContext(AlertDialogContext);

  React.useEffect(() => {
    if (open) triggerHaptic('medium');
  }, [open]);

  return (
    <Modal visible={open} transparent animationType="none" statusBarTranslucent>
      <View className="flex-1 items-center justify-center">
        <BlurOverlay visible={open} onPress={() => onOpenChange(false)} />
        {open && (
          <Animated.View
            entering={ZoomIn.springify().damping(15)}
            exiting={FadeOut.duration(150)}
            className={cn(
              'z-50 mx-6 w-full max-w-sm rounded-lg border border-border bg-background p-6 shadow-lg',
              className,
            )}
            {...props}
          >
            {children}
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

export function AlertDialogHeader({ className, children, ...props }: ViewProps & { className?: string }) {
  return (
    <View className={cn('mb-4', className)} {...props}>
      {children}
    </View>
  );
}

export function AlertDialogTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <Text weight="semibold" size="lg" className={className}>
      {children}
    </Text>
  );
}

export function AlertDialogDescription({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <Text variant="muted" size="sm" className={cn('mt-1', className)}>
      {children}
    </Text>
  );
}

export function AlertDialogFooter({ className, children, ...props }: ViewProps & { className?: string }) {
  return (
    <View className={cn('flex-row justify-end gap-2', className)} {...props}>
      {children}
    </View>
  );
}

export function AlertDialogAction({ children, ...props }: ButtonProps) {
  return (
    <Button size="sm" {...props}>
      {children}
    </Button>
  );
}

export function AlertDialogCancel({ children, ...props }: Omit<ButtonProps, 'variant'>) {
  const { onOpenChange } = useContext(AlertDialogContext);

  return (
    <Button
      variant="outline"
      size="sm"
      onPress={() => onOpenChange(false)}
      {...props}
    >
      {children}
    </Button>
  );
}
