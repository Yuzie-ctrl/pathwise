import { useEffect, useMemo, useRef } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { Text } from '@/components/ui/text';

export type TimePickerKind = 'depart' | 'arrive';

interface TimePickerModalProps {
  visible: boolean;
  value: Date;
  kind: TimePickerKind;
  onClose: () => void;
  onChange: (next: Date) => void;
  onChangeKind?: (kind: TimePickerKind) => void;
}

const DAY_OPTIONS: { key: string; label: string; offsetDays: number }[] = [
  { key: 'today', label: 'Сегодня', offsetDays: 0 },
  { key: 'tomorrow', label: 'Завтра', offsetDays: 1 },
  { key: 'day_after', label: 'Послезавтра', offsetDays: 2 },
  { key: 'd3', label: '+3 дня', offsetDays: 3 },
  { key: 'd4', label: '+4 дня', offsetDays: 4 },
  { key: 'd5', label: '+5 дней', offsetDays: 5 },
  { key: 'd6', label: '+6 дней', offsetDays: 6 },
];

const ITEM_HEIGHT = 44;
const VISIBLE_ROWS = 5; // 2 above + selected + 2 below
const LIST_HEIGHT = ITEM_HEIGHT * VISIBLE_ROWS;

function WheelColumn({
  values,
  selected,
  onSelect,
  pad = 2,
}: {
  values: number[];
  selected: number;
  onSelect: (v: number) => void;
  pad?: number;
}) {
  const listRef = useRef<FlatList<number>>(null);
  const lastReportedRef = useRef<number>(selected);
  const userScrollingRef = useRef(false);

  // Keep the wheel in sync when the outside `selected` prop changes
  // (e.g. user tapped +5 min button). Skip if the user is mid-scroll
  // so we don't fight the gesture.
  useEffect(() => {
    if (userScrollingRef.current) return;
    const idx = values.indexOf(selected);
    if (idx < 0) return;
    if (lastReportedRef.current === selected) return;
    lastReportedRef.current = selected;
    // Defer to the next frame so FlatList is mounted.
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToOffset({
          offset: idx * ITEM_HEIGHT,
          animated: true,
        });
      } catch {
        // ignore
      }
    });
  }, [selected, values]);

  const initialIndex = Math.max(0, values.indexOf(selected));

  const onScrollBegin = () => {
    userScrollingRef.current = true;
  };

  const handleScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    userScrollingRef.current = false;
    const offset = e.nativeEvent.contentOffset.y;
    const idx = Math.round(offset / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(values.length - 1, idx));
    const v = values[clamped];
    if (v !== lastReportedRef.current) {
      lastReportedRef.current = v;
      onSelect(v);
    }
  };

  return (
    <View
      style={{ height: LIST_HEIGHT, width: 80, overflow: 'hidden' }}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: ITEM_HEIGHT * 2,
          left: 0,
          right: 0,
          height: ITEM_HEIGHT,
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: 'rgba(37,99,235,0.3)',
          backgroundColor: 'rgba(37,99,235,0.08)',
          zIndex: 1,
        }}
      />
      <FlatList
        ref={listRef}
        data={values}
        keyExtractor={(v) => String(v)}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        snapToAlignment="start"
        decelerationRate="fast"
        getItemLayout={(_, index) => ({
          length: ITEM_HEIGHT,
          offset: ITEM_HEIGHT * index,
          index,
        })}
        initialScrollIndex={initialIndex}
        onScrollBeginDrag={onScrollBegin}
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={handleScrollEnd}
        contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
        renderItem={({ item }) => {
          const active = item === selected;
          return (
            <View
              style={{
                height: ITEM_HEIGHT,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                className={`${
                  active
                    ? 'text-2xl font-bold text-foreground'
                    : 'text-xl font-medium text-muted-foreground/50'
                }`}
              >
                {item.toString().padStart(pad, '0')}
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
}

export function TimePickerModal({
  visible,
  value,
  kind,
  onClose,
  onChange,
  onChangeKind,
}: TimePickerModalProps) {
  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, i) => i), []);

  const setHour = (h: number) => {
    const n = new Date(value);
    n.setHours(h);
    onChange(n);
  };
  const setMinute = (m: number) => {
    const n = new Date(value);
    n.setMinutes(m);
    onChange(n);
  };
  const bumpMinutes = (delta: number) => {
    const n = new Date(value);
    n.setMinutes(n.getMinutes() + delta);
    onChange(n);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        className="flex-1 items-center justify-end bg-black/40"
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="w-full rounded-t-3xl bg-card pb-6 pt-4"
        >
          <View className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-muted-foreground/30" />

          {onChangeKind ? (
            <View className="mx-4 flex-row rounded-xl bg-muted p-1">
              <Pressable
                onPress={() => onChangeKind('depart')}
                className={`flex-1 items-center rounded-lg py-2 ${
                  kind === 'depart' ? 'bg-card' : ''
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    kind === 'depart'
                      ? 'text-foreground'
                      : 'text-muted-foreground'
                  }`}
                >
                  Отправление
                </Text>
              </Pressable>
              <Pressable
                onPress={() => onChangeKind('arrive')}
                className={`flex-1 items-center rounded-lg py-2 ${
                  kind === 'arrive' ? 'bg-card' : ''
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    kind === 'arrive'
                      ? 'text-foreground'
                      : 'text-muted-foreground'
                  }`}
                >
                  Прибытие
                </Text>
              </Pressable>
            </View>
          ) : null}

          <Text className="mx-4 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            День
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}
          >
            {DAY_OPTIONS.map((d) => {
              const now = new Date();
              const target = new Date(now);
              target.setDate(now.getDate() + d.offsetDays);
              const active =
                value.getDate() === target.getDate() &&
                value.getMonth() === target.getMonth() &&
                value.getFullYear() === target.getFullYear();
              return (
                <Pressable
                  key={d.key}
                  onPress={() => {
                    const next = new Date(target);
                    next.setHours(value.getHours(), value.getMinutes());
                    onChange(next);
                  }}
                  className={`rounded-xl border px-4 py-2 ${
                    active ? 'border-primary bg-primary' : 'border-border bg-muted'
                  }`}
                >
                  <Text
                    className={`text-sm font-medium ${
                      active ? 'text-primary-foreground' : 'text-foreground'
                    }`}
                  >
                    {d.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text className="mx-4 mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Время
          </Text>

          {/* Wheel pickers */}
          <View className="mt-2 flex-row items-center justify-center gap-3">
            <WheelColumn
              key="hours"
              values={hours}
              selected={value.getHours()}
              onSelect={setHour}
            />
            <Text className="text-3xl font-bold text-foreground">:</Text>
            <WheelColumn
              key="minutes"
              values={minutes}
              selected={value.getMinutes()}
              onSelect={setMinute}
            />
          </View>

          {/* +/- 5 minute buttons */}
          <View className="mx-4 mt-4 flex-row items-center justify-center gap-3">
            <Pressable
              onPress={() => bumpMinutes(-5)}
              hitSlop={8}
              className="h-11 flex-1 items-center justify-center rounded-full bg-muted active:bg-muted/70"
            >
              <Text className="text-sm font-bold text-foreground">−5 мин</Text>
            </Pressable>
            <Pressable
              onPress={() => bumpMinutes(5)}
              hitSlop={8}
              className="h-11 flex-1 items-center justify-center rounded-full bg-muted active:bg-muted/70"
            >
              <Text className="text-sm font-bold text-foreground">+5 мин</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={onClose}
            className="mx-4 mt-5 items-center rounded-2xl bg-primary py-3"
          >
            <Text className="text-base font-semibold text-primary-foreground">
              Готово
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function formatTimePickerLabel(d: Date): string {
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) return `Сегодня, ${hh}:${mm}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow =
    d.getDate() === tomorrow.getDate() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getFullYear() === tomorrow.getFullYear();
  if (isTomorrow) return `Завтра, ${hh}:${mm}`;
  const day = d.getDate().toString().padStart(2, '0');
  const mon = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${day}.${mon}, ${hh}:${mm}`;
}
