import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import {
  ArrowDown,
  ArrowUp,
  Bike,
  Bus,
  Car,
  Clock,
  Footprints,
  MapPin,
  Navigation2,
  Pause,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react-native';

import { DwellPicker } from '@/components/DwellPicker';
import { SearchSheet } from '@/components/SearchSheet';
import { Text } from '@/components/ui/text';
import {
  buildTransitOptions,
  formatDistance,
  formatDuration,
  formatETA,
  type GeocodeResult,
} from '@/lib/routing';
import {
  totalDistanceMeters,
  totalDwellMinutes,
  totalTravelSeconds,
  type TransportMode,
  useTripStore,
} from '@/lib/stores/tripStore';

const MODE_CONFIG: Record<
  TransportMode,
  { icon: typeof Car; label: string }
> = {
  driving: { icon: Car, label: 'Авто' },
  walking: { icon: Footprints, label: 'Пешком' },
  cycling: { icon: Bike, label: 'Вело' },
  transit: { icon: Bus, label: 'Автобус' },
};

const STOP_COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899'];

interface RoutePlannerProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
  onStartTrip: () => void;
  onChangeOrigin: () => void;
  onAddStop?: () => void;
}

export function RoutePlanner({
  collapsed,
  onToggleCollapsed,
  onClose,
  onStartTrip,
  onChangeOrigin,
  onAddStop,
}: RoutePlannerProps) {
  const stops = useTripStore((s) => s.stops);
  const mode = useTripStore((s) => s.mode);
  const legs = useTripStore((s) => s.legs);
  const loadingRoute = useTripStore((s) => s.loadingRoute);
  const addStop = useTripStore((s) => s.addStop);
  const removeStop = useTripStore((s) => s.removeStop);
  const setDwell = useTripStore((s) => s.setDwell);
  const moveStop = useTripStore((s) => s.moveStop);
  const clearStops = useTripStore((s) => s.clearStops);
  const setMode = useTripStore((s) => s.setMode);

  const [searchOpen, setSearchOpen] = useState(false);
  const [dwellPickerStopId, setDwellPickerStopId] = useState<string | null>(null);

  const dwellStop = stops.find((s) => s.id === dwellPickerStopId);

  const travelSeconds = totalTravelSeconds(legs);
  const dwellMinutes = totalDwellMinutes(stops);
  const dwellSeconds = dwellMinutes * 60;
  const totalSeconds = travelSeconds + dwellSeconds;
  const distanceMeters = totalDistanceMeters(legs);

  const canShowSummary = stops.length >= 2 && legs.length > 0;
  const canStart = stops.length >= 2;

  const summary = useMemo(() => {
    if (!canShowSummary) return null;
    return {
      total: formatDuration(totalSeconds),
      travel: formatDuration(travelSeconds),
      dwell: dwellMinutes > 0 ? `${dwellMinutes} мин` : null,
      distance: formatDistance(distanceMeters),
      eta: formatETA(totalSeconds),
    };
  }, [canShowSummary, totalSeconds, travelSeconds, dwellMinutes, distanceMeters]);

  const transitOptions = useMemo(
    () =>
      canShowSummary && mode === 'transit'
        ? buildTransitOptions(travelSeconds, distanceMeters)
        : [],
    [canShowSummary, mode, travelSeconds, distanceMeters],
  );

  const handleSelectPlace = (result: GeocodeResult) => {
    addStop({
      label: result.shortName,
      latitude: result.latitude,
      longitude: result.longitude,
    });
    setSearchOpen(false);
  };

  if (searchOpen) {
    return (
      <View className="absolute inset-0 z-50 bg-background">
        <SearchSheet
          placeholder="Добавить остановку"
          onSelect={handleSelectPlace}
          onClose={() => setSearchOpen(false)}
        />
      </View>
    );
  }

  return (
    <View
      className="absolute inset-x-0 bottom-0 z-40 rounded-t-3xl bg-card"
      style={{
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 12,
        maxHeight: '85%',
      }}
    >
      {/* Grabber — tapping collapses/expands */}
      <Pressable
        onPress={onToggleCollapsed}
        hitSlop={12}
        className={collapsed ? 'items-center pb-3 pt-3' : 'items-center pb-1 pt-2'}
      >
        <View className="h-1.5 w-12 rounded-full bg-muted-foreground/40" />
      </Pressable>

      {collapsed ? (
        <Pressable
          onPress={onToggleCollapsed}
          className="flex-row items-center justify-between px-4 pb-5"
        >
          <View className="flex-1">
            <Text
              className="text-base font-semibold text-foreground"
              numberOfLines={1}
            >
              {summary ? summary.total : 'Маршрут готов'}
              {summary ? (
                <Text className="text-sm font-normal text-muted-foreground">
                  {' · '}
                  {summary.distance}
                </Text>
              ) : null}
            </Text>
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
              {summary
                ? `прибытие ≈ ${summary.eta}`
                : `${stops.length} ${pluralize(stops.length, ['точка', 'точки', 'точек'])}`}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            className="rounded-full p-2 active:bg-muted"
          >
            <X size={18} color="#888" />
          </Pressable>
        </Pressable>
      ) : null}

      {collapsed ? null : (
        <>
          <View className="flex-row items-center justify-between px-4 pb-2 pt-1">
            <View className="flex-1">
              <Text className="text-lg font-semibold text-foreground">Маршрут</Text>
              <Text className="text-xs text-muted-foreground">
                {stops.length <= 1
                  ? 'Добавьте точку назначения'
                  : `${stops.length} ${pluralize(stops.length, ['точка', 'точки', 'точек'])}`}
              </Text>
            </View>
            <View className="flex-row items-center gap-1">
              {stops.length > 1 ? (
                <Pressable
                  onPress={clearStops}
                  hitSlop={8}
                  className="rounded-full p-2 active:bg-muted"
                >
                  <Trash2 size={18} color="#888" />
                </Pressable>
              ) : null}
              <Pressable
                onPress={onClose}
                hitSlop={8}
                className="rounded-full p-2 active:bg-muted"
              >
                <X size={18} color="#888" />
              </Pressable>
            </View>
          </View>

          {/* Transport mode toggle */}
          <View className="flex-row gap-2 px-4 pb-3">
            {(Object.keys(MODE_CONFIG) as TransportMode[]).map((m) => {
              const cfg = MODE_CONFIG[m];
              const Icon = cfg.icon;
              const active = mode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  className={`flex-1 items-center justify-center gap-1 rounded-xl border py-2 ${
                    active ? 'border-primary bg-primary' : 'border-border bg-muted'
                  }`}
                >
                  <Icon size={18} color={active ? '#fff' : '#444'} />
                  <Text
                    className={`text-[11px] font-medium ${
                      active ? 'text-primary-foreground' : 'text-foreground'
                    }`}
                  >
                    {cfg.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Summary */}
          {summary ? (
            <View className="mx-4 mb-3 rounded-2xl bg-muted p-3">
              <View className="flex-row items-baseline justify-between">
                <Text className="text-2xl font-bold text-foreground">{summary.total}</Text>
                <Text className="text-sm text-muted-foreground">
                  прибытие ≈ {summary.eta}
                </Text>
              </View>
              <View className="mt-1 flex-row flex-wrap gap-x-3">
                <Text className="text-xs text-muted-foreground">
                  в пути {summary.travel}
                </Text>
                {summary.dwell ? (
                  <Text className="text-xs text-muted-foreground">
                    остановки {summary.dwell}
                  </Text>
                ) : null}
                <Text className="text-xs text-muted-foreground">{summary.distance}</Text>
              </View>
            </View>
          ) : loadingRoute ? (
            <View className="mx-4 mb-3 rounded-2xl bg-muted p-3">
              <Text className="text-sm text-muted-foreground">Строим маршрут…</Text>
            </View>
          ) : null}

          {/* Bus route variants (transit mode) */}
          {mode === 'transit' && transitOptions.length > 0 ? (
            <View className="mx-4 mb-3">
              <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Варианты на автобусе
              </Text>
              <View className="gap-2">
                {transitOptions.map((opt) => (
                  <View
                    key={opt.id}
                    className="flex-row items-center gap-3 rounded-2xl border border-border bg-background px-3 py-2.5"
                  >
                    <View className="h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                      <Bus size={18} color="#8b5cf6" />
                    </View>
                    <View className="flex-1">
                      <View className="flex-row items-center gap-2">
                        {opt.busLines.map((ln) => (
                          <View
                            key={ln}
                            className="rounded-md bg-primary/10 px-1.5 py-0.5"
                          >
                            <Text className="text-[11px] font-semibold text-primary">
                              {ln}
                            </Text>
                          </View>
                        ))}
                        <Text
                          className="flex-1 text-sm font-medium text-foreground"
                          numberOfLines={1}
                        >
                          {opt.label}
                        </Text>
                      </View>
                      <Text
                        className="text-[11px] text-muted-foreground"
                        numberOfLines={1}
                      >
                        {opt.description} · пешком {opt.walkMinutes} мин
                        {opt.transfers > 0
                          ? ` · ${opt.transfers} ${pluralize(opt.transfers, ['пересадка', 'пересадки', 'пересадок'])}`
                          : ''}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-sm font-semibold text-foreground">
                        {formatDuration(opt.durationSeconds)}
                      </Text>
                      <View className="mt-0.5 flex-row items-center gap-1">
                        <Users size={10} color="#888" />
                        <Text className="text-[10px] text-muted-foreground">
                          через {opt.departureInMinutes} мин
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
              <Text className="mt-2 text-[10px] text-muted-foreground">
                Онлайн-отслеживание автобусов недоступно в этом регионе — данные приблизительные.
              </Text>
            </View>
          ) : null}

          {/* Stops list */}
          <ScrollView
            style={{ maxHeight: 320 }}
            contentContainerStyle={{ paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
          >
            {stops.map((stop, idx) => {
              const color = STOP_COLORS[idx % STOP_COLORS.length];
              const isFirst = idx === 0;
              const isLast = idx === stops.length - 1;
              const isOrigin = isFirst;
              return (
                <View key={stop.id} className="px-4">
                  <View className="flex-row items-center gap-3 py-2">
                    {/* Index chip */}
                    <View
                      className="h-7 w-7 items-center justify-center rounded-full"
                      style={{ backgroundColor: color }}
                    >
                      <Text className="text-xs font-bold text-white">{idx + 1}</Text>
                    </View>

                    {/* Label */}
                    {isOrigin ? (
                      <Pressable
                        onPress={onChangeOrigin}
                        className="flex-1 flex-row items-center gap-2 rounded-lg bg-muted/50 px-2 py-1.5 active:bg-muted"
                      >
                        {stop.originKind === 'myLocation' ? (
                          <MapPin size={14} color="#2563eb" />
                        ) : null}
                        <View className="flex-1">
                          <Text
                            className="text-sm font-medium text-foreground"
                            numberOfLines={1}
                          >
                            {stop.label}
                          </Text>
                          {stop.originKind === 'myLocation' ? (
                            <Text className="text-[11px] text-muted-foreground">
                              нажмите, чтобы выбрать другую точку
                            </Text>
                          ) : stop.displayName && stop.displayName !== stop.label ? (
                            <Text
                              className="text-[11px] text-muted-foreground"
                              numberOfLines={1}
                            >
                              {stop.displayName}
                            </Text>
                          ) : (
                            <Text className="text-[11px] text-muted-foreground">
                              точка отправления
                            </Text>
                          )}
                        </View>
                      </Pressable>
                    ) : (
                      <View className="flex-1">
                        <Text
                          className="text-sm font-medium text-foreground"
                          numberOfLines={1}
                        >
                          {stop.label}
                        </Text>
                        {stop.displayName && stop.displayName !== stop.label ? (
                          <Text
                            className="text-[11px] text-muted-foreground"
                            numberOfLines={1}
                          >
                            {stop.displayName}
                          </Text>
                        ) : null}
                        {!isLast && stop.dwellMinutes > 0 ? (
                          <View className="mt-1 flex-row items-center gap-1 self-start rounded-full bg-amber-100 px-2 py-0.5 dark:bg-amber-500/20">
                            <Pause size={10} color="#b45309" />
                            <Text className="text-[11px] font-medium text-amber-800 dark:text-amber-300">
                              пауза {stop.dwellMinutes} мин
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    )}

                    {/* Dwell button — hidden for origin (idx 0) and last */}
                    {!isOrigin && !isLast ? (
                      <Pressable
                        onPress={() => setDwellPickerStopId(stop.id)}
                        hitSlop={6}
                        className={`flex-row items-center gap-1 rounded-full px-2.5 py-1.5 ${
                          stop.dwellMinutes > 0 ? 'bg-primary/10' : 'bg-muted'
                        }`}
                      >
                        <Clock
                          size={14}
                          color={stop.dwellMinutes > 0 ? '#2563eb' : '#666'}
                        />
                        <Text
                          className={`text-xs font-medium ${
                            stop.dwellMinutes > 0 ? 'text-primary' : 'text-foreground'
                          }`}
                        >
                          {stop.dwellMinutes > 0 ? `${stop.dwellMinutes}м` : 'Время'}
                        </Text>
                      </Pressable>
                    ) : null}

                    {/* Reorder — not for origin */}
                    {!isOrigin ? (
                      <View className="flex-row">
                        <Pressable
                          onPress={() => moveStop(stop.id, -1)}
                          hitSlop={6}
                          disabled={idx <= 1}
                          className="p-1.5"
                        >
                          <ArrowUp size={14} color={idx <= 1 ? '#ccc' : '#666'} />
                        </Pressable>
                        <Pressable
                          onPress={() => moveStop(stop.id, 1)}
                          hitSlop={6}
                          disabled={isLast}
                          className="p-1.5"
                        >
                          <ArrowDown size={14} color={isLast ? '#ccc' : '#666'} />
                        </Pressable>
                      </View>
                    ) : null}

                    {/* Remove — not for origin */}
                    {!isOrigin ? (
                      <Pressable
                        onPress={() => removeStop(stop.id)}
                        hitSlop={6}
                        className="p-1.5"
                      >
                        <X size={16} color="#888" />
                      </Pressable>
                    ) : null}
                  </View>
                  {!isLast ? <View className="ml-3 h-3 w-0.5 bg-border" /> : null}
                </View>
              );
            })}

            {/* Add stop button */}
            <Pressable
              onPress={() => (onAddStop ? onAddStop() : setSearchOpen(true))}
              className="mx-4 mt-2 flex-row items-center gap-3 rounded-2xl border border-dashed border-border bg-muted/50 px-4 py-3 active:bg-muted"
            >
              <View className="h-7 w-7 items-center justify-center rounded-full bg-primary">
                <Plus size={16} color="#fff" />
              </View>
              <Text className="text-sm font-medium text-foreground">
                {stops.length <= 1 ? 'Добавить точку' : 'Добавить остановку'}
              </Text>
            </Pressable>
          </ScrollView>

          {/* Start trip CTA */}
          <View className="border-t border-border p-4 pb-5">
            <Pressable
              onPress={onStartTrip}
              disabled={!canStart}
              className={`flex-row items-center justify-center gap-2 rounded-2xl py-4 ${
                canStart ? 'bg-primary' : 'bg-muted'
              }`}
              style={
                canStart
                  ? {
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.18,
                      shadowRadius: 10,
                      elevation: 6,
                    }
                  : undefined
              }
            >
              <Navigation2
                size={18}
                color={canStart ? '#fff' : '#999'}
              />
              <Text
                className={`text-base font-semibold ${
                  canStart ? 'text-primary-foreground' : 'text-muted-foreground'
                }`}
              >
                В дорогу
              </Text>
            </Pressable>
          </View>
        </>
      )}

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

function pluralize(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}
