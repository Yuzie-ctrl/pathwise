import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Locate, Navigation, Search } from 'lucide-react-native';

import MapView, {
  type MapMarker,
  type MapPolyline,
  type MapRegion,
} from '@/components/MapView';
import { RoutePlanner } from '@/components/RoutePlanner';
import { SearchSheet } from '@/components/SearchSheet';
import { Text } from '@/components/ui/text';
import { fetchRoute, type GeocodeResult } from '@/lib/routing';
import { useTripStore } from '@/lib/stores/tripStore';

const STOP_COLORS: ('green' | 'red' | 'orange' | 'purple' | 'cyan' | 'blue')[] = [
  'green',
  'red',
  'orange',
  'purple',
  'cyan',
  'blue',
];

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

  const [region, setRegion] = useState<MapRegion>(DEFAULT_REGION);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [plannerExpanded, setPlannerExpanded] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [locating, setLocating] = useState(false);

  const routeReqRef = useRef(0);

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
    } catch {
      Alert.alert('Ошибка', 'Не удалось определить местоположение');
    } finally {
      setLocating(false);
    }
  }, []);

  // Try to locate once on mount (best-effort, no prompt spam on web)
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
  // Fit camera to stops
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (stops.length === 0) return;
    if (stops.length === 1) {
      setRegion({
        latitude: stops[0].latitude,
        longitude: stops[0].longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      });
      return;
    }
    const lats = stops.map((s) => s.latitude);
    const lons = stops.map((s) => s.longitude);
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
  }, [stops]);

  // ---------------------------------------------------------------------
  // Derived map data
  // ---------------------------------------------------------------------
  const markers: MapMarker[] = useMemo(() => {
    const stopMarkers: MapMarker[] = stops.map((s, idx) => ({
      id: s.id,
      coordinate: { latitude: s.latitude, longitude: s.longitude },
      title: `${idx + 1}. ${s.label}`,
      description:
        !s.dwellMinutes || idx === stops.length - 1
          ? undefined
          : `Остановка ${s.dwellMinutes} мин`,
      color: STOP_COLORS[idx % STOP_COLORS.length],
    }));
    if (userLocation) {
      stopMarkers.push({
        id: 'user',
        coordinate: userLocation,
        title: 'Вы здесь',
        color: 'blue',
      });
    }
    return stopMarkers;
  }, [stops, userLocation]);

  const polylines: MapPolyline[] = useMemo(() => {
    if (legs.length === 0) {
      // Fallback: straight-line polyline between stops so user sees a connection while routing
      if (stops.length >= 2) {
        return [
          {
            id: 'fallback',
            coordinates: stops.map((s) => ({
              latitude: s.latitude,
              longitude: s.longitude,
            })),
            strokeColor: '#2563eb',
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
      strokeColor: '#2563eb',
      strokeWidth: 4,
    }));
  }, [legs, stops]);

  // ---------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------
  const handleStartPlanning = () => {
    setPlannerOpen(true);
    setPlannerExpanded(true);
  };

  const handleSearchSelect = (r: GeocodeResult) => {
    addStop({
      label: r.shortName,
      latitude: r.latitude,
      longitude: r.longitude,
    });
    setSearchOpen(false);
    setPlannerOpen(true);
    setPlannerExpanded(true);
  };

  const handleClosePlanner = () => {
    setPlannerOpen(false);
  };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <View className="flex-1 bg-background">
        <MapView
          style={{ flex: 1 }}
          region={region}
          onRegionChangeComplete={setRegion}
          markers={markers}
          polylines={polylines}
          showsUserLocation
          mapType="standard"
        />

        {/* Top search bar */}
        {!plannerOpen ? (
          <View className="absolute inset-x-0 top-0 px-4 pt-2">
            <Pressable
              onPress={() => setSearchOpen(true)}
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
              <View className="flex-row items-center gap-1 rounded-full bg-primary/10 px-2 py-1">
                <Text className="text-xs font-semibold text-primary">Rido</Text>
              </View>
            </Pressable>
          </View>
        ) : null}

        {/* Floating controls (right side) */}
        <View className="absolute right-4" style={{ bottom: plannerOpen ? 340 : 120 }}>
          <Pressable
            onPress={locate}
            className="mb-3 h-12 w-12 items-center justify-center rounded-full bg-card"
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

        {/* Bottom CTA — build route */}
        {!plannerOpen ? (
          <View className="absolute inset-x-0 bottom-0 px-4 pb-6">
            <Pressable
              onPress={handleStartPlanning}
              className="flex-row items-center justify-center gap-2 rounded-2xl bg-primary py-4"
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.18,
                shadowRadius: 10,
                elevation: 8,
              }}
            >
              <Navigation size={18} color={Platform.OS === 'ios' ? '#fff' : '#fff'} />
              <Text className="text-base font-semibold text-primary-foreground">
                Построить маршрут
              </Text>
            </Pressable>
            <View className="mt-2">
              <Text className="text-center text-xs text-muted-foreground">
                Остановки • время пребывания • ETA
              </Text>
            </View>
          </View>
        ) : null}

        {/* Planner bottom sheet */}
        {plannerOpen ? (
          <RoutePlanner
            expanded={plannerExpanded}
            onToggleExpanded={() => setPlannerExpanded((v) => !v)}
            onClose={handleClosePlanner}
          />
        ) : null}

        {/* Global search sheet (when launched from top bar) */}
        {searchOpen ? (
          <View className="absolute inset-0 z-50">
            <SafeAreaView style={{ flex: 1 }}>
              <SearchSheet
                placeholder="Куда едем?"
                onSelect={handleSearchSelect}
                onClose={() => setSearchOpen(false)}
              />
            </SafeAreaView>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
