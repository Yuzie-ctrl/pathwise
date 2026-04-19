import { create } from 'zustand';

export type TransportMode = 'walking' | 'driving' | 'cycling';

export interface TripStop {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  /** Dwell time at this stop in minutes */
  dwellMinutes: number;
}

export interface RouteLeg {
  distanceMeters: number;
  durationSeconds: number;
  coordinates: { latitude: number; longitude: number }[];
}

interface TripState {
  stops: TripStop[];
  mode: TransportMode;
  legs: RouteLeg[];
  loadingRoute: boolean;
  addStop: (stop: Omit<TripStop, 'id' | 'dwellMinutes'> & { dwellMinutes?: number }) => void;
  removeStop: (id: string) => void;
  replaceStop: (id: string, next: Partial<TripStop>) => void;
  setDwell: (id: string, minutes: number) => void;
  moveStop: (id: string, direction: -1 | 1) => void;
  clearStops: () => void;
  setMode: (mode: TransportMode) => void;
  setLegs: (legs: RouteLeg[]) => void;
  setLoadingRoute: (loading: boolean) => void;
}

function uid() {
  return `stop_${Math.random().toString(36).slice(2, 10)}`;
}

export const useTripStore = create<TripState>((set) => ({
  stops: [],
  mode: 'driving',
  legs: [],
  loadingRoute: false,
  addStop: (stop) =>
    set((state) => ({
      stops: [
        ...state.stops,
        {
          id: uid(),
          label: stop.label,
          latitude: stop.latitude,
          longitude: stop.longitude,
          dwellMinutes: stop.dwellMinutes ?? 0,
        },
      ],
    })),
  removeStop: (id) =>
    set((state) => ({ stops: state.stops.filter((s) => s.id !== id) })),
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
      if (target < 0 || target >= state.stops.length) return state;
      const next = state.stops.slice();
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return { stops: next };
    }),
  clearStops: () => set({ stops: [], legs: [] }),
  setMode: (mode) => set({ mode }),
  setLegs: (legs) => set({ legs }),
  setLoadingRoute: (loading) => set({ loadingRoute: loading }),
}));

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
