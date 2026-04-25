import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Bus,
  ChevronLeft,
  ChevronRight,
  List as ListIcon,
  Locate,
  MapPin,
  Search,
  Star,
  Train,
  X,
} from 'lucide-react-native';

import MapView, {
  type MapMarker,
  type MapPolyline,
  type MapRegion,
} from '@/components/MapView';
import { Text } from '@/components/ui/text';
import {
  fetchAllRoutes,
  fetchNextArrivals,
  fetchRoute,
  fetchRouteTrips,
  fetchRoutesAtStop,
  fetchStopById,
  fetchStopDailyArrivals,
  fetchTripStops,
  groupArrivalsByHour,
  minuteToHHMM,
  minutesFromMidnight,
  searchRoutes,
  searchStops,
  serviceDayFor,
  vehicleColor,
  authorityLabel,
  type NextArrival,
  type RouteStopListItem,
  type ServiceDay,
  type TransportRoute,
  type TransportStop,
  type TransportTrip,
} from '@/lib/transport';
import { useTransportFavorites } from '@/lib/stores/transportFavoritesStore';

interface Props {
  visible: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// View state machine
// ---------------------------------------------------------------------------
type ScheduleView =
  | { kind: 'home' }
  | { kind: 'allRoutes' }
  | { kind: 'routeDirections'; routeId: string }
  | {
      kind: 'routeStops';
      routeId: string;
      tripId: string;
      showMap: boolean;
      alwaysShowLabels: boolean;
      highlightStopId?: string;
    }
  | {
      kind: 'stopDetail';
      stopId: string;
      // Which route/trip the user arrived from, if any (to keep context)
      routeId?: string;
      tripId?: string;
      serviceDay: ServiceDay;
    }
  | {
      kind: 'stopSchedule';
      stopId: string;
      routeId: string;
      tripId: string;
      serviceDay: ServiceDay;
      selectedDepartureMinute: number;
    }
  | { kind: 'stopArrivals'; stopId: string };

const DAY_TABS: { key: ServiceDay; label: string }[] = [
  { key: 'weekday', label: 'Рабочий день' },
  { key: 'saturday', label: 'Суббота' },
  { key: 'sunday', label: 'Воскресенье' },
];

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------
function RouteBadge({
  route,
  size = 'md',
}: {
  route: TransportRoute;
  size?: 'sm' | 'md';
}) {
  const color = route.color ?? vehicleColor(route.vehicle_kind, route.operator);
  const cls =
    size === 'sm'
      ? 'min-w-[40px] rounded-md px-1.5 py-0.5'
      : 'min-w-[56px] rounded-md px-2 py-1';
  return (
    <View
      className={cls}
      style={{ backgroundColor: color, alignItems: 'center' }}
    >
      <Text
        className={`font-bold text-white ${size === 'sm' ? 'text-xs' : 'text-sm'}`}
      >
        {route.short_name}
      </Text>
    </View>
  );
}

function VehicleIcon({ kind }: { kind: TransportRoute['vehicle_kind'] }) {
  if (kind === 'tram') return <Train size={18} color="#ea580c" />;
  return <Bus size={18} color="#10b981" />;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function TransportScheduleSheet({ visible, onClose }: Props) {
  const [view, setView] = useState<ScheduleView>({ kind: 'home' });

  // Reset whenever the sheet is re-opened
  useEffect(() => {
    if (visible) setView({ kind: 'home' });
  }, [visible]);

  const back = useCallback(() => {
    setView((v) => {
      switch (v.kind) {
        case 'home':
          return v;
        case 'allRoutes':
          return { kind: 'home' };
        case 'routeDirections':
          return { kind: 'allRoutes' };
        case 'routeStops':
          return { kind: 'routeDirections', routeId: v.routeId };
        case 'stopDetail':
          if (v.routeId && v.tripId)
            return {
              kind: 'routeStops',
              routeId: v.routeId,
              tripId: v.tripId,
              showMap: false,
              alwaysShowLabels: false,
              highlightStopId: v.stopId,
            };
          return { kind: 'home' };
        case 'stopSchedule':
          return {
            kind: 'stopDetail',
            stopId: v.stopId,
            routeId: v.routeId,
            tripId: v.tripId,
            serviceDay: v.serviceDay,
          };
        case 'stopArrivals':
          return { kind: 'home' };
      }
    });
  }, []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={{ flex: 1 }} className="bg-background">
        {/* Header */}
        <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <View className="flex-row items-center gap-2">
            {view.kind !== 'home' ? (
              <Pressable
                onPress={back}
                hitSlop={8}
                className="h-9 w-9 items-center justify-center rounded-full bg-muted"
              >
                <ArrowLeft size={18} color="#333" />
              </Pressable>
            ) : null}
            <View>
              <Text className="text-lg font-bold text-foreground">
                Расписание
              </Text>
              <Text className="text-xs text-muted-foreground">
                Tallinna Transport · Harjumaa
              </Text>
            </View>
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            className="h-9 w-9 items-center justify-center rounded-full bg-muted active:bg-muted/70"
          >
            <X size={18} color="#333" />
          </Pressable>
        </View>

        {/* View body */}
        <View style={{ flex: 1 }}>
          {view.kind === 'home' ? (
            <HomeView
              onOpenAllRoutes={() => setView({ kind: 'allRoutes' })}
              onPickRoute={(r) =>
                setView({ kind: 'routeDirections', routeId: r.id })
              }
              onPickStop={(s) => setView({ kind: 'stopArrivals', stopId: s.id })}
              onPickFavorite={(fav) =>
                setView({
                  kind: 'stopDetail',
                  stopId: fav.stopId,
                  routeId: fav.routeId,
                  tripId: fav.tripId,
                  serviceDay: serviceDayFor(new Date()),
                })
              }
            />
          ) : null}

          {view.kind === 'allRoutes' ? (
            <AllRoutesView
              onPick={(r) =>
                setView({ kind: 'routeDirections', routeId: r.id })
              }
            />
          ) : null}

          {view.kind === 'routeDirections' ? (
            <RouteDirectionsView
              routeId={view.routeId}
              onPick={(trip) =>
                setView({
                  kind: 'routeStops',
                  routeId: view.routeId,
                  tripId: trip.id,
                  showMap: false,
                  alwaysShowLabels: false,
                })
              }
            />
          ) : null}

          {view.kind === 'routeStops' ? (
            <RouteStopsView
              routeId={view.routeId}
              tripId={view.tripId}
              showMap={view.showMap}
              alwaysShowLabels={view.alwaysShowLabels}
              highlightStopId={view.highlightStopId}
              onToggleMap={() =>
                setView({ ...view, showMap: !view.showMap })
              }
              onToggleLabels={() =>
                setView({ ...view, alwaysShowLabels: !view.alwaysShowLabels })
              }
              onPickStop={(stop) =>
                setView({
                  kind: 'stopDetail',
                  stopId: stop.id,
                  routeId: view.routeId,
                  tripId: view.tripId,
                  serviceDay: serviceDayFor(new Date()),
                })
              }
            />
          ) : null}

          {view.kind === 'stopDetail' ? (
            <StopDetailView
              stopId={view.stopId}
              routeId={view.routeId}
              tripId={view.tripId}
              serviceDay={view.serviceDay}
              onChangeDay={(d) => setView({ ...view, serviceDay: d })}
              onPickDeparture={(minute) => {
                if (!view.routeId || !view.tripId) return;
                setView({
                  kind: 'stopSchedule',
                  stopId: view.stopId,
                  routeId: view.routeId,
                  tripId: view.tripId,
                  serviceDay: view.serviceDay,
                  selectedDepartureMinute: minute,
                });
              }}
            />
          ) : null}

          {view.kind === 'stopSchedule' ? (
            <StopScheduleView
              stopId={view.stopId}
              routeId={view.routeId}
              tripId={view.tripId}
              serviceDay={view.serviceDay}
              selectedArrivalMinute={view.selectedDepartureMinute}
              onPickOtherStop={(nextStopId) =>
                setView({
                  kind: 'stopDetail',
                  stopId: nextStopId,
                  routeId: view.routeId,
                  tripId: view.tripId,
                  serviceDay: view.serviceDay,
                })
              }
              onShiftTime={(delta) =>
                setView({
                  ...view,
                  selectedDepartureMinute:
                    view.selectedDepartureMinute + delta,
                })
              }
            />
          ) : null}

          {view.kind === 'stopArrivals' ? (
            <StopArrivalsView stopId={view.stopId} />
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Home view: search + list of all buses + favorites
// ---------------------------------------------------------------------------
function HomeView({
  onOpenAllRoutes,
  onPickRoute,
  onPickStop,
  onPickFavorite,
}: {
  onOpenAllRoutes: () => void;
  onPickRoute: (r: TransportRoute) => void;
  onPickStop: (s: TransportStop) => void;
  onPickFavorite: (f: {
    routeId: string;
    tripId: string;
    stopId: string;
  }) => void;
}) {
  const [q, setQ] = useState('');
  const [stopSuggestions, setStopSuggestions] = useState<TransportStop[]>([]);
  const [routeSuggestions, setRouteSuggestions] = useState<TransportRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const favorites = useTransportFavorites((s) => s.favorites);
  const removeFav = useTransportFavorites((s) => s.removeFavorite);

  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length === 0) {
      setStopSuggestions([]);
      setRouteSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const [stops, routes] = await Promise.all([
          searchStops(trimmed),
          searchRoutes(trimmed),
        ]);
        // eslint-disable-next-line no-console
        console.log(
          '[TransportScheduleSheet] search',
          JSON.stringify(trimmed),
          '→',
          stops.length,
          'stops,',
          routes.length,
          'routes',
        );
        setStopSuggestions(stops);
        setRouteSuggestions(routes);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[TransportScheduleSheet] search error', e);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const sortedFavorites = useMemo(
    () => [...favorites].sort((a, b) => b.addedAt - a.addedAt),
    [favorites],
  );

  return (
    <ScrollView
      className="flex-1"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 24 }}
    >
      {/* Search */}
      <View className="px-4 pt-3">
        <View className="flex-row items-center gap-2 rounded-xl bg-muted px-3">
          <Search size={16} color="#666" />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Номер маршрута или остановка"
            placeholderTextColor="#999"
            className="flex-1 py-3 text-base text-foreground"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {q.length > 0 ? (
            <Pressable onPress={() => setQ('')} hitSlop={6}>
              <X size={14} color="#888" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Search results */}
      {q.trim().length > 0 ? (
        <View className="mt-3">
          {loading ? (
            <View className="items-center py-4">
              <ActivityIndicator />
            </View>
          ) : null}
          {routeSuggestions.length > 0 ? (
            <>
              <Text className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Линии ({routeSuggestions.length})
              </Text>
              {routeSuggestions.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => onPickRoute(r)}
                  className="flex-row items-center gap-3 border-b border-border px-4 py-3 active:bg-muted/50"
                >
                  <VehicleIcon kind={r.vehicle_kind} />
                  <RouteBadge route={r} />
                  <Text
                    className="flex-1 text-sm text-foreground"
                    numberOfLines={1}
                  >
                    {r.long_name}
                  </Text>
                </Pressable>
              ))}
            </>
          ) : null}
          {stopSuggestions.length > 0 ? (
            <>
              <Text className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Остановки ({stopSuggestions.length})
              </Text>
              {stopSuggestions.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => onPickStop(s)}
                  className="flex-row items-center gap-3 border-b border-border px-4 py-3 active:bg-muted/50"
                >
                  <MapPin size={18} color="#2563eb" />
                  <View className="flex-1">
                    <Text
                      className="text-base font-medium text-foreground"
                      numberOfLines={1}
                    >
                      {s.name}
                    </Text>
                    {s.name_alt ? (
                      <Text
                        className="text-xs text-muted-foreground"
                        numberOfLines={1}
                      >
                        {s.name_alt}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </>
          ) : null}
          {!loading &&
          routeSuggestions.length === 0 &&
          stopSuggestions.length === 0 ? (
            <Text className="px-4 py-4 text-sm text-muted-foreground">
              Ничего не найдено
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* All routes button */}
      {q.trim().length === 0 ? (
        <>
          <View className="px-4 pt-4">
            <Pressable
              onPress={onOpenAllRoutes}
              className="flex-row items-center gap-3 rounded-2xl bg-muted px-4 py-4 active:bg-muted/70"
            >
              <ListIcon size={22} color="#2563eb" />
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">
                  Все маршруты
                </Text>
                <Text className="text-xs text-muted-foreground">
                  Автобус · Трамвай · Harjumaa
                </Text>
              </View>
              <ChevronRight size={18} color="#666" />
            </Pressable>
          </View>

          {/* Favorites */}
          <View className="mt-5 px-4">
            <View className="flex-row items-center gap-2 pb-2">
              <Star size={14} color="#f59e0b" />
              <Text className="text-sm font-semibold text-foreground">
                Недавно использованные
              </Text>
            </View>
            {sortedFavorites.length === 0 ? (
              <Text className="rounded-xl bg-muted px-3 py-3 text-xs text-muted-foreground">
                Нажмите на ⭐ у маршрута или остановки, чтобы сохранить для
                быстрого доступа.
              </Text>
            ) : null}
            {sortedFavorites.map((f) => (
              <Pressable
                key={f.id}
                onPress={() =>
                  onPickFavorite({
                    routeId: f.routeId,
                    tripId: f.tripId,
                    stopId: f.stopId,
                  })
                }
                className="mb-1 flex-row items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 active:bg-muted/50"
              >
                <Bus size={16} color="#2563eb" />
                <View className="flex-1">
                  <Text
                    className="text-sm font-semibold text-foreground"
                    numberOfLines={1}
                  >
                    {f.label}
                  </Text>
                  <Text
                    className="text-xs text-muted-foreground"
                    numberOfLines={1}
                  >
                    Остановка: {f.stopLabel}
                  </Text>
                </View>
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    removeFav(f.id);
                  }}
                  hitSlop={6}
                >
                  <X size={14} color="#888" />
                </Pressable>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// All routes view — grouped by authority + vehicle kind, ALL operators.
// ---------------------------------------------------------------------------
function AllRoutesView({ onPick }: { onPick: (r: TransportRoute) => void }) {
  const [routes, setRoutes] = useState<TransportRoute[] | null>(null);
  const [authority, setAuthority] = useState<string>('Tallinna TA');
  const [kind, setKind] = useState<'all' | 'bus' | 'tram' | 'night_bus'>('all');

  useEffect(() => {
    fetchAllRoutes()
      .then((r) => {
        // Temporary diagnostic — lets us confirm data reaches state.
        // eslint-disable-next-line no-console
        console.log(
          '[TransportScheduleSheet] fetchAllRoutes →',
          r.length,
          'routes; first 3:',
          r.slice(0, 3).map((x) => ({
            id: x.id,
            short_name: x.short_name,
            authority: x.authority_raw,
            kind: x.vehicle_kind,
          })),
        );
        setRoutes(r);
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[TransportScheduleSheet] fetchAllRoutes error', e);
        setRoutes([]);
      });
  }, []);

  // Compute list of authorities present in the dataset, sorted by count desc.
  const authoritiesOrdered = useMemo(() => {
    if (!routes) return [] as string[];
    const counts = new Map<string, number>();
    for (const r of routes) {
      const k = r.authority_raw ?? 'Прочее';
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    // Pin Tallinna TA + Harjumaa ÜTK first, then rest by count desc.
    const PINNED = ['Tallinna TA', 'Harjumaa ÜTK'];
    const rest = Array.from(counts.keys())
      .filter((k) => !PINNED.includes(k))
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
    return [...PINNED.filter((k) => counts.has(k)), ...rest];
  }, [routes]);

  // Auto-select first available authority once data loads (if current isn't present).
  useEffect(() => {
    if (authoritiesOrdered.length === 0) return;
    if (!authoritiesOrdered.includes(authority)) {
      setAuthority(authoritiesOrdered[0]);
    }
  }, [authoritiesOrdered, authority]);

  const filtered = useMemo(() => {
    if (!routes) return [];
    const list = routes.filter((r) => (r.authority_raw ?? 'Прочее') === authority);
    if (kind === 'all') return list;
    return list.filter((r) => r.vehicle_kind === kind);
  }, [routes, authority, kind]);

  // Show which vehicle kinds are actually available for the selected authority
  const availableKinds = useMemo(() => {
    if (!routes) return new Set<VehicleKindFilter>();
    const s = new Set<VehicleKindFilter>();
    for (const r of routes) {
      if ((r.authority_raw ?? 'Прочее') !== authority) continue;
      if (r.vehicle_kind === 'bus') s.add('bus');
      else if (r.vehicle_kind === 'tram') s.add('tram');
      else if (r.vehicle_kind === 'night_bus') s.add('night_bus');
    }
    return s;
  }, [routes, authority]);

  if (!routes) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1">
      {/* Authority chips (horizontally scrollable) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}
        className="border-b border-border"
      >
        {authoritiesOrdered.map((a) => {
          const active = authority === a;
          return (
            <Pressable
              key={a}
              onPress={() => {
                setAuthority(a);
                setKind('all');
              }}
              className={`rounded-full px-3 py-1.5 ${active ? 'bg-primary' : 'bg-muted'}`}
            >
              <Text
                className={`text-xs font-semibold ${active ? 'text-primary-foreground' : 'text-foreground'}`}
              >
                {authorityLabel(a)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Vehicle-kind sub-tabs — only show options actually present */}
      <View className="flex-row border-b border-border">
        {([
          { k: 'all' as const, l: 'Все' },
          { k: 'bus' as const, l: 'Автобус' },
          { k: 'tram' as const, l: 'Трамвай' },
          { k: 'night_bus' as const, l: 'Ночной' },
        ] as const)
          .filter((o) => o.k === 'all' || availableKinds.has(o.k))
          .map((o) => {
            const active = kind === o.k;
            return (
              <Pressable
                key={o.k}
                onPress={() => setKind(o.k)}
                className={`flex-1 items-center py-2.5 ${active ? 'border-b-2 border-primary' : ''}`}
              >
                <Text
                  className={`text-xs font-semibold ${active ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  {o.l}
                </Text>
              </Pressable>
            );
          })}
      </View>

      <View className="px-4 py-2">
        <Text className="text-xs text-muted-foreground">
          {filtered.length} маршрут
          {filtered.length % 10 === 1 && filtered.length % 100 !== 11 ? '' : filtered.length % 10 >= 2 && filtered.length % 10 <= 4 && (filtered.length % 100 < 10 || filtered.length % 100 >= 20) ? 'а' : 'ов'}
        </Text>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        initialNumToRender={30}
        windowSize={7}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onPick(item)}
            className="flex-row items-center gap-3 border-b border-border px-4 py-3 active:bg-muted/50"
          >
            <RouteBadge route={item} />
            <Text className="flex-1 text-sm text-foreground" numberOfLines={2}>
              {item.long_name || item.short_name}
            </Text>
            <ChevronRight size={16} color="#888" />
          </Pressable>
        )}
        ListEmptyComponent={
          <Text className="px-4 py-8 text-center text-sm text-muted-foreground">
            Нет маршрутов
          </Text>
        }
      />
    </View>
  );
}

type VehicleKindFilter = 'bus' | 'tram' | 'night_bus';

// ---------------------------------------------------------------------------
// Direction picker
// ---------------------------------------------------------------------------
function RouteDirectionsView({
  routeId,
  onPick,
}: {
  routeId: string;
  onPick: (trip: TransportTrip) => void;
}) {
  const [route, setRoute] = useState<TransportRoute | null>(null);
  const [trips, setTrips] = useState<TransportTrip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchRoute(routeId), fetchRouteTrips(routeId)])
      .then(([r, t]) => {
        setRoute(r);
        setTrips(t);
      })
      .catch(() => {
        setRoute(null);
        setTrips([]);
      })
      .finally(() => setLoading(false));
  }, [routeId]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  if (!route) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-center text-base text-muted-foreground">
          Маршрут не найден или данные временно недоступны
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1">
      <View className="flex-row items-center gap-3 border-b border-border bg-muted/30 px-4 py-3">
        <RouteBadge route={route} />
        <Text className="flex-1 text-sm font-medium text-foreground">
          {route.long_name}
        </Text>
      </View>
      <Text className="px-4 pb-2 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Выбор направления
      </Text>
      {trips.map((t) => (
        <Pressable
          key={t.id}
          onPress={() => onPick(t)}
          className="flex-row items-center gap-3 border-b border-border px-4 py-4 active:bg-muted/50"
        >
          <View className="h-9 w-9 items-center justify-center rounded-full bg-primary/10">
            <MapPin size={16} color="#2563eb" />
          </View>
          <View className="flex-1">
            <Text className="text-base font-semibold text-foreground">
              В сторону: {t.headsign}
            </Text>
            <Text className="text-xs text-muted-foreground">
              Направление {t.direction === 0 ? '→' : '←'}
            </Text>
          </View>
          <ChevronRight size={16} color="#888" />
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Route stops view — list OR map
// ---------------------------------------------------------------------------
function RouteStopsView({
  routeId,
  tripId,
  showMap,
  alwaysShowLabels,
  highlightStopId,
  onToggleMap,
  onToggleLabels,
  onPickStop,
}: {
  routeId: string;
  tripId: string;
  showMap: boolean;
  alwaysShowLabels: boolean;
  highlightStopId?: string;
  onToggleMap: () => void;
  onToggleLabels: () => void;
  onPickStop: (stop: TransportStop) => void;
}) {
  const [route, setRoute] = useState<TransportRoute | null>(null);
  const [trip, setTrip] = useState<TransportTrip | null>(null);
  const [stops, setStops] = useState<RouteStopListItem[]>([]);
  const [stopsLoading, setStopsLoading] = useState(true);
  const [mapStopArrivals, setMapStopArrivals] =
    useState<NextArrival[] | null>(null);
  const [mapSelectedStop, setMapSelectedStop] = useState<TransportStop | null>(
    null,
  );
  const [mapStopRoutes, setMapStopRoutes] = useState<TransportRoute[]>([]);

  useEffect(() => {
    setStopsLoading(true);
    Promise.all([
      fetchRoute(routeId),
      fetchRouteTrips(routeId),
      fetchTripStops(tripId),
    ])
      .then(([r, ts, sts]) => {
        setRoute(r);
        setTrip(ts.find((x) => x.id === tripId) ?? null);
        setStops(sts);
      })
      .catch(() => {
        setRoute(null);
        setTrip(null);
        setStops([]);
      })
      .finally(() => setStopsLoading(false));
  }, [routeId, tripId]);

  const handleStopMarkerPress = useCallback(
    async (stop: TransportStop) => {
      setMapSelectedStop(stop);
      setMapStopArrivals(null);
      setMapStopRoutes([]);
      try {
        const [arrivals, routes] = await Promise.all([
          fetchNextArrivals(stop.id, new Date(), 6),
          fetchRoutesAtStop(stop.id),
        ]);
        setMapStopArrivals(arrivals);
        setMapStopRoutes(routes);
      } catch {
        setMapStopArrivals([]);
      }
    },
    [],
  );

  const mapRegion = useMemo<MapRegion>(() => {
    if (stops.length === 0) {
      return {
        latitude: 59.437,
        longitude: 24.753,
        latitudeDelta: 0.1,
        longitudeDelta: 0.1,
      };
    }
    const lats = stops.map((s) => s.stop.latitude);
    const lons = stops.map((s) => s.stop.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.4),
      longitudeDelta: Math.max(0.02, (maxLon - minLon) * 1.4),
    };
  }, [stops]);

  const color =
    route?.color ??
    (route ? vehicleColor(route.vehicle_kind, route.operator) : '#2563eb');

  const markers = useMemo<MapMarker[]>(
    () =>
      stops.map((s) => {
        const isHighlighted =
          highlightStopId === s.stop.id ||
          mapSelectedStop?.id === s.stop.id;
        const showLabel = alwaysShowLabels || isHighlighted;
        const dotColor = isHighlighted ? '#ef4444' : color;
        const html = showLabel
          ? `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto">
               <div style="white-space:nowrap;background:#fff;border:1px solid #d1d5db;border-radius:6px;padding:2px 6px;font-size:11px;font-weight:600;color:#111;box-shadow:0 1px 3px rgba(0,0,0,0.2);margin-bottom:2px">${s.stop.name.replace(/[<>&]/g, '')}</div>
               <div style="width:14px;height:14px;border-radius:9999px;background:${dotColor};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.35)"></div>
             </div>`
          : `<div style="width:14px;height:14px;border-radius:9999px;background:${dotColor};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.35);pointer-events:auto"></div>`;
        return {
          id: s.stop.id,
          coordinate: {
            latitude: s.stop.latitude,
            longitude: s.stop.longitude,
          },
          badgeHtml: html,
        };
      }),
    [stops, color, alwaysShowLabels, highlightStopId, mapSelectedStop],
  );

  const polyline = useMemo<MapPolyline[]>(
    () =>
      stops.length < 2
        ? []
        : [
            {
              id: 'route',
              coordinates: stops.map((s) => ({
                latitude: s.stop.latitude,
                longitude: s.stop.longitude,
              })),
              strokeColor: color,
              strokeWidth: 4,
            },
          ],
    [stops, color],
  );

  if (stopsLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  if (!route || !trip) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-center text-base text-muted-foreground">
          Данные маршрута временно недоступны
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1">
      {/* Header row with badge + labels-toggle + map-toggle */}
      <View className="flex-row items-center gap-3 border-b border-border bg-muted/30 px-4 py-2.5">
        <RouteBadge route={route} />
        <View className="flex-1">
          <Text
            className="text-sm font-semibold text-foreground"
            numberOfLines={1}
          >
            {route.long_name}
          </Text>
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            В сторону: {trip.headsign}
          </Text>
        </View>
        {showMap ? (
          <Pressable
            onPress={onToggleLabels}
            hitSlop={6}
            className={`items-center justify-center rounded-lg border px-2 py-1 ${alwaysShowLabels ? 'border-primary bg-primary' : 'border-border bg-card'}`}
          >
            <Text
              className={`text-[10px] font-bold ${alwaysShowLabels ? 'text-primary-foreground' : 'text-foreground'}`}
            >
              A̲
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onToggleMap}
          hitSlop={6}
          className={`items-center justify-center rounded-lg border px-2 py-1.5 ${showMap ? 'border-primary bg-primary' : 'border-border bg-card'}`}
        >
          <MapPin
            size={14}
            color={showMap ? '#fff' : '#2563eb'}
          />
        </Pressable>
      </View>

      {showMap ? (
        <View style={{ flex: 1 }}>
          <MapView
            style={{ flex: 1 }}
            initialRegion={mapRegion}
            region={mapRegion}
            markers={markers}
            polylines={polyline}
            onMarkerPress={(m) => {
              const s = stops.find((x) => x.stop.id === m.id);
              if (s) handleStopMarkerPress(s.stop);
            }}
            onPress={() => setMapSelectedStop(null)}
          />
          {mapSelectedStop ? (
            <View
              className="absolute left-4 right-4 top-4 rounded-2xl bg-card p-3"
              style={{
                shadowColor: '#000',
                shadowOpacity: 0.2,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 3 },
                elevation: 6,
              }}
            >
              <View className="flex-row items-center">
                <View className="flex-1">
                  <Text
                    className="text-base font-bold text-foreground"
                    numberOfLines={1}
                  >
                    {mapSelectedStop.name}
                  </Text>
                  {mapSelectedStop.name_alt ? (
                    <Text
                      className="text-xs text-muted-foreground"
                      numberOfLines={1}
                    >
                      {mapSelectedStop.name_alt}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => setMapSelectedStop(null)}
                  hitSlop={6}
                  className="rounded-full bg-muted p-1"
                >
                  <X size={14} color="#333" />
                </Pressable>
              </View>
              {mapStopRoutes.length > 0 ? (
                <View className="mt-2 flex-row flex-wrap gap-1.5">
                  {mapStopRoutes.map((r) => (
                    <RouteBadge key={r.id} route={r} size="sm" />
                  ))}
                </View>
              ) : null}
              <Text className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Ближайшие прибытия
              </Text>
              {mapStopArrivals == null ? (
                <ActivityIndicator />
              ) : mapStopArrivals.length === 0 ? (
                <Text className="text-xs text-muted-foreground">Нет данных</Text>
              ) : (
                <View className="mt-1 flex-row flex-wrap gap-2">
                  {mapStopArrivals.map((a) => (
                    <View
                      key={`${a.route.id}-${a.trip.id}-${a.departureMinute}`}
                      className="flex-row items-center gap-1 rounded-lg border border-border bg-card px-2 py-1"
                    >
                      <RouteBadge route={a.route} size="sm" />
                      <Text className="text-xs font-semibold text-foreground">
                        {a.minutesUntil <= 0 ? 'сейчас' : `${a.minutesUntil} мин`}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={stops}
          keyExtractor={(s) => `${s.sequence}:${s.stop.id}`}
          renderItem={({ item }) => {
            const highlight = highlightStopId === item.stop.id;
            return (
              <Pressable
                onPress={() => onPickStop(item.stop)}
                className={`flex-row items-center gap-3 border-b border-border px-4 py-3 active:bg-muted/50 ${highlight ? 'bg-primary/10' : ''}`}
              >
                <View className="items-center">
                  <Text className="text-[10px] text-muted-foreground">
                    {item.offset_minutes}м
                  </Text>
                  <View
                    className="mt-0.5 h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                </View>
                <View className="flex-1">
                  <Text
                    className={`text-base ${highlight ? 'font-bold' : 'font-medium'} text-foreground`}
                    numberOfLines={1}
                  >
                    {item.stop.name}
                  </Text>
                  {item.stop.name_alt ? (
                    <Text
                      className="text-xs text-muted-foreground"
                      numberOfLines={1}
                    >
                      {item.stop.name_alt}
                    </Text>
                  ) : null}
                </View>
                <ChevronRight size={14} color="#888" />
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stop detail (next arrivals + schedule grid)
// ---------------------------------------------------------------------------
function StopDetailView({
  stopId,
  routeId,
  tripId,
  serviceDay,
  onChangeDay,
  onPickDeparture,
}: {
  stopId: string;
  routeId?: string;
  tripId?: string;
  serviceDay: ServiceDay;
  onChangeDay: (d: ServiceDay) => void;
  onPickDeparture: (arrivalMinute: number) => void;
}) {
  const [stop, setStop] = useState<TransportStop | null>(null);
  const [route, setRoute] = useState<TransportRoute | null>(null);
  const [, setTrip] = useState<TransportTrip | null>(null);
  const [nextArrivals, setNextArrivals] = useState<NextArrival[]>([]);
  const [scheduleByHour, setScheduleByHour] = useState<Map<number, number[]>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  const isFav = useTransportFavorites((s) => s.isFavorite);
  const addFav = useTransportFavorites((s) => s.addFavorite);
  const removeFav = useTransportFavorites((s) => s.removeFavorite);
  const favId = `${routeId}:${tripId}:${stopId}`;
  const favored = isFav(favId);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const s = await fetchStopById(stopId);
        setStop(s);
        if (routeId) setRoute(await fetchRoute(routeId));
        if (tripId) {
          const ts = await fetchRouteTrips(routeId ?? '');
          setTrip(ts.find((t) => t.id === tripId) ?? null);
        }
        const arr = await fetchNextArrivals(stopId, new Date(), 3);
        setNextArrivals(arr);
        if (tripId) {
          const all = await fetchStopDailyArrivals(stopId, tripId, serviceDay);
          setScheduleByHour(groupArrivalsByHour(all));
        } else {
          setScheduleByHour(new Map());
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [stopId, routeId, tripId, serviceDay]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  if (!stop) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-center text-base text-muted-foreground">
          Остановка не найдена или данные временно недоступны
        </Text>
      </View>
    );
  }

  const hourList = Array.from(scheduleByHour.keys()).sort((a, b) => a - b);

  return (
    <ScrollView className="flex-1">
      {/* Header strip like the reference: route badge · long name + stop name bold */}
      {route ? (
        <View className="flex-row items-center gap-3 border-b border-border bg-muted/30 px-4 py-2.5">
          <RouteBadge route={route} />
          <View className="flex-1">
            <Text
              className="text-xs text-muted-foreground"
              numberOfLines={1}
            >
              {route.long_name}
            </Text>
            <Text
              className="text-base font-bold text-foreground"
              numberOfLines={1}
            >
              {stop.name}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              if (favored) removeFav(favId);
              else if (routeId && tripId) {
                addFav({
                  id: favId,
                  routeId,
                  tripId,
                  stopId,
                  label: `${route.short_name} ${route.long_name}`,
                  stopLabel: stop.name,
                });
              }
            }}
            hitSlop={6}
          >
            <Star
              size={18}
              color={favored ? '#f59e0b' : '#bbb'}
              fill={favored ? '#f59e0b' : 'none'}
            />
          </Pressable>
        </View>
      ) : (
        <View className="border-b border-border bg-muted/30 px-4 py-3">
          <Text className="text-lg font-bold text-foreground">{stop.name}</Text>
          {stop.name_alt ? (
            <Text className="text-xs text-muted-foreground">
              {stop.name_alt}
            </Text>
          ) : null}
        </View>
      )}

      {/* Next departures chips */}
      {nextArrivals.length > 0 ? (
        <View className="px-4 py-3">
          <Text className="pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ближайшие прибытия
          </Text>
          <View className="flex-row flex-wrap items-center gap-2">
            {nextArrivals.map((a) => (
              <View
                key={`${a.route.id}-${a.trip.id}-${a.departureMinute}`}
                className="flex-row items-center gap-1.5"
              >
                <RouteBadge route={a.route} size="sm" />
                <Text className="text-sm font-bold text-foreground underline decoration-dashed">
                  {a.minutesUntil <= 0 ? 'сейчас' : `${a.minutesUntil} мин`}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Day tabs */}
      <View className="flex-row border-y border-border">
        {DAY_TABS.map((d) => {
          const active = serviceDay === d.key;
          return (
            <Pressable
              key={d.key}
              onPress={() => onChangeDay(d.key)}
              className={`flex-1 items-center py-3 ${active ? 'border-b-2 border-primary' : ''}`}
            >
              <Text
                className={`text-sm font-semibold ${active ? 'text-foreground' : 'text-muted-foreground'}`}
                numberOfLines={1}
              >
                {d.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Hour × minutes grid */}
      {tripId && hourList.length > 0 ? (
        <View className="pb-6">
          {hourList.map((h) => (
            <View
              key={h}
              className="flex-row items-start border-b border-border"
            >
              <View className="w-14 items-center py-3">
                <Text className="text-base font-bold text-foreground">{h}</Text>
              </View>
              <View className="flex-1 flex-row flex-wrap gap-2 py-2 pr-3">
                {(scheduleByHour.get(h) ?? []).map((m) => {
                  const abs = h * 60 + m;
                  return (
                    <Pressable
                      key={m}
                      onPress={() => onPickDeparture(abs)}
                      className="min-w-[42px] items-center rounded border border-blue-300/70 bg-blue-50 px-2 py-1 active:bg-blue-100 dark:bg-blue-500/10"
                    >
                      <Text className="text-sm text-blue-700 underline decoration-dashed dark:text-blue-300">
                        {m.toString().padStart(2, '0')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      ) : tripId ? (
        <Text className="p-6 text-center text-sm text-muted-foreground">
          Нет расписания
        </Text>
      ) : (
        <Text className="p-6 text-center text-sm text-muted-foreground">
          Выберите линию, чтобы увидеть расписание
        </Text>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Stop schedule — timeline of stops with selected departure time
// ---------------------------------------------------------------------------
function StopScheduleView({
  stopId,
  routeId,
  tripId,
  serviceDay: _serviceDay,
  selectedArrivalMinute,
  onPickOtherStop,
  onShiftTime,
}: {
  stopId: string;
  routeId: string;
  tripId: string;
  serviceDay: ServiceDay;
  selectedArrivalMinute: number;
  onPickOtherStop: (nextStopId: string) => void;
  onShiftTime: (delta: number) => void;
}) {
  const [route, setRoute] = useState<TransportRoute | null>(null);
  const [stops, setStops] = useState<RouteStopListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchRoute(routeId), fetchTripStops(tripId)])
      .then(([r, s]) => {
        setRoute(r);
        setStops(s);
      })
      .catch(() => {
        setRoute(null);
        setStops([]);
      })
      .finally(() => setLoading(false));
  }, [routeId, tripId]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  const selectedStop = stops.find((s) => s.stop.id === stopId);
  if (!route || !selectedStop) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-center text-base text-muted-foreground">
          Данные расписания временно недоступны
        </Text>
      </View>
    );
  }

  const tripStartMinute = selectedArrivalMinute - selectedStop.offset_minutes;

  return (
    <View style={{ flex: 1 }}>
      <View className="flex-row items-center gap-3 border-b border-border bg-muted/30 px-4 py-2.5">
        <RouteBadge route={route} />
        <View className="flex-1">
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {route.long_name}
          </Text>
          <Text className="text-base font-bold text-foreground" numberOfLines={1}>
            {selectedStop.stop.name}
          </Text>
        </View>
      </View>

      {/* Prev / Next time */}
      <View className="flex-row items-center border-b border-border bg-muted/20">
        <Pressable
          onPress={() => onShiftTime(-10)}
          className="flex-1 flex-row items-center justify-center gap-1 py-3 active:bg-muted/50"
        >
          <ChevronLeft size={16} color="#666" />
          <Text className="text-sm font-medium text-muted-foreground">
            Предыдущее время
          </Text>
        </Pressable>
        <View className="h-8 w-px bg-border" />
        <Pressable
          onPress={() => onShiftTime(10)}
          className="flex-1 flex-row items-center justify-center gap-1 py-3 active:bg-muted/50"
        >
          <Text className="text-sm font-medium text-muted-foreground">
            Следующее время
          </Text>
          <ChevronRight size={16} color="#666" />
        </Pressable>
      </View>

      {/* Stops with arrival times */}
      <FlatList
        data={stops}
        keyExtractor={(s) => `${s.sequence}:${s.stop.id}`}
        renderItem={({ item }) => {
          const active = item.stop.id === stopId;
          const arrivalMin = tripStartMinute + item.offset_minutes;
          return (
            <Pressable
              onPress={() => onPickOtherStop(item.stop.id)}
              className={`flex-row items-center justify-between gap-3 border-b border-border px-4 py-3 ${active ? 'bg-primary/10' : 'active:bg-muted/50'}`}
            >
              <Text
                className={`flex-1 text-base ${active ? 'font-bold' : ''} text-foreground`}
                numberOfLines={1}
              >
                {item.stop.name}
              </Text>
              <Text
                className={`text-base tabular-nums ${active ? 'font-bold' : ''} text-foreground`}
              >
                {minuteToHHMM(arrivalMin)}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stop arrivals — when user tapped on a stop from the search directly
// ---------------------------------------------------------------------------
function StopArrivalsView({ stopId }: { stopId: string }) {
  const [stop, setStop] = useState<TransportStop | null>(null);
  const [arrivals, setArrivals] = useState<NextArrival[] | null>(null);
  const [routes, setRoutes] = useState<TransportRoute[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchStopById(stopId).catch(() => null),
      fetchRoutesAtStop(stopId).catch(() => []),
      fetchNextArrivals(stopId, new Date(), 20).catch(() => []),
    ]).then(([s, r, a]) => {
      setStop(s);
      setRoutes(r as TransportRoute[]);
      setArrivals(a as NextArrival[]);
      setLoading(false);
    });
  }, [stopId]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  if (!stop) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-center text-base text-muted-foreground">
          Остановка не найдена или данные временно недоступны
        </Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1">
      <View className="border-b border-border bg-muted/30 px-4 py-3">
        <Text className="text-xl font-bold text-foreground">{stop.name}</Text>
        {stop.name_alt ? (
          <Text className="text-sm text-muted-foreground">{stop.name_alt}</Text>
        ) : null}
        {routes.length > 0 ? (
          <View className="mt-2 flex-row flex-wrap gap-1.5">
            {routes.map((r) => (
              <RouteBadge key={r.id} route={r} size="sm" />
            ))}
          </View>
        ) : null}
      </View>

      <Text className="px-4 pb-2 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Ближайшие прибытия
      </Text>
      {arrivals == null ? (
        <ActivityIndicator />
      ) : arrivals.length === 0 ? (
        <Text className="px-4 pb-4 text-sm text-muted-foreground">
          Нет данных на сейчас
        </Text>
      ) : (
        arrivals.map((a) => (
          <View
            key={`${a.route.id}-${a.trip.id}-${a.departureMinute}`}
            className="flex-row items-center gap-3 border-b border-border px-4 py-3"
          >
            <RouteBadge route={a.route} size="sm" />
            <View className="flex-1">
              <Text
                className="text-sm font-medium text-foreground"
                numberOfLines={1}
              >
                {a.route.long_name}
              </Text>
              <Text className="text-xs text-muted-foreground">
                В сторону: {a.trip.headsign}
              </Text>
            </View>
            <Text className="text-base font-bold text-foreground">
              {a.minutesUntil <= 0 ? 'сейчас' : `${a.minutesUntil} мин`}
            </Text>
          </View>
        ))
      )}

      <View className="px-4 pb-6 pt-4">
        <Text className="text-[11px] text-muted-foreground">
          Обновлено: {minuteToHHMM(minutesFromMidnight(new Date()))} ·{' '}
          {serviceDayFor(new Date()) === 'weekday'
            ? 'будний'
            : serviceDayFor(new Date()) === 'saturday'
              ? 'суббота'
              : 'воскресенье'}
        </Text>
        <Locate size={1} color="transparent" />
      </View>
    </ScrollView>
  );
}
