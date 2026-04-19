import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from 'react';
import { Dimensions, View } from 'react-native';
import Animated, {
  SlideInUp,
  SlideOutUp,
  Layout,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import { cssInterop } from 'react-native-css-interop';
import { cva } from 'class-variance-authority';

import { triggerHaptic } from '@/lib/animations';
import { cn } from '@/lib/utils';
import { AnimatedPressable } from './primitives/animated-pressable';
import { Text } from './text';

cssInterop(Animated.View, { className: 'style' });

const toastVariants = cva(
  'w-full rounded-lg border p-4 shadow-lg flex-row items-start',
  {
    variants: {
      variant: {
        default: 'border-border bg-card',
        destructive: 'border-destructive/50 bg-destructive',
        success: 'border-emerald-500/50 bg-emerald-500',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const toastTextVariants = cva('', {
  variants: {
    variant: {
      default: 'text-card-foreground',
      destructive: 'text-destructive-foreground',
      success: 'text-white',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface ToastData {
  id: string;
  title: string;
  description?: string;
  variant?: 'default' | 'destructive' | 'success';
  duration?: number;
  action?: { label: string; onPress: () => void };
}

type ToastAction =
  | { type: 'ADD'; toast: ToastData }
  | { type: 'DISMISS'; id: string }
  | { type: 'DISMISS_ALL' };

function toastReducer(state: ToastData[], action: ToastAction): ToastData[] {
  switch (action.type) {
    case 'ADD':
      return [action.toast, ...state].slice(0, 5);
    case 'DISMISS':
      return state.filter((t) => t.id !== action.id);
    case 'DISMISS_ALL':
      return [];
  }
}

interface ToastContextValue {
  toast: (data: Omit<ToastData, 'id'>) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => '',
  dismiss: () => {},
  dismissAll: () => {},
});

let idCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, dispatch] = useReducer(toastReducer, []);

  const toast = useCallback((data: Omit<ToastData, 'id'>) => {
    const id = `toast-${++idCounter}`;
    dispatch({ type: 'ADD', toast: { ...data, id } });
    triggerHaptic('light');
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    dispatch({ type: 'DISMISS', id });
  }, []);

  const dismissAll = useCallback(() => {
    dispatch({ type: 'DISMISS_ALL' });
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss, dismissAll }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

interface ToastViewportProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  if (toasts.length === 0) return null;

  return (
    <View
      className="absolute top-14 left-4 right-4 z-50"
      pointerEvents="box-none"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} data={t} onDismiss={onDismiss} />
      ))}
    </View>
  );
}

interface ToastItemProps {
  data: ToastData;
  onDismiss: (id: string) => void;
}

function ToastItem({ data, onDismiss }: ToastItemProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { width } = Dimensions.get('window');
  const threshold = width * 0.3;

  useEffect(() => {
    const duration = data.duration ?? 4000;
    timerRef.current = setTimeout(() => onDismiss(data.id), duration);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [data.id, data.duration, onDismiss]);

  const swipeGesture = Gesture.Pan().runOnJS(true).onEnd((e) => {
    if (Math.abs(e.translationX) > threshold) {
      onDismiss(data.id);
    }
  });

  const textColor = toastTextVariants({ variant: data.variant });

  return (
    <GestureDetector gesture={swipeGesture}>
      <Animated.View
        entering={SlideInUp.springify().damping(15)}
        exiting={SlideOutUp.springify()}
        layout={Layout.springify()}
        className={cn(toastVariants({ variant: data.variant }), 'mb-2')}
      >
        <View className="flex-1">
          <Text weight="semibold" size="sm" className={textColor}>
            {data.title}
          </Text>
          {data.description && (
            <Text size="xs" className={cn(textColor, 'mt-0.5 opacity-90')}>
              {data.description}
            </Text>
          )}
        </View>
        {data.action && (
          <AnimatedPressable
            onPress={data.action.onPress}
            className="ml-3 rounded-md border border-border/50 px-2.5 py-1"
            scaleValue={0.95}
          >
            <Text size="xs" weight="semibold" className={textColor}>
              {data.action.label}
            </Text>
          </AnimatedPressable>
        )}
      </Animated.View>
    </GestureDetector>
  );
}
