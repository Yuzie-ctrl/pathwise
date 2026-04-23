import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type TransportMode = 'walking' | 'driving' | 'cycling' | 'transit';

export type OriginKind = 'myLocation' | 'place';

export interface TripStop {
  id: string;
  label: string;
  /** Full human-readable address (e.g. Nominatim display_name). Optional. */
  displayName?: string;
  latitude: number;
  longitude: number;
  /** Dwell time at this stop in minutes */
  dwellMinutes: number;
  /** First stop may represent "My location" (dynamic) or a custom place */
  originKind?: OriginKind;
}

export interface RouteLeg {
  distanceMeters: number;
  durationSeconds: number;
  coordinates: { latitude: number; longitude: number }[];
  /**
   * Transport sub-mode for this leg. Used for per-segment styling
   * (e.g. walking = green dashed, bus = purple solid).
   * Defaults to the trip's global mode when absent.
   */
  mode?: TransportMode;
  /** Index of the logical stop-to-stop segment this leg belongs to. */
  segmentIndex?: number;
}

export interface SearchHistoryItem {
  label: string;
  displayName: string;
  latitude: number;
  longitude: number;
  ts: number;
}

interface TripState {
  stops: TripStop[];
  mode: TransportMode;
  legs: RouteLeg[];
  loadingRoute: boolean;
  navigating: boolean;
  searchHistory: SearchHistoryItem[];
  /**
   * Optional overrides for leg geometry — set after a freehand drawing is
   * matched to roads. If present, the route computation will use this
   * polyline instead of querying OSRM between stops `fromStopId` → `toStopId`.
   * May contain multiple overrides for different legs.
   */
  drawnRoutes: {
    fromStopId: string;
    toStopId: string;
    coordinates: { latitude: number; longitude: number }[];
    distanceMeters: number;
    durationSeconds: number;
    /** True when the drawing is only a segment of the full leg —
     *  router should still build from-stop → drawing-start and
     *  drawing-end → to-stop. */
    partial?: boolean;
  }[];
  ensureOrigin: (coords?: { latitude: number; longitude: number }) => void;
  setOriginToMyLocation: (coords: { latitude: number; longitude: number }) => void;
  setOriginToPlace: (place: {
    label: string;
    displayName?: string;
    latitude: number;
    longitude: number;
  }) => void;
  addStop: (
    stop: Omit<TripStop, 'id' | 'dwellMinutes'> & { dwellMinutes?: number },
  ) => void;
  removeStop: (id: string) => void;
  replaceStop: (id: string, next: Partial<TripStop>) => void;
  setDwell: (id: string, minutes: number) => void;
  moveStop: (id: string, direction: -1 | 1) => void;
  clearStops: () => void;
  setMode: (mode: TransportMode) => void;
  setLegs: (legs: RouteLeg[]) => void;
  setLoadingRoute: (loading: boolean) => void;
  setNavigating: (n: boolean) => void;
  addToHistory: (item: Omit<SearchHistoryItem, 'ts'>) => void;
  clearHistory: () => void;
  setDrawnRoutes: (routes: TripState['drawnRoutes']) => void;
  addDrawnRoute: (route: TripState['drawnRoutes'][number]) => void;
  removeDrawnRouteForLeg: (fromStopId: string, toStopId: string) => void;
}

function uid() {
  return `stop_${Math.random().toString(36).slice(2, 10)}`;
}

export const useTripStore = create<TripState>()(
  persist(
    (set, get) => ({
      stops: [],
      mode: 'driving',
      legs: [],
      loadingRoute: false,
      navigating: false,
      searchHistory: [],
      drawnRoutes: [],

      ensureOrigin: (coords) => {
        const { stops } = get();
        if (stops.length > 0) return;
        set({
          stops: [
            {
              id: uid(),
              label: 'Моё местоположение',
              latitude: coords?.latitude ?? 0,
              longitude: coords?.longitude ?? 0,
              dwellMinutes: 0,
              originKind: 'myLocation',
            },
          ],
        });
      },

      setOriginToMyLocation: (coords) =>
        set((state) => {
          const next = state.stops.slice();
          if (next.length === 0) {
            next.push({
              id: uid(),
              label: 'Моё местоположение',
              latitude: coords.latitude,
              longitude: coords.longitude,
              dwellMinutes: 0,
              originKind: 'myLocation',
            });
          } else {
            next[0] = {
              ...next[0],
              label: 'Моё местоположение',
              latitude: coords.latitude,
              longitude: coords.longitude,
              originKind: 'myLocation',
              dwellMinutes: 0,
            };
          }
          return { stops: next };
        }),

      setOriginToPlace: (place) =>
        set((state) => {
          const next = state.stops.slice();
          const newOrigin: TripStop = {
            id: next[0]?.id ?? uid(),
            label: place.label,
            displayName: place.displayName,
            latitude: place.latitude,
            longitude: place.longitude,
            dwellMinutes: 0,
            originKind: 'place',
          };
          if (next.length === 0) next.push(newOrigin);
          else next[0] = newOrigin;
          return { stops: next };
        }),

      addStop: (stop) =>
        set((state) => ({
          stops: [
            ...state.stops,
            {
              id: uid(),
              label: stop.label,
              displayName: stop.displayName,
              latitude: stop.latitude,
              longitude: stop.longitude,
              dwellMinutes: stop.dwellMinutes ?? 0,
              originKind: stop.originKind,
            },
          ],
        })),

      removeStop: (id) =>
        set((state) => {
          const idx = state.stops.findIndex((s) => s.id === id);
          if (idx === -1) return state;
          // Origin (idx 0) is never removable.
          if (idx === 0) return state;
          // Second stop (idx 1) is only removable when there are 3+ stops.
          // Otherwise the user would be left with just an origin and no
          // destination — confusing UX. Remove-X is hidden for stop 2 at UI
          // level, but keep this as defence-in-depth.
          if (idx === 1 && state.stops.length <= 2) return state;
          const next = state.stops.filter((s) => s.id !== id);
          if (next.length === 1 && next[0].originKind === 'myLocation') {
            return { stops: [], legs: [], drawnRoutes: [] };
          }
          return { stops: next };
        }),

      replaceStop: (id, next) =>
        set((state) => ({
          stops: state.stops.map((s) => (s.id === id ? { ...s, ...next } : s)),
        })),

      setDwell: (id, minutes) =>
        set((state) => ({
          stops: state.stops.map((s) =>
            s.id === id ? { ...s, dwellMinutes: Math.max(0, minutes) } : s,
          ),
        })),

      moveStop: (id, direction) =>
        set((state) => {
          const idx = state.stops.findIndex((s) => s.id === id);
          if (idx === -1) return state;
          const target = idx + direction;
          // Origin (index 0) is locked in place
          if (idx === 0 || target === 0) return state;
          if (target < 0 || target >= state.stops.length) return state;
          const next = state.stops.slice();
          const [item] = next.splice(idx, 1);
          next.splice(target, 0, item);
          return { stops: next };
        }),

      clearStops: () => set({ stops: [], legs: [], navigating: false, drawnRoutes: [] }),
      setMode: (mode) => set({ mode }),
      setLegs: (legs) => set({ legs }),
      setLoadingRoute: (loading) => set({ loadingRoute: loading }),
      setNavigating: (navigating) => set({ navigating }),
      setDrawnRoutes: (drawnRoutes) => set({ drawnRoutes }),
      addDrawnRoute: (route) =>
        set((state) => ({
          drawnRoutes: [
            ...state.drawnRoutes.filter(
              (r) =>
                !(r.fromStopId === route.fromStopId && r.toStopId === route.toStopId),
            ),
            route,
          ],
        })),
      removeDrawnRouteForLeg: (fromStopId, toStopId) =>
        set((state) => ({
          drawnRoutes: state.drawnRoutes.filter(
            (r) => !(r.fromStopId === fromStopId && r.toStopId === toStopId),
          ),
        })),

      addToHistory: (item) =>
        set((state) => {
          const key = `${item.latitude.toFixed(5)}|${item.longitude.toFixed(5)}`;
          const filtered = state.searchHistory.filter(
            (h) => `${h.latitude.toFixed(5)}|${h.longitude.toFixed(5)}` !== key,
          );
          return {
            searchHistory: [{ ...item, ts: Date.now() }, ...filtered].slice(0, 12),
          };
        }),

      clearHistory: () => set({ searchHistory: [] }),
    }),
    {
      name: 'rido-trip-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ searchHistory: state.searchHistory, mode: state.mode }),
    },
  ),
);

export function totalDwellMinutes(stops: TripStop[]): number {
  // Dwell at final stop doesn't count toward travel ETA (you're there)
  return stops.slice(0, -1).reduce((sum, s) => sum + s.dwellMinutes, 0);
}

export function totalTravelSeconds(legs: RouteLeg[]): number {
  return legs.reduce((sum, l) => sum + l.durationSeconds, 0);
}

export function totalDistanceMeters(legs: RouteLeg[]): number {
  return legs.reduce((sum, l) => sum + l.distanceMeters, 0);
}
