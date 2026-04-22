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
import { TransitPlanner } from '@/components/TransitPlanner';
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
  const drawnRoutes = useTripStore((s) => s.drawnRoutes);
  const addDrawnRoute = useTripStore((s) => s.addDrawnRoute);
  const setDrawnRoutes = useTripStore((s) => s.setDrawnRoutes);

  const [region, setRegion] = useState<MapRegion>(DEFAULT_REGION);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [plannerCollapsed, setPlannerCollapsed] = useState(false);
  const [searchMode, setSearchMode] = useState<null | 'destination' | 'origin' | 'stop'>(
    null,
  );
  const [locating, setLocating] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [drawProcessing, setDrawProcessing] = useState(false);
  /** When non-null, the current drawing session is for a partial override
   *  targeting the leg ending at this stop id (pre+draw+post get stitched). */
  const [drawTargetStopId, setDrawTargetStopId] = useState<string | null>(null);

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
    if (stops[0].latitude === 0 && stops[0].longitude === 0) {
      setLegs([]);
      return;
    }
    const reqId = ++routeReqRef.current;
    const controller = new AbortController();
    setLoadingRoute(true);
    fetchRoute(stops, mode, controller.signal, drawnRoutes)
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
  }, [stops, mode, setLegs, setLoadingRoute, drawnRoutes]);

  // ---------------------------------------------------------------------
  // Fit camera to stops when planner is visible
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (navigating) return;
    if (stops.length < 2) return;
    // When any drawn override exists, don't auto-fit — the user just drew
    // it and any camera change would visually reflow/shift the view.
    if (drawnRoutes.length > 0) return;
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
  }, [stops, navigating, drawnRoutes]);

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
    return legs.map((leg, i) => {
      const legStyle = MODE_STYLE[leg.mode ?? mode];
      return {
        id: `leg-${i}`,
        coordinates: leg.coordinates,
        strokeColor: legStyle.color,
        strokeWidth: legStyle.width,
        lineDashPattern: legStyle.dashed ? [8, 6] : undefined,
      };
    });
  }, [legs, stops, style, mode]);

  const markers: MapMarker[] = useMemo(() => {
    const out: MapMarker[] = [];
    // Stop pins (exclude origin when it's myLocation stub)
    stops.forEach((s, idx) => {
      if (idx === 0 && s.originKind === 'myLocation') return;
      if (s.latitude === 0 && s.longitude === 0) return;
      out.push({
        id: s.id,
        coordinate: { latitude: s.latitude, longitude: s.longitude },
        // No title/description — we don't want white label pills on the map.
        color: STOP_COLORS[idx % STOP_COLORS.length],
      });
    });

    // Numbered segment badges — place at midpoint of each logical segment
    // (all legs with the same segmentIndex are combined, so partial-draw
    // segments don't get 3 badges).
    const segments = new Map<number, { latitude: number; longitude: number }[]>();
    legs.forEach((leg, i) => {
      const segIdx = leg.segmentIndex ?? i;
      const list = segments.get(segIdx) ?? [];
      list.push(...leg.coordinates);
      segments.set(segIdx, list);
    });
    segments.forEach((coords, segIdx) => {
      const mid = midpointOfLine(coords);
      if (!mid) return;
      out.push({
        id: `leg-badge-${segIdx}`,
        coordinate: mid,
        badgeText: String(segIdx + 1),
        badgeColor: style.color,
      });
    });

    // Dwell badges next to each stop that has a non-zero dwell (skip last)
    stops.forEach((s, idx) => {
      if (idx === 0) return;
      if (idx === stops.length - 1) return;
      if (s.dwellMinutes <= 0) return;
      if (s.latitude === 0 && s.longitude === 0) return;
      out.push({
        id: `dwell-${s.id}`,
        coordinate: { latitude: s.latitude, longitude: s.longitude },
        badgeText: `⏸ ${s.dwellMinutes}м`,
        badgeColor: '#f59e0b',
      });
    });

    if (userLocation) {
      out.push({
        id: 'user',
        coordinate: userLocation,
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
  const openStopSearch = () => setSearchMode('stop');
  const closeSearch = () => setSearchMode(null);

  const ensureOriginFromUser = useCallback(() => {
    if (stops.length > 0) return;
    if (userLocation) {
      setOriginToMyLocation(userLocation);
    } else {
      setOriginToMyLocation({ latitude: 0, longitude: 0 });
    }
  }, [stops.length, userLocation, setOriginToMyLocation]);

  const handleSearchSelect = (r: GeocodeResult) => {
    if (searchMode === 'origin') {
      setOriginToPlace({
        label: r.shortName,
        displayName: r.displayName,
        latitude: r.latitude,
        longitude: r.longitude,
      });
      setSearchMode(null);
      return;
    }
    if (searchMode === 'stop') {
      addStop({
        label: r.shortName,
        displayName: r.displayName,
        latitude: r.latitude,
        longitude: r.longitude,
      });
      setSearchMode(null);
      return;
    }
    // Destination flow: ensure origin exists (as myLocation) first
    ensureOriginFromUser();
    addStop({
      label: r.shortName,
      displayName: r.displayName,
      latitude: r.latitude,
      longitude: r.longitude,
    });
    setSearchMode(null);
    setPlannerCollapsed(false);
  };

  const handlePickMyLocation = () => {
    // Available in origin/destination contexts as a quick action.
    if (searchMode === 'origin') {
      if (userLocation) setOriginToMyLocation(userLocation);
      else setOriginToMyLocation({ latitude: 0, longitude: 0 });
      setSearchMode(null);
      return;
    }
    // Destination or stop: treat it as the current point — only useful as origin,
    // but if user chose it, make sure origin is current-location and don't add
    // a duplicate stop.
    if (searchMode === 'destination' || searchMode === 'stop') {
      if (userLocation) setOriginToMyLocation(userLocation);
      setSearchMode(null);
    }
  };

  const handlePickDraw = () => {
    setSearchMode(null);
    setDrawing(true);
  };

  const handleClosePlanner = () => {
    // Full reset: remove all stops, legs, and navigation state.
    clearStops();
    setNavigating(false);
    setPlannerCollapsed(false);
  };

  const handleStartTrip = () => {
    if (stops.length < 2) return;
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
    // Stop trip only — keep stops so user can resume from planner.
    setNavigating(false);
    setPlannerCollapsed(false);
  };

  const handleExitTripAndReset = () => {
    setNavigating(false);
    clearStops();
    setPlannerCollapsed(false);
  };

  const handleConfirmDrawing = async (
    coords: { latitude: number; longitude: number }[],
  ) => {
    setDrawProcessing(true);
    try {
      const matched = await matchDrawnRoute(coords, mode);
      if (matched.coordinates.length < 2) {
        Alert.alert('Не удалось', 'Не получилось распознать маршрут');
        return;
      }

      // Case A — drawing for a specific destination stop (partial route)
      if (drawTargetStopId) {
        const currentStops = useTripStore.getState().stops;
        const toIdx = currentStops.findIndex((s) => s.id === drawTargetStopId);
        if (toIdx <= 0) {
          setDrawTargetStopId(null);
          setDrawing(false);
          return;
        }
        const fromStop = currentStops[toIdx - 1];
        const toStop = currentStops[toIdx];
        addDrawnRoute({
          fromStopId: fromStop.id,
          toStopId: toStop.id,
          coordinates: matched.coordinates,
          distanceMeters: matched.distanceMeters,
          durationSeconds: matched.durationSeconds,
          partial: true,
        });
        setDrawTargetStopId(null);
        setDrawing(false);
        setPlannerCollapsed(false);
        return;
      }

      // Case B — fresh drawn trip (2 stops, full override)
      const first = matched.coordinates[0];
      const last = matched.coordinates[matched.coordinates.length - 1];
      clearStops();
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
      const newStops = useTripStore.getState().stops;
      if (newStops.length >= 2) {
        setDrawnRoutes([
          {
            fromStopId: newStops[0].id,
            toStopId: newStops[1].id,
            coordinates: matched.coordinates,
            distanceMeters: matched.distanceMeters,
            durationSeconds: matched.durationSeconds,
          },
        ]);
      }
      setDrawing(false);
      setPlannerCollapsed(true);
    } catch {
      Alert.alert('Ошибка', 'Не удалось построить маршрут по рисунку');
    } finally {
      setDrawProcessing(false);
    }
  };

  const handleDrawForStop = useCallback((stopId: string) => {
    setDrawTargetStopId(stopId);
    setDrawing(true);
  }, []);

  const handleCancelDrawing = () => {
    setDrawing(false);
    setDrawTargetStopId(null);
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
  // Hide top "Куда едем?" bar once user has picked at least one destination
  // (i.e. a trip is being planned).
  const showTopSearchBar = !drawing && !navigating && stops.length === 0;
  // Brush is only available when no trip is being planned yet OR planner is expanded.
  const showBrush =
    !drawing && !navigating && (stops.length === 0 || !plannerCollapsed);

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

      {/* Top search bar — only when no trip is being planned */}
      {showTopSearchBar ? (
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
          onBack={handleStopTrip}
          onExit={handleExitTripAndReset}
          onUserLocation={handleUserLocationUpdate}
        />
      ) : null}

      {/* Floating controls (right side) */}
      {!drawing ? (
        <View
          className="absolute right-4"
          style={{
            bottom:
              plannerVisible && !plannerCollapsed
                ? 360
                : plannerVisible && plannerCollapsed
                  ? 120
                  : 40,
          }}
          pointerEvents="box-none"
        >
          {showBrush ? (
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
          {!navigating ? (
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
          ) : null}
        </View>
      ) : null}

      {/* Planner bottom sheet (non-transit modes) */}
      {plannerVisible && !navigating && mode !== 'transit' ? (
        <RoutePlanner
          collapsed={plannerCollapsed}
          onToggleCollapsed={() => setPlannerCollapsed((v) => !v)}
          onClose={handleClosePlanner}
          onStartTrip={handleStartTrip}
          onChangeOrigin={openOriginSearch}
          onAddStop={openStopSearch}
          onDrawForStop={handleDrawForStop}
        />
      ) : null}

      {/* Transit full-screen planner */}
      {plannerVisible && !navigating && mode === 'transit' ? (
        <TransitPlanner
          onClose={handleClosePlanner}
          onAddStop={openStopSearch}
          onChangeOrigin={openOriginSearch}
          onDrawForStop={handleDrawForStop}
        />
      ) : null}

      {/* Drawing canvas */}
      {drawing ? (
        <DrawCanvas
          region={region}
          onRegionChange={setRegion}
          onCancel={handleCancelDrawing}
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
                searchMode === 'origin'
                  ? 'Откуда'
                  : searchMode === 'stop'
                    ? 'Добавить остановку'
                    : 'Куда едем?'
              }
              onSelect={handleSearchSelect}
              onClose={closeSearch}
              onPickMyLocation={
                userLocation || searchMode !== 'origin' ? handlePickMyLocation : undefined
              }
              onPickDraw={handlePickDraw}
            />
          </SafeAreaView>
        </View>
      ) : null}
    </View>
  );
}
