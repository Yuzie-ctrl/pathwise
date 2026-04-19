import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import * as Location from 'expo-location';
import { ArrowLeft, MapPin, Navigation2, X } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import {
  formatDistance,
  formatDuration,
  haversine,
} from '@/lib/routing';
import {
  totalDistanceMeters,
  totalDwellMinutes,
  totalTravelSeconds,
  useTripStore,
} from '@/lib/stores/tripStore';

interface NavigationBarProps {
  /** Go back to the planner (keeps stops/legs). */
  onBack: () => void;
  /** Fully exit and reset the trip. */
  onExit: () => void;
  onUserLocation: (coord: { latitude: number; longitude: number }) => void;
}

/**
 * Minimal turn-by-turn-style status bar shown while the user is "on the way".
 * We don't run full turn-by-turn (requires a rich routing response) but we
 * show next-stop distance, elapsed progress along the current leg, and
 * overall ETA — enough to feel like Google Maps during navigation.
 */
export function NavigationBar({ onBack, onExit, onUserLocation }: NavigationBarProps) {
  const stops = useTripStore((s) => s.stops);
  const legs = useTripStore((s) => s.legs);

  const [position, setPosition] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Нет доступа к геолокации', 'Разрешите в настройках');
        onExit();
        return;
      }
      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 5,
          timeInterval: 2000,
        },
        (loc) => {
          const coord = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          };
          setPosition(coord);
          onUserLocation(coord);
        },
      );
    })();
    return () => {
      sub?.remove();
    };
  }, [onExit, onUserLocation]);

  const nextStopIdx = useMemo(() => {
    if (!position || stops.length < 2) return 1;
    // Find the nearest upcoming stop beyond origin
    let best = 1;
    let bestDist = Infinity;
    for (let i = 1; i < stops.length; i++) {
      const d = haversine(position, {
        latitude: stops[i].latitude,
        longitude: stops[i].longitude,
      });
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }, [position, stops]);

  const nextStop = stops[nextStopIdx];
  const distanceToNext = useMemo(() => {
    if (!position || !nextStop) return null;
    return haversine(position, {
      latitude: nextStop.latitude,
      longitude: nextStop.longitude,
    });
  }, [position, nextStop]);

  const travelSeconds = totalTravelSeconds(legs);
  const dwellMinutes = totalDwellMinutes(stops);
  const totalSeconds = travelSeconds + dwellMinutes * 60;
  const totalDistance = totalDistanceMeters(legs);

  return (
    <View
      className="absolute inset-x-0 top-0 z-40 bg-primary"
      style={{
        paddingTop: 40,
        paddingBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 8,
      }}
    >
      <View className="flex-row items-center gap-3 px-4">
        <Pressable
          onPress={onBack}
          hitSlop={10}
          className="h-10 w-10 items-center justify-center rounded-full bg-primary-foreground/20 active:bg-primary-foreground/30"
        >
          <ArrowLeft size={20} color="#fff" />
        </Pressable>
        <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-foreground/20">
          <Navigation2 size={20} color="#fff" />
        </View>
        <View className="flex-1">
          <Text className="text-xs text-primary-foreground/80">Следующая точка</Text>
          <Text
            className="text-base font-semibold text-primary-foreground"
            numberOfLines={1}
          >
            {nextStop?.label ?? '—'}
          </Text>
          <View className="mt-0.5 flex-row gap-3">
            {distanceToNext != null ? (
              <Text className="text-xs text-primary-foreground/90">
                {formatDistance(distanceToNext)} до точки
              </Text>
            ) : null}
            <Text className="text-xs text-primary-foreground/80">
              всего {formatDuration(totalSeconds)} · {formatDistance(totalDistance)}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={onExit}
          hitSlop={10}
          className="h-10 w-10 items-center justify-center rounded-full bg-primary-foreground/20 active:bg-primary-foreground/30"
        >
          <X size={20} color="#fff" />
        </Pressable>
      </View>

      {/* Small step-indicator chips for each remaining stop */}
      <View className="mt-3 flex-row flex-wrap gap-2 px-4">
        {stops.slice(1).map((s, i) => {
          const idx = i + 1;
          const isNext = idx === nextStopIdx;
          return (
            <View
              key={s.id}
              className={`flex-row items-center gap-1 rounded-full px-2 py-1 ${
                isNext ? 'bg-primary-foreground' : 'bg-primary-foreground/20'
              }`}
            >
              <MapPin size={11} color={isNext ? '#2563eb' : '#fff'} />
              <Text
                className={`text-[11px] font-medium ${
                  isNext ? 'text-primary' : 'text-primary-foreground'
                }`}
                numberOfLines={1}
              >
                {idx}. {s.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
