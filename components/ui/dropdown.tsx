import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import {
  Modal,
  Pressable,
  View,
  type LayoutRectangle,
  type ViewProps,
} from 'react-native';
import Animated, {
  SlideInDown,
  SlideOutUp,
} from 'react-native-reanimated';
import { Check, ChevronDown } from 'lucide-react-native';
import { cssInterop } from 'react-native-css-interop';

import { triggerHaptic } from '@/lib/animations';
import { cn } from '@/lib/utils';
import { AnimatedPressable } from './primitives/animated-pressable';
import { Text } from './text';

cssInterop(Animated.View, { className: 'style' });

interface DropdownContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value?: string;
  onValueChange?: (value: string) => void;
  triggerLayout: LayoutRectangle | null;
  setTriggerLayout: (layout: LayoutRectangle) => void;
}

const DropdownContext = createContext<DropdownContextValue>({
  open: false,
  onOpenChange: () => {},
  triggerLayout: null,
  setTriggerLayout: () => {},
});

export interface DropdownProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
}

export function Dropdown({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  value,
  onValueChange,
  children,
}: DropdownProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [triggerLayout, setTriggerLayout] = useState<LayoutRectangle | null>(null);

  const open = controlledOpen ?? internalOpen;
  const onOpenChange = controlledOnOpenChange ?? setInternalOpen;

  return (
    <DropdownContext.Provider
      value={{ open, onOpenChange, value, onValueChange, triggerLayout, setTriggerLayout }}
    >
      {children}
    </DropdownContext.Provider>
  );
}

export interface DropdownTriggerProps {
  className?: string;
  placeholder?: string;
  children?: React.ReactNode;
}

export function DropdownTrigger({ className, placeholder = 'Select...', children }: DropdownTriggerProps) {
  const { open, onOpenChange, value, setTriggerLayout } = useContext(DropdownContext);
  const triggerRef = useRef<View>(null);

  const handlePress = useCallback(() => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setTriggerLayout({ x, y, width, height });
      onOpenChange(!open);
    });
  }, [open, onOpenChange, setTriggerLayout]);

  return (
    <AnimatedPressable
      onPress={handlePress}
      className={cn(
        'flex-row items-center justify-between rounded-md border border-input bg-background px-3 py-2.5',
        className,
      )}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      scaleValue={0.99}
    >
      <View ref={triggerRef} collapsable={false} className="flex-row items-center flex-1">
        {children ?? (
          <Text variant={value ? 'default' : 'muted'} size="sm">
            {value || placeholder}
          </Text>
        )}
      </View>
      <ChevronDown size={16} color="hsl(240, 3.8%, 46.1%)" />
    </AnimatedPressable>
  );
}

export interface DropdownContentProps extends ViewProps {
  className?: string;
  children: React.ReactNode;
}

export function DropdownContent({ className, children, ...props }: DropdownContentProps) {
  const { open, onOpenChange, triggerLayout } = useContext(DropdownContext);

  if (!open) return null;

  return (
    <Modal visible={open} transparent animationType="none">
      <Pressable
        style={{ flex: 1 }}
        onPress={() => onOpenChange(false)}
      >
        <Animated.View
          entering={SlideInDown.springify().damping(18).stiffness(200)}
          exiting={SlideOutUp.duration(100)}
          className={cn(
            'absolute z-50 min-w-[8rem] rounded-md border border-border bg-popover p-1 shadow-md',
            className,
          )}
          style={
            triggerLayout
              ? {
                  top: triggerLayout.y + triggerLayout.height + 4,
                  left: triggerLayout.x,
                  width: triggerLayout.width,
                }
              : { top: '50%', left: '10%', right: '10%' }
          }
          {...props}
        >
          <Pressable>{children}</Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

export interface DropdownItemProps {
  value: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

export function DropdownItem({ value: itemValue, label, icon, disabled, className }: DropdownItemProps) {
  const { value, onValueChange, onOpenChange } = useContext(DropdownContext);
  const isSelected = value === itemValue;

  return (
    <AnimatedPressable
      disabled={disabled}
      hapticFeedback="light"
      scaleValue={0.98}
      onPress={() => {
        onValueChange?.(itemValue);
        onOpenChange(false);
        triggerHaptic('light');
      }}
      className={cn(
        'flex-row items-center rounded-sm px-2 py-2',
        isSelected && 'bg-accent',
        disabled && 'opacity-50',
        className,
      )}
      accessibilityRole="menuitem"
      accessibilityState={{ selected: isSelected, disabled }}
    >
      {icon && <View className="mr-2">{icon}</View>}
      <Text size="sm" className="flex-1">
        {label}
      </Text>
      {isSelected && <Check size={16} color="hsl(240, 5.9%, 10%)" />}
    </AnimatedPressable>
  );
}

export function DropdownSeparator({ className }: { className?: string }) {
  return <View className={cn('my-1 h-px bg-border', className)} />;
}

export function DropdownLabel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <Text size="xs" weight="semibold" variant="muted" className={cn('px-2 py-1.5', className)}>
      {children}
    </Text>
  );
}
