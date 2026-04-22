import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Bike,
  Brush,
  Bus,
  Car,
  ChevronDown,
  ChevronUp,
  Clock,
  Filter,
  Footprints,
  Pause,
  Plus,
  X,
} from 'lucide-react-native';

import { DwellPicker } from '@/components/DwellPicker';
import { Text } from '@/components/ui/text';
import {
  TimePickerModal,
  formatTimePickerLabel,
  type TimePickerKind,
} from '@/components/TimePickerModal';
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

function formatHHMM(d: Date) {
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
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
  const setDwell = useTripStore((s) => s.setDwell);
  const moveStop = useTripStore((s) => s.moveStop);

  const [stopsCollapsed, setStopsCollapsed] = useState(false);
  const [timePickerKind, setTimePickerKind] = useState<TimePickerKind>('depart');
  const [timeModal, setTimeModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [detailOption, setDetailOption] = useState<TransitOption | null>(null);
  /** Detail sheet vertical position: compact (bottom half), expanded (near top), or collapsed (peek). */
  const [detailPos, setDetailPos] = useState<'compact' | 'expanded' | 'collapsed'>(
    'compact',
  );
  const [dwellPickerStopId, setDwellPickerStopId] = useState<string | null>(null);
  const dwellStop = stops.find((s) => s.id === dwellPickerStopId);

  const travelSeconds = totalTravelSeconds(legs);
  const distanceMeters = totalDistanceMeters(legs);

  const originLabel =
    stops[0]?.originKind === 'myLocation'
      ? 'Моё местоположение'
      : stops[0]?.label || 'Начало';
  const destLabel = stops[stops.length - 1]?.label || 'Конец';

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
                {formatTimePickerLabel(selectedDate)}
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
              const isLast = idx === stops.length - 1;
              const stopText = stop.label;
              const hasDrawnToThis = drawnRoutes.some((r) => r.toStopId === stop.id);
              return (
                <View key={stop.id} className="px-4">
                  <View className="flex-row items-center gap-2 py-1.5">
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
                        {!isLast && stop.dwellMinutes > 0 ? (
                          <View className="mt-0.5 flex-row items-center gap-1 self-start rounded-full bg-amber-100 px-2 py-0.5 dark:bg-amber-500/20">
                            <Pause size={9} color="#b45309" />
                            <Text className="text-[10px] font-medium text-amber-800 dark:text-amber-300">
                              пауза {stop.dwellMinutes} мин
                            </Text>
                          </View>
                        ) : null}
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
                    {/* Dwell */}
                    {!isOrigin && !isLast ? (
                      <Pressable
                        onPress={() => setDwellPickerStopId(stop.id)}
                        hitSlop={6}
                        className={`h-7 px-2 flex-row items-center justify-center rounded-full ${
                          stop.dwellMinutes > 0 ? 'bg-primary/10' : 'bg-muted'
                        }`}
                      >
                        <Clock
                          size={11}
                          color={stop.dwellMinutes > 0 ? '#2563eb' : '#666'}
                        />
                        <Text
                          className={`ml-1 text-[10px] font-medium ${
                            stop.dwellMinutes > 0 ? 'text-primary' : 'text-foreground'
                          }`}
                        >
                          {stop.dwellMinutes > 0 ? `${stop.dwellMinutes}м` : ''}
                        </Text>
                      </Pressable>
                    ) : null}
                    {/* Reorder */}
                    {!isOrigin && stops.length > 2 ? (
                      <View className="flex-row">
                        <Pressable
                          onPress={() => moveStop(stop.id, -1)}
                          hitSlop={6}
                          disabled={idx <= 1}
                          className="p-0.5"
                        >
                          <ArrowUp size={13} color={idx <= 1 ? '#ccc' : '#666'} />
                        </Pressable>
                        <Pressable
                          onPress={() => moveStop(stop.id, 1)}
                          hitSlop={6}
                          disabled={isLast}
                          className="p-0.5"
                        >
                          <ArrowDown size={13} color={isLast ? '#ccc' : '#666'} />
                        </Pressable>
                      </View>
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
                setDetailPos('compact');
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

      {/* Time picker modal (shared) */}
      <TimePickerModal
        visible={timeModal}
        value={selectedDate}
        kind={timePickerKind}
        onChange={setSelectedDate}
        onChangeKind={setTimePickerKind}
        onClose={() => setTimeModal(false)}
      />

      {/* Dwell picker */}
      <DwellPicker
        visible={dwellPickerStopId !== null}
        currentMinutes={dwellStop?.dwellMinutes ?? 0}
        stopLabel={dwellStop?.label}
        onClose={() => setDwellPickerStopId(null)}
        onSelect={(m) => {
          if (dwellPickerStopId) setDwell(dwellPickerStopId, m);
          setDwellPickerStopId(null);
        }}
      />

      {/* Detail sheet — half-screen bottom, can be expanded up or collapsed to peek.
          Map remains visible in the other half. No black overlay so user can see route. */}
      {detailOption ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            top:
              detailPos === 'expanded'
                ? 60
                : detailPos === 'compact'
                  ? '50%'
                  : '82%',
          }}
          className="overflow-hidden rounded-t-3xl bg-card"
        >
          <Pressable
            onPress={() =>
              setDetailPos((p) =>
                p === 'collapsed' ? 'compact' : p === 'compact' ? 'expanded' : 'collapsed',
              )
            }
            className="items-center py-2"
            hitSlop={10}
          >
            <View className="h-1.5 w-12 rounded-full bg-muted-foreground/40" />
          </Pressable>
          <View className="border-b border-border px-4 pb-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-lg font-bold text-foreground">
                {formatDuration(detailOption.durationSeconds)}
              </Text>
              <Pressable
                onPress={() => setDetailOption(null)}
                hitSlop={8}
                className="h-7 w-7 items-center justify-center rounded-full bg-muted"
              >
                <X size={14} color="#666" />
              </Pressable>
            </View>
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
              {detailOption.description} · {formatDistance(distanceMeters)} · отпр. через{' '}
              {detailOption.departureInMinutes} мин
            </Text>
          </View>
          {detailPos !== 'collapsed' ? (
            <ScrollView
              contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
            >
              <TimelineView
                option={detailOption}
                origin={originLabel}
                destination={destLabel}
                departureAt={selectedDate}
              />
            </ScrollView>
          ) : null}
        </View>
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
  departureAt,
}: {
  option: TransitOption;
  origin: string;
  destination: string;
  departureAt: Date;
}) {
  // Detect consecutive bus segments at same transfer point (Пересадка) — show as paired boxes.
  const rows: React.ReactNode[] = [];
  let elapsed = 0; // seconds accumulated up to the current row
  const at = (sec: number) => {
    const d = new Date(departureAt.getTime() + sec * 1000);
    return formatHHMM(d);
  };
  for (let i = 0; i < option.segments.length; i++) {
    const seg = option.segments[i];
    const next = option.segments[i + 1];
    const isBusTransfer =
      seg.kind === 'bus' && next && next.kind === 'bus' && seg.to === next.from;

    const locLabel = i === 0 ? origin : seg.from;
    rows.push(
      <View key={`loc-${i}`} className="flex-row items-center gap-3">
        <View className="h-3 w-3 rounded-full border-2 border-primary bg-card" />
        <Text className="flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>
          {locLabel}
        </Text>
        <Text className="text-[11px] text-muted-foreground">{at(elapsed)}</Text>
      </View>,
    );

    if (isBusTransfer) {
      rows.push(
        <View
          key={`seg-transfer-${i}`}
          className="ml-1 flex-row items-center gap-2 border-l-2 border-dashed border-muted-foreground/40 pl-5 py-2"
        >
          <View className="flex-row items-center gap-2">
            <View className="rounded-md bg-primary px-2 py-1">
              <Text className="text-xs font-bold text-primary-foreground">{seg.line}</Text>
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
      rows.push(
        <View key={`seg-${i}-info`} className="ml-1 border-l-2 border-primary pl-5 py-2">
          <Text className="text-xs text-muted-foreground">
            {seg.line} · {seg.stopsCount ?? '—'} ост. · {formatDuration(seg.durationSeconds)}
          </Text>
        </View>,
      );
      elapsed += seg.durationSeconds;
      i++;
      rows.push(
        <View key={`seg-${i}-info2`} className="ml-1 border-l-2 border-primary pl-5 py-2">
          <Text className="text-xs text-muted-foreground">
            {next.line} · {next.stopsCount ?? '—'} ост. · {formatDuration(next.durationSeconds)}
          </Text>
        </View>,
      );
      elapsed += next.durationSeconds;
      continue;
    }

    if (seg.kind === 'walk') {
      rows.push(
        <View
          key={`seg-${i}`}
          className="ml-1 flex-row items-center gap-2 border-l-2 border-dashed border-emerald-500/40 pl-5 py-2"
        >
          <Footprints size={14} color="#059669" />
          <Text className="text-xs text-foreground">
            Пешком · {formatDuration(seg.durationSeconds)}
            {seg.distanceMeters > 0 ? ` · ${formatDistance(seg.distanceMeters)}` : ''}
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
            <Text className="text-xs font-bold text-primary-foreground">{seg.line}</Text>
          </View>
          <Text className="text-xs text-foreground">
            {seg.stopsCount ?? '—'} ост. · {formatDuration(seg.durationSeconds)}
          </Text>
        </View>,
      );
    }
    elapsed += seg.durationSeconds;
  }

  // Final destination marker
  rows.push(
    <View key="final" className="flex-row items-center gap-3">
      <View className="h-3 w-3 rounded-full bg-primary" />
      <Text className="flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>
        {destination}
      </Text>
      <Text className="text-[11px] text-muted-foreground">{at(elapsed)}</Text>
    </View>,
  );

  return <View className="gap-1">{rows}</View>;
}
