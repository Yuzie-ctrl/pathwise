import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Icon keys available for saved places. Mapped to lucide-react-native icons
 * in the UI layer (see SavedPlaceIcon in the places components).
 */
export type SavedPlaceIcon =
  | 'home'
  | 'briefcase'
  | 'heart'
  | 'star'
  | 'coffee'
  | 'shopping-bag'
  | 'dumbbell'
  | 'graduation-cap'
  | 'trees'
  | 'plane'
  | 'car'
  | 'map-pin';

/** The full ordered list of selectable icons for custom favorites. */
export const SAVED_PLACE_ICONS: SavedPlaceIcon[] = [
  'home',
  'briefcase',
  'heart',
  'star',
  'coffee',
  'shopping-bag',
  'dumbbell',
  'graduation-cap',
  'trees',
  'plane',
  'car',
  'map-pin',
];

export interface SavedPlace {
  id: string;
  /** 'home' and 'work' are permanent default slots that cannot be deleted. */
  kind: 'home' | 'work' | 'custom';
  name: string;
  icon: SavedPlaceIcon;
  /** Address is unset until the user assigns a location. */
  displayName?: string;
  latitude?: number;
  longitude?: number;
}

/** Whether a saved place has an assigned location. */
export function isPlaceSet(p: SavedPlace): boolean {
  return (
    typeof p.latitude === 'number' &&
    typeof p.longitude === 'number' &&
    !(p.latitude === 0 && p.longitude === 0)
  );
}

const DEFAULT_PLACES: SavedPlace[] = [
  { id: 'home', kind: 'home', name: 'Дом', icon: 'home' },
  { id: 'work', kind: 'work', name: 'Работа', icon: 'briefcase' },
];

interface SavedPlacesState {
  places: SavedPlace[];
  /** Assign / update address for an existing place (by id). */
  setPlaceLocation: (
    id: string,
    loc: { displayName: string; latitude: number; longitude: number },
  ) => void;
  /** Add a new custom favorite. Returns the created id. */
  addCustomPlace: (place: {
    name: string;
    icon: SavedPlaceIcon;
    displayName?: string;
    latitude?: number;
    longitude?: number;
  }) => string;
  /** Update a custom place's name/icon (and optionally address). */
  updatePlace: (
    id: string,
    next: Partial<Pick<SavedPlace, 'name' | 'icon'>>,
  ) => void;
  /** Remove: custom places are dropped entirely; default slots are reset. */
  removePlace: (id: string) => void;
}

function uid() {
  return `place_${Math.random().toString(36).slice(2, 10)}`;
}

export const useSavedPlaces = create<SavedPlacesState>()(
  persist(
    (set) => ({
      places: DEFAULT_PLACES,
      setPlaceLocation: (id, loc) =>
        set((state) => ({
          places: state.places.map((p) =>
            p.id === id
              ? {
                  ...p,
                  displayName: loc.displayName,
                  latitude: loc.latitude,
                  longitude: loc.longitude,
                }
              : p,
          ),
        })),
      addCustomPlace: (place) => {
        const id = uid();
        set((state) => ({
          places: [
            ...state.places,
            {
              id,
              kind: 'custom',
              name: place.name,
              icon: place.icon,
              displayName: place.displayName,
              latitude: place.latitude,
              longitude: place.longitude,
            },
          ],
        }));
        return id;
      },
      updatePlace: (id, next) =>
        set((state) => ({
          places: state.places.map((p) =>
            p.id === id ? { ...p, ...next } : p,
          ),
        })),
      removePlace: (id) =>
        set((state) => {
          const target = state.places.find((p) => p.id === id);
          if (!target) return state;
          // Default slots (home/work) are permanent — just clear the address.
          if (target.kind !== 'custom') {
            return {
              places: state.places.map((p) =>
                p.id === id
                  ? {
                      ...p,
                      displayName: undefined,
                      latitude: undefined,
                      longitude: undefined,
                    }
                  : p,
              ),
            };
          }
          return { places: state.places.filter((p) => p.id !== id) };
        }),
    }),
    {
      name: 'rido-saved-places',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
