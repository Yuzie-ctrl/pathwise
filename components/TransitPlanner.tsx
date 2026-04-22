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
  ChevronRight,
  ChevronUp,
  Clock,
  Filter,
  Footprints,
  MapPin,
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
  transit: { icon: Bus, label: 'Автобус' },
  cycling: { icon: Bike, label: 'Вело' },
};

// Авто, Пешком, Автобус, Вело — explicit order per product brief.
const MODE_ORDER: TransportMode[] = ['driving', 'walking', 'transit', 'cycling'];

const STOP_COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899'];

interface TransitPlannerProps {
  onClose: () => void;
  onAddStop: () => void;
  onChangeOrigin: () => void;
  onDrawForStop?: (stopId: string) => void;
  /** Called when user picks a specific option to visualize on the map. */
  onSelectOption?: (option: TransitOption | null) => void;
  /** Zoom the map to a specific segment of the current transit option. */
  onZoomToSegment?: (segmentIndex: number) => void;
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
  onZoomToSegment,
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
  const [selectedKinds, setSelectedKinds] = useState<
    ('bus' | 'tram' | 'trolley' | 'train')[]
  >([]);
  const [detailOption, setDetailOption] = useState<TransitOption | null>(null);
  /** Detail sheet vertical position. */
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

  const viaStops = useMemo(
    () =>
      stops.slice(1, -1).map((s) => ({
        label: s.label,
        dwellMinutes: s.dwellMinutes,
      })),
    [stops],
  );

  const allOptions = useMemo(
    () =>
      travelSeconds > 0
        ? buildTransitOptions(
            travelSeconds,
            distanceMeters,
            originLabel,
            destLabel,
            viaStops,
          )
        : [],
    [travelSeconds, distanceMeters, originLabel, destLabel, viaStops],
  );

  const availableLines = useMemo(() => allTransitLines(allOptions), [allOptions]);

  const filteredOptions = useMemo(() => {
    let list = allOptions;
    if (selectedLines.length > 0) {
      list = list.filter((o) =>
        o.busLines.some((ln) => selectedLines.includes(ln)),
      );
    }
    if (selectedKinds.length > 0) {
      list = list.filter((o) =>
        o.vehicleKinds.some((k) => selectedKinds.includes(k)),
      );
    }
    return list;
  }, [allOptions, selectedLines, selectedKinds]);

  const toggleKind = (k: 'bus' | 'tram' | 'trolley' | 'train') => {
    setSelectedKinds((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k],
    );
  };

  const toggleLine = (line: string) => {
    setSelectedLines((prev) =>
      prev.includes(line) ? prev.filter((l) => l !== line) : [...prev, line],
    );
  };

  const visibleStops = stopsCollapsed ? stops.slice(0, 1) : stops;

  const closeDetail = () => {
    setDetailOption(null);
    setDetailPos('compact');
    onSelectOption?.(null);
  };

  // ---------------------------------------------------------------------
  // Detail-only mode: when a user picks a transit option, the planner
  // shell (mode chips, time row, stops list, filter, options list) is
  // completely hidden — only the half-screen detail sheet remains on
  // top of the map.
  // ---------------------------------------------------------------------
  if (detailOption) {
    return (
      <View className="absolute inset-0 z-40" pointerEvents="box-none">
        <DetailSheet
          option={detailOption}
          origin={originLabel}
          destination={destLabel}
          departureAt={selectedDate}
          position={detailPos}
          onTogglePosition={() =>
            setDetailPos((p) =>
              p === 'collapsed'
                ? 'compact'
                : p === 'compact'
                  ? 'expanded'
                  : 'collapsed',
            )
          }
          onSelectPosition={setDetailPos}
          onClose={closeDetail}
          onZoomToSegment={(idx) => {
            setDetailPos('collapsed');
            onZoomToSegment?.(idx);
          }}
          totalDistance={distanceMeters}
        />
      </View>
    );
  }

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
            {MODE_ORDER.map((m) => {
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
              selectedLines.length + selectedKinds.length > 0
                ? 'border-primary bg-primary/10'
                : 'border-border bg-card'
            }`}
          >
            <Filter
              size={16}
              color={
                selectedLines.length + selectedKinds.length > 0 ? '#2563eb' : '#666'
              }
            />
            {selectedLines.length + selectedKinds.length > 0 ? (
              <View className="absolute -right-1 -top-1 h-4 w-4 items-center justify-center rounded-full bg-primary">
                <Text className="text-[9px] font-bold text-primary-foreground">
                  {selectedLines.length + selectedKinds.length}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        {/* Filter chips panel */}
        {filterOpen ? (
          <View className="mx-4 mt-2 rounded-xl border border-border bg-card p-3">
            <Text className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Вид транспорта
            </Text>
            <View className="mb-3 flex-row flex-wrap gap-2">
              {(
                [
                  { k: 'bus' as const, label: 'Автобус' },
                  { k: 'tram' as const, label: 'Трамвай' },
                  { k: 'trolley' as const, label: 'Троллейбус' },
                  { k: 'train' as const, label: 'Поезд' },
                ]
              ).map((opt) => {
                const active = selectedKinds.includes(opt.k);
                return (
                  <Pressable
                    key={opt.k}
                    onPress={() => toggleKind(opt.k)}
                    className={`rounded-full border px-3 py-1 ${
                      active ? 'border-primary bg-primary' : 'border-border bg-muted'
                    }`}
                  >
                    <Text
                      className={`text-xs font-semibold ${
                        active ? 'text-primary-foreground' : 'text-foreground'
                      }`}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
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
      <View
        className="rounded-md px-1.5 py-0.5"
        style={{ backgroundColor: '#dc2626' }}
      >
        <Text className="text-[10px] font-bold text-white">
          {stripNumPrefix(segment.line ?? 'BUS')}
        </Text>
      </View>
      {!isLast ? <Text className="text-muted-foreground">›</Text> : null}
    </View>
  );
}

function stripNumPrefix(s: string): string {
  return s.replace(/^№\s*/, '');
}

// ---------------------------------------------------------------------
// Detail sheet — Google-Maps-style timeline
// ---------------------------------------------------------------------

interface DetailSheetProps {
  option: TransitOption;
  origin: string;
  destination: string;
  departureAt: Date;
  position: 'compact' | 'expanded' | 'collapsed';
  onTogglePosition: () => void;
  onSelectPosition: (p: 'compact' | 'expanded' | 'collapsed') => void;
  onClose: () => void;
  onZoomToSegment: (segmentIndex: number) => void;
  totalDistance: number;
}

function DetailSheet({
  option,
  origin,
  destination,
  departureAt,
  position,
  onTogglePosition,
  onSelectPosition: _onSelectPosition,
  onClose,
  onZoomToSegment,
  totalDistance: _totalDistance,
}: DetailSheetProps) {
  const topOffset =
    position === 'expanded' ? 60 : position === 'compact' ? '50%' : '85%';

  // Bus-line pill summary at top (7 › 49 › 8 › walker-minutes) like screenshot
  const pillSummary: { line: string; walk?: number }[] = [];
  let trailingWalkMin = 0;
  for (const seg of option.segments) {
    if (seg.kind === 'walk') {
      trailingWalkMin += Math.max(1, Math.round(seg.durationSeconds / 60));
    } else {
      pillSummary.push({ line: stripNumPrefix(seg.line ?? 'BUS') });
    }
  }

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        top: topOffset,
      }}
      className="overflow-hidden rounded-t-3xl bg-card"
    >
      {/* Grabber */}
      <Pressable onPress={onTogglePosition} className="items-center py-2" hitSlop={10}>
        <View className="h-1.5 w-12 rounded-full bg-muted-foreground/40" />
      </Pressable>

      {/* Top header row — bus pill chain + walker minutes + close */}
      <View className="flex-row items-center gap-2 border-b border-border px-4 pb-3">
        <View className="flex-1 flex-row flex-wrap items-center gap-1">
          {pillSummary.map((p, i) => (
            <View key={i} className="flex-row items-center gap-1">
              <View className="flex-row items-center gap-1 rounded-md bg-muted px-1.5 py-0.5">
                <Bus size={11} color="#666" />
                <View
                  className="rounded-sm px-1.5 py-0.5"
                  style={{ backgroundColor: '#dc2626' }}
                >
                  <Text className="text-[11px] font-bold text-white">{p.line}</Text>
                </View>
              </View>
              {i < pillSummary.length - 1 ? (
                <ChevronRight size={12} color="#888" />
              ) : null}
            </View>
          ))}
          {trailingWalkMin > 0 ? (
            <>
              <ChevronRight size={12} color="#888" />
              <View className="flex-row items-center gap-0.5">
                <Footprints size={12} color="#666" />
                <Text className="text-[11px] font-semibold text-foreground">
                  {trailingWalkMin}
                </Text>
              </View>
            </>
          ) : null}
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          className="h-8 w-8 items-center justify-center rounded-full bg-muted active:bg-muted/70"
        >
          <X size={16} color="#666" />
        </Pressable>
      </View>

      {position !== 'collapsed' ? (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          <Timeline
            option={option}
            origin={origin}
            destination={destination}
            departureAt={departureAt}
            onZoomToSegment={onZoomToSegment}
          />
        </ScrollView>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------
// Timeline — Google-Maps-style
// ---------------------------------------------------------------------

const RAIL_COLOR = '#dc2626'; // red bus rail (like screenshot)
const WALK_COLOR = '#9ca3af'; // gray for walk dots

/** Height of each row type in the timeline, in px — used for connector rail. */
const _ROW_H_STOP = 54;
const _ROW_H_WALK = 52;
const _ROW_H_BUS = 110;

function Timeline({
  option,
  origin,
  destination,
  departureAt,
  onZoomToSegment,
}: {
  option: TransitOption;
  origin: string;
  destination: string;
  departureAt: Date;
  onZoomToSegment: (segmentIndex: number) => void;
}) {
  // Times: we accumulate elapsed seconds from `departureAt` to render HH:MM next to each stop/location.
  const segs = option.segments;

  // Precompute time-at-each-segment start
  const elapsedAt: number[] = [];
  let acc = 0;
  for (const s of segs) {
    elapsedAt.push(acc);
    acc += s.durationSeconds;
  }
  const totalElapsed = acc;

  const time = (sec: number) => {
    const d = new Date(departureAt.getTime() + sec * 1000);
    return formatHHMM(d);
  };

  const rows: React.ReactNode[] = [];

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const elapsed = elapsedAt[i];
    const next = segs[i + 1];
    const prev = segs[i - 1];

    // At the beginning OR whenever previous segment is a walk and current is bus,
    // emit a "location" row — a named place with time on the right.
    if (i === 0) {
      rows.push(
        <LocationRow
          key={`loc-start`}
          label={origin}
          subLabel={undefined}
          time={time(elapsed)}
          markerColor={RAIL_COLOR}
          filled={false}
        />,
      );
    }

    if (seg.kind === 'walk') {
      if (seg.isDwell) {
        rows.push(
          <DwellRow
            key={`dwell-${i}`}
            minutes={Math.max(1, Math.round(seg.durationSeconds / 60))}
            location={seg.to}
            time={time(elapsed + seg.durationSeconds)}
          />,
        );
      } else {
        rows.push(
          <WalkRow
            key={`walk-${i}`}
            durationSec={seg.durationSeconds}
            distanceM={seg.distanceMeters}
            onPress={() => onZoomToSegment(i)}
          />,
        );
      }
    } else {
      // Detect consecutive bus segments at a shared transfer stop.
      const isTransferNext =
        next && next.kind === 'bus' && next.from === seg.to && seg.to === next.from;

      // Bus arrives at "seg.to" — after the bus ride, render a stop marker
      // labelled with `seg.to` (unless the very next segment continues at
      // the same transfer). We render the bus block now.
      rows.push(
        <BusRow
          key={`bus-${i}`}
          line={stripNumPrefix(seg.line ?? 'BUS')}
          fromLabel={seg.from}
          toLabel={seg.to}
          stopsCount={seg.stopsCount ?? 0}
          durationSec={seg.durationSeconds}
          startTime={time(elapsed)}
          endTime={time(elapsed + seg.durationSeconds)}
          isFirst={i === 0 || (prev && prev.kind === 'walk' && i === 1)}
          isTransferAfter={!!isTransferNext}
          onPress={() => onZoomToSegment(i)}
        />,
      );

      if (isTransferNext && next) {
        // Emit a compact "transfer" row with paired line badges.
        rows.push(
          <TransferRow
            key={`xfer-${i}`}
            fromLine={stripNumPrefix(seg.line ?? 'BUS')}
            toLine={stripNumPrefix(next.line ?? 'BUS')}
            location={seg.to}
            time={time(elapsed + seg.durationSeconds)}
          />,
        );
        // Skip next iteration's "emit start location" logic because we've
        // already rendered the shared location.
      } else {
        // Ordinary bus end -> next location.
        // If the NEXT segment is a walk that goes towards the destination,
        // show the bus arrival stop as a location row.
        if (next) {
          rows.push(
            <LocationRow
              key={`loc-after-bus-${i}`}
              label={seg.to}
              subLabel={undefined}
              time={time(elapsed + seg.durationSeconds)}
              markerColor={RAIL_COLOR}
              filled={false}
            />,
          );
        }
      }
    }

    // If previous was a bus that ended, and current (walk) started from a location,
    // the walk row above already handled it; no extra location needed.
  }

  // Final pin — destination
  rows.push(
    <View key="final" className="flex-row items-start">
      <View style={{ width: 28, alignItems: 'center' }}>
        <MapPin size={20} color="#dc2626" fill="#dc2626" />
      </View>
      <View className="flex-1 pb-3">
        <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
          {destination}
        </Text>
      </View>
      <Text className="text-sm font-semibold text-foreground">{time(totalElapsed)}</Text>
    </View>,
  );

  return <View>{rows}</View>;
}

// ----- Row components -----

function LocationRow({
  label,
  subLabel,
  time,
  markerColor,
  filled: _filled,
}: {
  label: string;
  subLabel?: string;
  time: string;
  markerColor: string;
  filled?: boolean;
}) {
  return (
    <View className="flex-row items-start">
      {/* Rail column */}
      <View style={{ width: 28, alignItems: 'center' }}>
        <View
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: '#fff',
            borderWidth: 3,
            borderColor: markerColor,
            marginTop: 4,
          }}
        />
      </View>
      <View className="flex-1 pb-3">
        <View className="flex-row items-start justify-between">
          <Text
            className="flex-1 text-base font-semibold text-foreground"
            numberOfLines={1}
          >
            {label}
          </Text>
          <Text className="ml-2 text-sm font-semibold text-foreground">{time}</Text>
        </View>
        {subLabel ? (
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {subLabel}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function WalkRow({
  durationSec,
  distanceM,
  onPress,
}: {
  durationSec: number;
  distanceM: number;
  onPress: () => void;
}) {
  const minutes = Math.max(1, Math.round(durationSec / 60));
  return (
    <View className="flex-row">
      {/* Rail column: 4 gray dots like screenshot */}
      <View style={{ width: 28, alignItems: 'center', paddingVertical: 8 }}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={{
              width: 4,
              height: 4,
              borderRadius: 2,
              backgroundColor: WALK_COLOR,
              marginVertical: 2,
            }}
          />
        ))}
      </View>
      <Pressable
        onPress={onPress}
        className="flex-1 flex-row items-center justify-between py-2 pr-2 active:bg-muted/30"
      >
        <View className="flex-row items-center gap-3">
          <Footprints size={18} color="#666" />
          <Text className="text-sm text-foreground">
            Пешком {minutes} мин. ({formatDistance(distanceM)})
          </Text>
        </View>
        <ChevronRight size={18} color="#999" />
      </Pressable>
    </View>
  );
}

function BusRow({
  line,
  fromLabel: _fromLabel,
  toLabel: _toLabel,
  stopsCount,
  durationSec,
  startTime: _startTime,
  endTime: _endTime,
  isFirst: _isFirst,
  isTransferAfter: _isTransferAfter,
  onPress,
}: {
  line: string;
  fromLabel: string;
  toLabel: string;
  stopsCount: number;
  durationSec: number;
  startTime: string;
  endTime: string;
  isFirst: boolean;
  isTransferAfter: boolean;
  onPress: () => void;
}) {
  const minutes = Math.max(1, Math.round(durationSec / 60));
  return (
    <View className="flex-row">
      {/* Solid red rail column */}
      <View style={{ width: 28, alignItems: 'center' }}>
        <View
          style={{
            width: 8,
            backgroundColor: RAIL_COLOR,
            alignSelf: 'center',
            flex: 1,
            borderRadius: 4,
            marginVertical: 2,
          }}
        />
      </View>
      <Pressable
        onPress={onPress}
        className="flex-1 py-3 pr-2 active:bg-muted/30"
      >
        {/* Bus line + destination */}
        <View className="flex-row items-center gap-2">
          <View
            className="rounded-md px-2 py-1"
            style={{ backgroundColor: RAIL_COLOR }}
          >
            <Text className="text-sm font-bold text-white">{line}</Text>
          </View>
          <Bus size={16} color="#111" />
          <Text className="flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>
            Маршрут {line}
          </Text>
          <ChevronRight size={18} color="#999" />
        </View>
        {/* Info row */}
        <View className="mt-2 flex-row items-center gap-1 pl-1">
          <ChevronDown size={14} color="#777" />
          <Text className="text-xs text-muted-foreground">
            Сколько ехать: {stopsCount > 0 ? `${stopsCount} ост. ` : ''}({minutes} мин.)
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

function TransferRow({
  fromLine,
  toLine,
  location,
  time,
}: {
  fromLine: string;
  toLine: string;
  location: string;
  time: string;
}) {
  return (
    <View className="flex-row items-start">
      <View style={{ width: 28, alignItems: 'center' }}>
        <View
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: '#fff',
            borderWidth: 3,
            borderColor: RAIL_COLOR,
            marginTop: 4,
          }}
        />
      </View>
      <View className="flex-1 pb-3">
        <View className="flex-row items-start justify-between">
          <Text
            className="flex-1 text-base font-semibold text-foreground"
            numberOfLines={1}
          >
            {location}
          </Text>
          <Text className="ml-2 text-sm font-semibold text-foreground">{time}</Text>
        </View>
        <View className="mt-1 flex-row items-center gap-2">
          <View
            className="rounded-md px-1.5 py-0.5"
            style={{ backgroundColor: RAIL_COLOR }}
          >
            <Text className="text-xs font-bold text-white">{fromLine}</Text>
          </View>
          <ArrowLeftRight size={14} color="#888" />
          <View
            className="rounded-md px-1.5 py-0.5"
            style={{ backgroundColor: RAIL_COLOR }}
          >
            <Text className="text-xs font-bold text-white">{toLine}</Text>
          </View>
          <Text className="text-[11px] text-muted-foreground">
            Пересадка на той же остановке
          </Text>
        </View>
      </View>
    </View>
  );
}

function DwellRow({
  minutes,
  location,
  time,
}: {
  minutes: number;
  location: string;
  time: string;
}) {
  return (
    <View className="flex-row items-start">
      <View style={{ width: 28, alignItems: 'center', paddingVertical: 4 }}>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: '#fef3c7',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Pause size={11} color="#b45309" />
        </View>
      </View>
      <View className="flex-1 flex-row items-center justify-between pb-3">
        <View className="flex-1">
          <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
            Пауза · {minutes} мин
          </Text>
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {location}
          </Text>
        </View>
        <Text className="ml-2 text-sm font-semibold text-foreground">{time}</Text>
      </View>
    </View>
  );
}
