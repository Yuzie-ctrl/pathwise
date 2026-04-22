import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeftRight,
  ArrowUpDown,
  Bike,
  Brush,
  Bus,
  Calendar,
  Car,
  ChevronDown,
  ChevronUp,
  Clock,
  Filter,
  Footprints,
  Plus,
  Users,
  X,
} from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import {
  allTransitLines,
  buildTransitOptions,
  formatDistance,
  formatDuration,
  type TransitOption,
  type TransitSegment,
} from '@/lib/routing';
import {
  totalDistanceMeters,
  totalTravelSeconds,
  useTripStore,
  type TransportMode,
} from '@/lib/stores/tripStore';

const MODE_CONFIG: Record<TransportMode, { icon: typeof Car; label: string }> = {
  driving: { icon: Car, label: 'Авто' },
  walking: { icon: Footprints, label: 'Пешком' },
  cycling: { icon: Bike, label: 'Вело' },
  transit: { icon: Bus, label: 'Автобус' },
};

const STOP_COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899'];

interface TransitPlannerProps {
  onClose: () => void;
  onAddStop: () => void;
  onChangeOrigin: () => void;
  onDrawForStop?: (stopId: string) => void;
  /** Called when user picks a specific option to visualize on the map. */
  onSelectOption?: (option: TransitOption) => void;
}

type TimePickerKind = 'depart' | 'arrive';

const DAY_OPTIONS: { key: string; label: string; offsetDays: number }[] = [
  { key: 'today', label: 'Сегодня', offsetDays: 0 },
  { key: 'tomorrow', label: 'Завтра', offsetDays: 1 },
  { key: 'day_after', label: 'Послезавтра', offsetDays: 2 },
  { key: 'd3', label: '+3 дня', offsetDays: 3 },
  { key: 'd4', label: '+4 дня', offsetDays: 4 },
  { key: 'd5', label: '+5 дней', offsetDays: 5 },
  { key: 'd6', label: '+6 дней', offsetDays: 6 },
];

function formatTime(d: Date) {
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDateLabel(d: Date) {
  const now = new Date();
  const isSameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isSameDay) return 'Сегодня';
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (
    d.getDate() === tomorrow.getDate() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getFullYear() === tomorrow.getFullYear()
  )
    return 'Завтра';
  const dd = d.getDate().toString().padStart(2, '0');
  const mo = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${dd}.${mo}`;
}

export function TransitPlanner({
  onClose,
  onAddStop,
  onChangeOrigin,
  onDrawForStop,
  onSelectOption,
}: TransitPlannerProps) {
  const stops = useTripStore((s) => s.stops);
  const mode = useTripStore((s) => s.mode);
  const legs = useTripStore((s) => s.legs);
  const loadingRoute = useTripStore((s) => s.loadingRoute);
  const removeStop = useTripStore((s) => s.removeStop);
  const setMode = useTripStore((s) => s.setMode);
  const drawnRoutes = useTripStore((s) => s.drawnRoutes);

  const [stopsCollapsed, setStopsCollapsed] = useState(false);
  const [timePickerKind, setTimePickerKind] = useState<TimePickerKind>('depart');
  const [timeModal, setTimeModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [detailOption, setDetailOption] = useState<TransitOption | null>(null);
  const [detailExpanded, setDetailExpanded] = useState(false);

  const travelSeconds = totalTravelSeconds(legs);
  const distanceMeters = totalDistanceMeters(legs);

  const originLabel = stops[0]?.displayName || stops[0]?.label || 'Начало';
  const destLabel =
    stops[stops.length - 1]?.displayName || stops[stops.length - 1]?.label || 'Конец';

  const allOptions = useMemo(
    () =>
      travelSeconds > 0
        ? buildTransitOptions(travelSeconds, distanceMeters, originLabel, destLabel)
        : [],
    [travelSeconds, distanceMeters, originLabel, destLabel],
  );

  const availableLines = useMemo(() => allTransitLines(allOptions), [allOptions]);

  const filteredOptions = useMemo(() => {
    if (selectedLines.length === 0) return allOptions;
    return allOptions.filter((o) =>
      o.busLines.some((ln) => selectedLines.includes(ln)),
    );
  }, [allOptions, selectedLines]);

  const toggleLine = (line: string) => {
    setSelectedLines((prev) =>
      prev.includes(line) ? prev.filter((l) => l !== line) : [...prev, line],
    );
  };

  const visibleStops = stopsCollapsed ? stops.slice(0, 1) : stops;

  return (
    <View className="absolute inset-0 z-40 bg-background">
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* Header with close + mode selector */}
        <View className="flex-row items-center gap-2 px-4 pt-1">
          <Pressable
            onPress={onClose}
            hitSlop={8}
            className="h-9 w-9 items-center justify-center rounded-full bg-muted active:bg-muted/70"
          >
            <X size={18} color="#333" />
          </Pressable>
          <View className="flex-1 flex-row gap-1.5">
            {(Object.keys(MODE_CONFIG) as TransportMode[]).map((m) => {
              const cfg = MODE_CONFIG[m];
              const Icon = cfg.icon;
              const active = mode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  className={`flex-1 items-center justify-center gap-0.5 rounded-xl border py-2 ${
                    active ? 'border-primary bg-primary' : 'border-border bg-muted'
                  }`}
                >
                  <Icon size={16} color={active ? '#fff' : '#444'} />
                  <Text
                    className={`text-[10px] font-medium ${
                      active ? 'text-primary-foreground' : 'text-foreground'
                    }`}
                  >
                    {cfg.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Time picker + filter row */}
        <View className="flex-row items-center gap-2 px-4 pt-2">
          <Pressable
            onPress={() => {
              setTimePickerKind('depart');
              setTimeModal(true);
            }}
            className="flex-1 flex-row items-center gap-2 rounded-xl border border-border bg-card px-3 py-2"
          >
            <Clock size={14} color="#2563eb" />
            <View className="flex-1">
              <Text className="text-[10px] font-medium text-muted-foreground">
                {timePickerKind === 'depart' ? 'Отправление' : 'Прибытие'}
              </Text>
              <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>
                {formatDateLabel(selectedDate)}, {formatTime(selectedDate)}
              </Text>
            </View>
          </Pressable>

          <Pressable
            onPress={() => setFilterOpen((v) => !v)}
            hitSlop={6}
            className={`h-10 w-10 items-center justify-center rounded-xl border ${
              selectedLines.length > 0
                ? 'border-primary bg-primary/10'
                : 'border-border bg-card'
            }`}
          >
            <Filter
              size={16}
              color={selectedLines.length > 0 ? '#2563eb' : '#666'}
            />
            {selectedLines.length > 0 ? (
              <View className="absolute -right-1 -top-1 h-4 w-4 items-center justify-center rounded-full bg-primary">
                <Text className="text-[9px] font-bold text-primary-foreground">
                  {selectedLines.length}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        {/* Filter chips panel */}
        {filterOpen ? (
          <View className="mx-4 mt-2 rounded-xl border border-border bg-card p-3">
            <Text className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Обязательно включить
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {availableLines.length === 0 ? (
                <Text className="text-xs text-muted-foreground">
                  Нет доступных маршрутов
                </Text>
              ) : (
                availableLines.map((ln) => {
                  const active = selectedLines.includes(ln);
                  return (
                    <Pressable
                      key={ln}
                      onPress={() => toggleLine(ln)}
                      className={`rounded-full border px-3 py-1 ${
                        active
                          ? 'border-primary bg-primary'
                          : 'border-border bg-muted'
                      }`}
                    >
                      <Text
                        className={`text-xs font-semibold ${
                          active ? 'text-primary-foreground' : 'text-foreground'
                        }`}
                      >
                        {ln}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </View>
          </View>
        ) : null}

        {/* Stops list — sticky at top, collapsible */}
        <View className="mt-2 border-y border-border bg-card">
          <ScrollView
            style={{ maxHeight: stopsCollapsed ? 80 : 260 }}
            contentContainerStyle={{ paddingVertical: 6 }}
            showsVerticalScrollIndicator={false}
          >
            {visibleStops.map((stop, idx) => {
              const color = STOP_COLORS[idx % STOP_COLORS.length];
              const isOrigin = idx === 0;
              const stopText = stop.displayName || stop.label;
              const hasDrawnToThis = drawnRoutes.some((r) => r.toStopId === stop.id);
              return (
                <View key={stop.id} className="px-4">
                  <View className="flex-row items-center gap-3 py-1.5">
                    <View
                      className="h-6 w-6 items-center justify-center rounded-full"
                      style={{ backgroundColor: color }}
                    >
                      <Text className="text-[10px] font-bold text-white">
                        {idx + 1}
                      </Text>
                    </View>
                    {isOrigin ? (
                      <Pressable onPress={onChangeOrigin} className="flex-1">
                        <Text className="text-sm text-foreground" numberOfLines={1}>
                          <Text className="text-sm text-muted-foreground">
                            Точка 1.{' '}
                          </Text>
                          {stop.originKind === 'myLocation'
                            ? 'Моё местоположение'
                            : stopText}
                        </Text>
                      </Pressable>
                    ) : (
                      <View className="flex-1">
                        <Text className="text-sm text-foreground" numberOfLines={1}>
                          <Text className="text-sm text-muted-foreground">
                            Точка {idx + 1}.{' '}
                          </Text>
                          {stopText}
                        </Text>
                      </View>
                    )}
                    {!isOrigin && onDrawForStop ? (
                      <Pressable
                        onPress={() => onDrawForStop(stop.id)}
                        hitSlop={6}
                        className={`h-7 w-7 items-center justify-center rounded-full ${
                          hasDrawnToThis ? 'bg-primary/10' : 'bg-muted'
                        }`}
                      >
                        <Brush
                          size={12}
                          color={hasDrawnToThis ? '#2563eb' : '#666'}
                        />
                      </Pressable>
                    ) : null}
                    {!isOrigin ? (
                      <Pressable
                        onPress={() => removeStop(stop.id)}
                        hitSlop={6}
                        className="p-1"
                      >
                        <X size={14} color="#888" />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })}
            {!stopsCollapsed ? (
              <Pressable
                onPress={onAddStop}
                className="mx-4 mt-1 flex-row items-center gap-2 rounded-xl border border-dashed border-border bg-muted/50 px-3 py-2 active:bg-muted"
              >
                <View className="h-6 w-6 items-center justify-center rounded-full bg-primary">
                  <Plus size={12} color="#fff" />
                </View>
                <Text className="text-xs font-medium text-foreground">
                  Добавить остановку
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>

          {stops.length >= 3 ? (
            <Pressable
              onPress={() => setStopsCollapsed((v) => !v)}
              className="items-center border-t border-border py-1.5 active:bg-muted/50"
            >
              {stopsCollapsed ? (
                <ChevronDown size={16} color="#666" />
              ) : (
                <ChevronUp size={16} color="#666" />
              )}
            </Pressable>
          ) : null}
        </View>

        {/* Transit options list */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingVertical: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {loadingRoute && filteredOptions.length === 0 ? (
            <View className="mx-4 rounded-2xl bg-muted p-4">
              <Text className="text-sm text-muted-foreground">Ищем варианты…</Text>
            </View>
          ) : null}
          {!loadingRoute && filteredOptions.length === 0 && allOptions.length > 0 ? (
            <View className="mx-4 rounded-2xl bg-muted p-4">
              <Text className="text-sm text-muted-foreground">
                Нет вариантов с выбранными маршрутами. Снимите фильтры.
              </Text>
            </View>
          ) : null}
          {filteredOptions.map((opt) => (
            <Pressable
              key={opt.id}
              onPress={() => {
                setDetailOption(opt);
                setDetailExpanded(false);
                onSelectOption?.(opt);
              }}
              className="mx-4 mb-3 rounded-2xl border border-border bg-card p-3 active:bg-muted/50"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1 flex-row flex-wrap items-center gap-1.5">
                  {opt.segments.map((seg, i) => (
                    <SegmentChip key={i} segment={seg} index={i} total={opt.segments.length} />
                  ))}
                </View>
                <View className="ml-2 items-end">
                  <Text className="text-base font-bold text-foreground">
                    {formatDuration(opt.durationSeconds)}
                  </Text>
                  <Text className="text-[10px] text-muted-foreground">
                    через {opt.departureInMinutes} мин
                  </Text>
                </View>
              </View>
              <Text
                className="mt-1.5 text-[11px] text-muted-foreground"
                numberOfLines={1}
              >
                {opt.description} · пешком {opt.walkMinutes} мин
                {opt.transfers > 0 ? ` · ${opt.transfers} перес.` : ''}
              </Text>
            </Pressable>
          ))}
          <Text className="mx-4 mt-2 text-[10px] text-muted-foreground">
            Онлайн-отслеживание автобусов недоступно в этом регионе — данные приблизительные.
          </Text>
        </ScrollView>
      </SafeAreaView>

      {/* Time picker modal */}
      <Modal
        visible={timeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setTimeModal(false)}
      >
        <Pressable
          onPress={() => setTimeModal(false)}
          className="flex-1 items-center justify-end bg-black/40"
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="w-full rounded-t-3xl bg-card pb-6 pt-4"
          >
            <View className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-muted-foreground/30" />
            <View className="mx-4 flex-row rounded-xl bg-muted p-1">
              <Pressable
                onPress={() => setTimePickerKind('depart')}
                className={`flex-1 items-center rounded-lg py-2 ${
                  timePickerKind === 'depart' ? 'bg-card' : ''
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    timePickerKind === 'depart' ? 'text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  Отправление
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setTimePickerKind('arrive')}
                className={`flex-1 items-center rounded-lg py-2 ${
                  timePickerKind === 'arrive' ? 'bg-card' : ''
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    timePickerKind === 'arrive' ? 'text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  Прибытие
                </Text>
              </Pressable>
            </View>

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
                  selectedDate.getDate() === target.getDate() &&
                  selectedDate.getMonth() === target.getMonth();
                return (
                  <Pressable
                    key={d.key}
                    onPress={() => {
                      const next = new Date(target);
                      next.setHours(
                        selectedDate.getHours(),
                        selectedDate.getMinutes(),
                      );
                      setSelectedDate(next);
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
            <View className="mx-4 mt-2 flex-row items-center gap-3">
              <Pressable
                onPress={() => {
                  const next = new Date(selectedDate);
                  next.setMinutes(next.getMinutes() - 15);
                  setSelectedDate(next);
                }}
                className="h-10 w-10 items-center justify-center rounded-full bg-muted"
              >
                <Text className="text-lg font-bold text-foreground">−</Text>
              </Pressable>
              <View className="flex-1 items-center rounded-xl bg-muted py-3">
                <Text className="text-2xl font-bold text-foreground">
                  {formatTime(selectedDate)}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  const next = new Date(selectedDate);
                  next.setMinutes(next.getMinutes() + 15);
                  setSelectedDate(next);
                }}
                className="h-10 w-10 items-center justify-center rounded-full bg-muted"
              >
                <Text className="text-lg font-bold text-foreground">+</Text>
              </Pressable>
            </View>

            <Pressable
              onPress={() => setTimeModal(false)}
              className="mx-4 mt-5 items-center rounded-2xl bg-primary py-3"
            >
              <Text className="text-base font-semibold text-primary-foreground">
                Готово
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Detail sheet — 2/3 map + 1/3 detail, expandable to almost full-screen */}
      {detailOption ? (
        <Pressable
          onPress={() => setDetailOption(null)}
          className="absolute inset-0 z-50 bg-black/30"
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              top: detailExpanded ? 60 : '66%',
            }}
            className="overflow-hidden rounded-t-3xl bg-card"
          >
            <Pressable
              onPress={() => setDetailExpanded((v) => !v)}
              className="items-center py-2"
              hitSlop={10}
            >
              <View className="h-1.5 w-12 rounded-full bg-muted-foreground/40" />
            </Pressable>
            <View className="border-b border-border px-4 pb-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-xl font-bold text-foreground">
                  {formatDuration(detailOption.durationSeconds)}
                </Text>
                <Pressable
                  onPress={() => setDetailOption(null)}
                  hitSlop={8}
                  className="h-8 w-8 items-center justify-center rounded-full bg-muted"
                >
                  <X size={14} color="#666" />
                </Pressable>
              </View>
              <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                {detailOption.description} · {formatDistance(distanceMeters)} ·{' '}
                отправление через {detailOption.departureInMinutes} мин
              </Text>
            </View>
            <ScrollView
              contentContainerStyle={{ padding: 16 }}
              showsVerticalScrollIndicator={false}
            >
              <TimelineView option={detailOption} origin={originLabel} destination={destLabel} />
            </ScrollView>
          </Pressable>
        </Pressable>
      ) : null}
    </View>
  );
}

function SegmentChip({
  segment,
  index,
  total,
}: {
  segment: TransitSegment;
  index: number;
  total: number;
}) {
  const isLast = index === total - 1;
  if (segment.kind === 'walk') {
    return (
      <View className="flex-row items-center gap-1">
        <View className="flex-row items-center gap-0.5 rounded-md bg-emerald-100 px-1.5 py-0.5 dark:bg-emerald-500/20">
          <Footprints size={11} color="#059669" />
          <Text className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
            {Math.max(1, Math.round(segment.durationSeconds / 60))}
          </Text>
        </View>
        {!isLast ? <Text className="text-muted-foreground">›</Text> : null}
      </View>
    );
  }
  return (
    <View className="flex-row items-center gap-1">
      <View className="rounded-md bg-primary px-1.5 py-0.5">
        <Text className="text-[10px] font-bold text-primary-foreground">
          {segment.line ?? 'BUS'}
        </Text>
      </View>
      {!isLast ? <Text className="text-muted-foreground">›</Text> : null}
    </View>
  );
}

function TimelineView({
  option,
  origin,
  destination,
}: {
  option: TransitOption;
  origin: string;
  destination: string;
}) {
  // Detect consecutive bus segments at same transfer point (Пересадка) — show as paired boxes.
  const rows: React.ReactNode[] = [];
  for (let i = 0; i < option.segments.length; i++) {
    const seg = option.segments[i];
    const next = option.segments[i + 1];
    const isBusTransfer =
      seg.kind === 'bus' && next && next.kind === 'bus' && seg.to === next.from;

    const locLabel =
      i === 0 ? origin : seg.from;
    rows.push(
      <View key={`loc-${i}`} className="flex-row items-center gap-3">
        <View className="h-3 w-3 rounded-full border-2 border-primary bg-card" />
        <Text className="flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>
          {locLabel}
        </Text>
        <Text className="text-[11px] text-muted-foreground">
          {seg.kind === 'walk' ? '' : formatTime(new Date(Date.now() + i * 60 * 5 * 1000))}
        </Text>
      </View>,
    );

    if (isBusTransfer) {
      // Render the transfer "pair boxes with arrow" block
      rows.push(
        <View
          key={`seg-transfer-${i}`}
          className="ml-1 flex-row items-center gap-2 border-l-2 border-dashed border-muted-foreground/40 pl-5 py-2"
        >
          <View className="flex-row items-center gap-2">
            <View className="rounded-md bg-primary px-2 py-1">
              <Text className="text-xs font-bold text-primary-foreground">
                {seg.line}
              </Text>
            </View>
            <ArrowLeftRight size={14} color="#8b5cf6" />
            <View className="rounded-md bg-primary px-2 py-1">
              <Text className="text-xs font-bold text-primary-foreground">
                {next.line}
              </Text>
            </View>
          </View>
          <View className="flex-1">
            <Text className="text-xs font-medium text-foreground">
              Пересадка на той же остановке
            </Text>
            <Text className="text-[10px] text-muted-foreground">
              {seg.line} → {next.line}
            </Text>
          </View>
        </View>,
      );
      // Combined segment for the first bus
      rows.push(
        <View
          key={`seg-${i}-info`}
          className="ml-1 border-l-2 border-primary pl-5 py-2"
        >
          <Text className="text-xs text-muted-foreground">
            {seg.line} · {seg.stopsCount ?? '—'} ост. · {formatDuration(seg.durationSeconds)}
          </Text>
        </View>,
      );
      // Next iteration's bus segment will be rendered normally — skip it.
      i++;
      // But we still need to add the arrival at next.to (the 2nd bus's end).
      rows.push(
        <View
          key={`seg-${i}-info2`}
          className="ml-1 border-l-2 border-primary pl-5 py-2"
        >
          <Text className="text-xs text-muted-foreground">
            {next.line} · {next.stopsCount ?? '—'} ост. · {formatDuration(next.durationSeconds)}
          </Text>
        </View>,
      );
      continue;
    }

    // Normal segment
    if (seg.kind === 'walk') {
      rows.push(
        <View
          key={`seg-${i}`}
          className="ml-1 flex-row items-center gap-2 border-l-2 border-dashed border-emerald-500/40 pl-5 py-2"
        >
          <Footprints size={14} color="#059669" />
          <Text className="text-xs text-foreground">
            Пешком · {formatDuration(seg.durationSeconds)}
            {seg.distanceMeters > 0
              ? ` · ${formatDistance(seg.distanceMeters)}`
              : ''}
          </Text>
        </View>,
      );
    } else {
      rows.push(
        <View
          key={`seg-${i}`}
          className="ml-1 flex-row items-center gap-2 border-l-2 border-primary pl-5 py-2"
        >
          <Bus size={14} color="#8b5cf6" />
          <View className="rounded-md bg-primary px-1.5 py-0.5">
            <Text className="text-xs font-bold text-primary-foreground">
              {seg.line}
            </Text>
          </View>
          <Text className="text-xs text-foreground">
            {seg.stopsCount ?? '—'} ост. · {formatDuration(seg.durationSeconds)}
          </Text>
        </View>,
      );
    }
  }

  // Final destination marker
  rows.push(
    <View key="final" className="flex-row items-center gap-3">
      <View className="h-3 w-3 rounded-full bg-primary" />
      <Text className="flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>
        {destination}
      </Text>
    </View>,
  );

  // Unused import fix-up: silence when not used
  void Calendar;
  void ArrowUpDown;
  void Users;

  return <View className="gap-1">{rows}</View>;
}
