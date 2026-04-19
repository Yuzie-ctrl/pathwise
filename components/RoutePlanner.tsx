import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import {
  ArrowDown,
  ArrowUp,
  Bike,
  Car,
  ChevronDown,
  ChevronUp,
  Clock,
  Footprints,
  Plus,
  Trash2,
  X,
} from 'lucide-react-native';

import { DwellPicker } from '@/components/DwellPicker';
import { SearchSheet } from '@/components/SearchSheet';
import { Text } from '@/components/ui/text';
import {
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
  driving: { icon: Car, label: 'Машина' },
  walking: { icon: Footprints, label: 'Пешком' },
  cycling: { icon: Bike, label: 'Велосипед' },
};

const STOP_COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899'];

interface RoutePlannerProps {
  expanded: boolean;
  onToggleExpanded: () => void;
  onClose: () => void;
}

export function RoutePlanner({ expanded, onToggleExpanded, onClose }: RoutePlannerProps) {
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
          placeholder={stops.length === 0 ? 'Откуда' : 'Добавить остановку'}
          onSelect={handleSelectPlace}
          onClose={() => setSearchOpen(false)}
        />
      </View>
    );
  }

  return (
    <View
      className="absolute inset-x-0 bottom-0 z-40 rounded-t-3xl bg-card shadow-xl"
      style={{
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 12,
        maxHeight: '80%',
      }}
    >
      {/* Grabber + header */}
      <Pressable onPress={onToggleExpanded} className="items-center pt-2">
        <View className="h-1 w-10 rounded-full bg-muted-foreground/40" />
      </Pressable>

      <View className="flex-row items-center justify-between px-4 pb-2 pt-3">
        <View className="flex-1">
          <Text className="text-lg font-semibold text-foreground">Маршрут</Text>
          <Text className="text-xs text-muted-foreground">
            {stops.length === 0
              ? 'Добавьте первую точку'
              : `${stops.length} ${pluralize(stops.length, ['точка', 'точки', 'точек'])}`}
          </Text>
        </View>
        <View className="flex-row items-center gap-1">
          {stops.length > 0 ? (
            <Pressable onPress={clearStops} hitSlop={8} className="rounded-full p-2 active:bg-muted">
              <Trash2 size={18} color="#888" />
            </Pressable>
          ) : null}
          <Pressable onPress={onToggleExpanded} hitSlop={8} className="rounded-full p-2 active:bg-muted">
            {expanded ? (
              <ChevronDown size={20} color="#444" />
            ) : (
              <ChevronUp size={20} color="#444" />
            )}
          </Pressable>
          <Pressable onPress={onClose} hitSlop={8} className="rounded-full p-2 active:bg-muted">
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
              className={`flex-1 flex-row items-center justify-center gap-2 rounded-xl border py-2.5 ${
                active ? 'border-primary bg-primary' : 'border-border bg-muted'
              }`}
            >
              <Icon size={16} color={active ? '#fff' : '#444'} />
              <Text
                className={`text-sm font-medium ${
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
            <Text className="text-sm text-muted-foreground">прибытие ≈ {summary.eta}</Text>
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
            <Text className="text-xs text-muted-foreground">
              {summary.distance}
            </Text>
          </View>
        </View>
      ) : loadingRoute ? (
        <View className="mx-4 mb-3 rounded-2xl bg-muted p-3">
          <Text className="text-sm text-muted-foreground">Строим маршрут…</Text>
        </View>
      ) : null}

      {/* Stops list */}
      <ScrollView
        style={{ maxHeight: expanded ? 380 : 220 }}
        contentContainerStyle={{ paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {stops.map((stop, idx) => {
          const color = STOP_COLORS[idx % STOP_COLORS.length];
          const isFirst = idx === 0;
          const isLast = idx === stops.length - 1;
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
                <View className="flex-1">
                  <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                    {stop.label}
                  </Text>
                  {!isLast && stop.dwellMinutes > 0 ? (
                    <Text className="text-xs text-muted-foreground">
                      остановка {stop.dwellMinutes} мин
                    </Text>
                  ) : null}
                </View>

                {/* Dwell button (hide for last stop) */}
                {!isLast ? (
                  <Pressable
                    onPress={() => setDwellPickerStopId(stop.id)}
                    hitSlop={6}
                    className={`flex-row items-center gap-1 rounded-full px-2.5 py-1.5 ${
                      stop.dwellMinutes > 0
                        ? 'bg-primary/10'
                        : 'bg-muted'
                    }`}
                  >
                    <Clock
                      size={14}
                      color={stop.dwellMinutes > 0 ? '#2563eb' : '#666'}
                    />
                    <Text
                      className={`text-xs font-medium ${
                        stop.dwellMinutes > 0
                          ? 'text-primary'
                          : 'text-foreground'
                      }`}
                    >
                      {stop.dwellMinutes > 0 ? `${stop.dwellMinutes}м` : 'Время'}
                    </Text>
                  </Pressable>
                ) : null}

                {/* Reorder */}
                <View className="flex-row">
                  <Pressable
                    onPress={() => moveStop(stop.id, -1)}
                    hitSlop={6}
                    disabled={isFirst}
                    className="p-1.5"
                  >
                    <ArrowUp size={14} color={isFirst ? '#ccc' : '#666'} />
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

                {/* Remove */}
                <Pressable
                  onPress={() => removeStop(stop.id)}
                  hitSlop={6}
                  className="p-1.5"
                >
                  <X size={16} color="#888" />
                </Pressable>
              </View>
              {!isLast ? (
                <View className="ml-3 h-3 w-0.5 bg-border" />
              ) : null}
            </View>
          );
        })}

        {/* Add stop button */}
        <Pressable
          onPress={() => setSearchOpen(true)}
          className="mx-4 mt-2 flex-row items-center gap-3 rounded-2xl border border-dashed border-border bg-muted/50 px-4 py-3 active:bg-muted"
        >
          <View className="h-7 w-7 items-center justify-center rounded-full bg-primary">
            <Plus size={16} color="#fff" />
          </View>
          <Text className="text-sm font-medium text-foreground">
            {stops.length === 0
              ? 'Добавить первую точку'
              : stops.length === 1
                ? 'Куда'
                : 'Добавить остановку'}
          </Text>
        </Pressable>
      </ScrollView>

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
