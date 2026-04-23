import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { TransportFavorite } from '@/lib/transport';

interface TransportFavoritesState {
  favorites: TransportFavorite[];
  addFavorite: (fav: Omit<TransportFavorite, 'addedAt'>) => void;
  removeFavorite: (id: string) => void;
  bumpFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
}

export const useTransportFavorites = create<TransportFavoritesState>()(
  persist(
    (set, get) => ({
      favorites: [],
      addFavorite: (fav) =>
        set((state) => {
          const exists = state.favorites.some((f) => f.id === fav.id);
          const next: TransportFavorite = { ...fav, addedAt: Date.now() };
          if (exists) {
            return {
              favorites: state.favorites.map((f) => (f.id === fav.id ? next : f)),
            };
          }
          return { favorites: [next, ...state.favorites].slice(0, 30) };
        }),
      removeFavorite: (id) =>
        set((state) => ({ favorites: state.favorites.filter((f) => f.id !== id) })),
      bumpFavorite: (id) =>
        set((state) => ({
          favorites: state.favorites.map((f) =>
            f.id === id ? { ...f, addedAt: Date.now() } : f,
          ),
        })),
      isFavorite: (id) => get().favorites.some((f) => f.id === id),
    }),
    {
      name: 'rido-transport-favorites',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
