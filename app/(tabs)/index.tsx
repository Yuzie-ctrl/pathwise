import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Brush, Locate, Search } from 'lucide-react-native';

import MapView, {
  type MapMarker,
  type MapPolyline,
  type MapRegion,
} from '@/components/MapView';
import { DrawCanvas } from '@/components/DrawCanvas';
import { NavigationBar } from '@/components/NavigationBar';
import { RoutePlanner } from '@/components/RoutePlanner';
import { SearchSheet } from '@/components/SearchSheet';
import { Text } from '@/components/ui/text';
import {
  fetchRoute,
  matchDrawnRoute,
  midpointOfLine,
  type GeocodeResult,
} from '@/lib/routing';
import { useTripStore, type TransportMode } from '@/lib/stores/tripStore';

const STOP_COLORS: ('green' | 'red' | 'orange' | 'purple' | 'cyan' | 'blue')[] = [
  'green',
  'red',
  'orange',
  'purple',
  'cyan',
  'blue',
];

// Route line style per transport mode
const MODE_STYLE: Record<
  TransportMode,
  { color: string; dashed: boolean; width: number }
> = {
  driving: { color: '#2563eb', dashed: false, width: 5 },
  walking: { color: '#10b981', dashed: true, width: 4 },
  cycling: { color: '#f59e0b', dashed: false, width: 5 },
  transit: { color: '#8b5cf6', dashed: false, width: 5 },
};

const DEFAULT_REGION: MapRegion = {
  latitude: 55.751244,
  longitude: 37.618423, // Moscow — neutral starting view
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

export default function Home() {
  const stops = useTripStore((s) => s.stops);
  const mode = useTripStore((s) => s.mode);
  const legs = useTripStore((s) => s.legs);
  const setLegs = useTripStore((s) => s.setLegs);
  const setLoadingRoute = useTripStore((s) => s.setLoadingRoute);
  const addStop = useTripStore((s) => s.addStop);
  const setOriginToMyLocation = useTripStore((s) => s.setOriginToMyLocation);
  const setOriginToPlace = useTripStore((s) => s.setOriginToPlace);
  const clearStops = useTripStore((s) => s.clearStops);
  const navigating = useTripStore((s) => s.navigating);
  const setNavigating = useTripStore((s) => s.setNavigating);

  const [region, setRegion] = useState<MapRegion>(DEFAULT_REGION);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [plannerCollapsed, setPlannerCollapsed] = useState(false);
  const [searchMode, setSearchMode] = useState<null | 'destination' | 'origin'>(
    null,
  );
  const [locating, setLocating] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [drawProcessing, setDrawProcessing] = useState(false);

  const routeReqRef = useRef(0);

  const plannerVisible = stops.length >= 2;

  // ---------------------------------------------------------------------
  // Geolocation
  // ---------------------------------------------------------------------
  const locate = useCallback(async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Нет доступа', 'Разрешите доступ к геолокации в настройках');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };
      setUserLocation(coords);
      setRegion({
        ...coords,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      });
      // If origin is "myLocation" stub, refresh it with real coords
      if (stops.length > 0 && stops[0].originKind === 'myLocation') {
        setOriginToMyLocation(coords);
      }
    } catch {
      Alert.alert('Ошибка', 'Не удалось определить местоположение');
    } finally {
      setLocating(false);
    }
  }, [stops, setOriginToMyLocation]);

  // Best-effort initial locate
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Lowest,
          });
          const coords = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          };
          setUserLocation(coords);
          setRegion({
            ...coords,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          });
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  // ---------------------------------------------------------------------
  // Recompute route when stops or mode change
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (stops.length < 2) {
      setLegs([]);
      return;
    }
    // Origin with no coords yet? skip
    if (stops[0].latitude === 0 && stops[0].longitude === 0) {
      setLegs([]);
      return;
    }
    const reqId = ++routeReqRef.current;
    const controller = new AbortController();
    setLoadingRoute(true);
    fetchRoute(stops, mode, controller.signal)
      .then((newLegs) => {
        if (reqId !== routeReqRef.current) return;
        setLegs(newLegs);
      })
      .catch(() => {
        if (reqId !== routeReqRef.current) return;
        setLegs([]);
      })
      .finally(() => {
        if (reqId !== routeReqRef.current) return;
        setLoadingRoute(false);
      });
    return () => controller.abort();
  }, [stops, mode, setLegs, setLoadingRoute]);

  // ---------------------------------------------------------------------
  // Fit camera to stops when planner is visible
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (navigating) return;
    if (stops.length < 2) return;
    const valid = stops.filter((s) => s.latitude !== 0 || s.longitude !== 0);
    if (valid.length < 2) return;
    const lats = valid.map((s) => s.latitude);
    const lons = valid.map((s) => s.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const latDelta = Math.max(0.01, (maxLat - minLat) * 1.6);
    const lonDelta = Math.max(0.01, (maxLon - minLon) * 1.6);
    setRegion({
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: latDelta,
      longitudeDelta: lonDelta,
    });
  }, [stops, navigating]);

  // ---------------------------------------------------------------------
  // Derived map data
  // ---------------------------------------------------------------------
  const style = MODE_STYLE[mode];

  const polylines: MapPolyline[] = useMemo(() => {
    if (legs.length === 0) {
      if (stops.length >= 2) {
        return [
          {
            id: 'fallback',
            coordinates: stops.map((s) => ({
              latitude: s.latitude,
              longitude: s.longitude,
            })),
            strokeColor: style.color,
            strokeWidth: 3,
            lineDashPattern: [6, 4],
          },
        ];
      }
      return [];
    }
    return legs.map((leg, i) => ({
      id: `leg-${i}`,
      coordinates: leg.coordinates,
      strokeColor: style.color,
      strokeWidth: style.width,
      lineDashPattern: style.dashed ? [8, 6] : undefined,
    }));
  }, [legs, stops, style]);

  const markers: MapMarker[] = useMemo(() => {
    const out: MapMarker[] = [];
    // Stop pins (exclude origin when it's myLocation stub)
    stops.forEach((s, idx) => {
      if (idx === 0 && s.originKind === 'myLocation') return;
      if (s.latitude === 0 && s.longitude === 0) return;
      out.push({
        id: s.id,
        coordinate: { latitude: s.latitude, longitude: s.longitude },
        title: `${idx + 1}. ${s.label}`,
        description:
          !s.dwellMinutes || idx === stops.length - 1
            ? undefined
            : `Остановка ${s.dwellMinutes} мин`,
        color: STOP_COLORS[idx % STOP_COLORS.length],
      });
    });

    // Numbered leg badges at the midpoint of each leg
    legs.forEach((leg, i) => {
      const mid = midpointOfLine(leg.coordinates);
      if (!mid) return;
      out.push({
        id: `leg-badge-${i}`,
        coordinate: mid,
        badgeText: String(i + 1),
        badgeColor: style.color,
      });
    });

    if (userLocation) {
      out.push({
        id: 'user',
        coordinate: userLocation,
        title: 'Вы здесь',
        color: 'blue',
      });
    }
    return out;
  }, [stops, legs, userLocation, style]);

  // ---------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------
  const openDestinationSearch = () => setSearchMode('destination');
  const openOriginSearch = () => setSearchMode('origin');
  const closeSearch = () => setSearchMode(null);

  const handleSearchSelect = (r: GeocodeResult) => {
    if (searchMode === 'origin') {
      setOriginToPlace({
        label: r.shortName,
        latitude: r.latitude,
        longitude: r.longitude,
      });
      setSearchMode(null);
      return;
    }
    // Destination flow: ensure origin exists (as myLocation) first
    if (stops.length === 0) {
      if (userLocation) {
        setOriginToMyLocation(userLocation);
      } else {
        // Origin placeholder — user can tap "Моё местоположение" later to refresh
        setOriginToMyLocation({ latitude: 0, longitude: 0 });
      }
    }
    addStop({
      label: r.shortName,
      latitude: r.latitude,
      longitude: r.longitude,
    });
    setSearchMode(null);
    setPlannerCollapsed(false);
  };

  const handleClosePlanner = () => {
    clearStops();
  };

  const handleStartTrip = () => {
    if (stops.length < 2) return;
    // Require a real origin
    if (stops[0].latitude === 0 && stops[0].longitude === 0) {
      if (userLocation) {
        setOriginToMyLocation(userLocation);
      } else {
        Alert.alert('Нет точки отправления', 'Включите геолокацию или выберите точку вручную');
        return;
      }
    }
    setNavigating(true);
    setPlannerCollapsed(true);
  };

  const handleStopTrip = () => {
    setNavigating(false);
  };

  const handleConfirmDrawing = async (
    coords: { latitude: number; longitude: number }[],
  ) => {
    setDrawProcessing(true);
    try {
      const matched = await matchDrawnRoute(coords, mode);
      // Turn matched path into 3 stops: start, midpoint, end — so the
      // planner/UI can treat it as a multi-stop route. We also keep the
      // polyline itself as a single leg so the rendered line follows
      // exactly what was matched.
      if (matched.length < 2) {
        Alert.alert('Не удалось', 'Не получилось распознать маршрут');
        return;
      }
      clearStops();
      const first = matched[0];
      const last = matched[matched.length - 1];
      // Origin = first point (as "place", since user drew from scratch)
      setOriginToPlace({
        label: 'Начало маршрута',
        latitude: first.latitude,
        longitude: first.longitude,
      });
      addStop({
        label: 'Конец маршрута',
        latitude: last.latitude,
        longitude: last.longitude,
      });
      setDrawing(false);
      setPlannerCollapsed(false);
    } catch {
      Alert.alert('Ошибка', 'Не удалось построить маршрут по рисунку');
    } finally {
      setDrawProcessing(false);
    }
  };

  const handleUserLocationUpdate = useCallback(
    (coord: { latitude: number; longitude: number }) => {
      setUserLocation(coord);
      if (navigating) {
        setRegion({
          latitude: coord.latitude,
          longitude: coord.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
      }
    },
    [navigating],
  );

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  return (
    <View style={{ flex: 1 }} className="bg-background">
      <MapView
        style={{ flex: 1 }}
        region={region}
        onRegionChangeComplete={setRegion}
        markers={markers}
        polylines={polylines}
        showsUserLocation
        mapType="standard"
      />

      {/* Top search bar — hidden while drawing/navigating */}
      {!drawing && !navigating ? (
        <SafeAreaView edges={['top']} style={{ position: 'absolute', left: 0, right: 0, top: 0 }}>
          <View className="px-4 pt-2">
            <Pressable
              onPress={openDestinationSearch}
              className="flex-row items-center gap-3 rounded-2xl bg-card px-4 py-3"
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.12,
                shadowRadius: 8,
                elevation: 6,
              }}
            >
              <Search size={18} color="#666" />
              <Text className="flex-1 text-base text-muted-foreground">
                Куда едем?
              </Text>
              <View className="rounded-full bg-primary/10 px-2 py-1">
                <Text className="text-xs font-semibold text-primary">Rido</Text>
              </View>
            </Pressable>
          </View>
        </SafeAreaView>
      ) : null}

      {/* Navigation bar (while in trip mode) */}
      {navigating ? (
        <NavigationBar
          onExit={handleStopTrip}
          onUserLocation={handleUserLocationUpdate}
        />
      ) : null}

      {/* Floating controls (right side) — always visible when not drawing */}
      {!drawing ? (
        <View
          className="absolute right-4"
          style={{
            bottom: plannerVisible && !plannerCollapsed ? 360 : 40,
          }}
          pointerEvents="box-none"
        >
          {!navigating ? (
            <Pressable
              onPress={() => setDrawing(true)}
              className="mb-3 h-12 w-12 items-center justify-center rounded-full bg-card"
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.18,
                shadowRadius: 6,
                elevation: 6,
              }}
            >
              <Brush size={20} color="#2563eb" />
            </Pressable>
          ) : null}
          <Pressable
            onPress={locate}
            className="h-12 w-12 items-center justify-center rounded-full bg-card"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.18,
              shadowRadius: 6,
              elevation: 6,
            }}
          >
            {locating ? (
              <ActivityIndicator size="small" />
            ) : (
              <Locate size={22} color="#2563eb" />
            )}
          </Pressable>
        </View>
      ) : null}

      {/* Planner bottom sheet (only when there's a destination and not navigating) */}
      {plannerVisible && !navigating ? (
        <RoutePlanner
          collapsed={plannerCollapsed}
          onToggleCollapsed={() => setPlannerCollapsed((v) => !v)}
          onClose={handleClosePlanner}
          onStartTrip={handleStartTrip}
          onChangeOrigin={openOriginSearch}
        />
      ) : null}

      {/* Drawing canvas */}
      {drawing ? (
        <DrawCanvas
          region={region}
          onCancel={() => setDrawing(false)}
          onConfirm={handleConfirmDrawing}
          processing={drawProcessing}
        />
      ) : null}

      {/* Global search sheet */}
      {searchMode !== null ? (
        <View className="absolute inset-0 z-50">
          <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <SearchSheet
              placeholder={
                searchMode === 'origin' ? 'Откуда' : 'Куда едем?'
              }
              onSelect={handleSearchSelect}
              onClose={closeSearch}
            />
          </SafeAreaView>
        </View>
      ) : null}
    </View>
  );
}
