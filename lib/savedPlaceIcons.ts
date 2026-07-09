import {
  Briefcase,
  Car,
  Coffee,
  Dumbbell,
  GraduationCap,
  Heart,
  Home,
  MapPin,
  Plane,
  ShoppingBag,
  Star,
  Trees,
  type LucideIcon,
} from 'lucide-react-native';

import type { SavedPlaceIcon } from '@/lib/stores/savedPlacesStore';

/** Resolve a saved-place icon key to its lucide component. */
export const SAVED_PLACE_ICON_MAP: Record<SavedPlaceIcon, LucideIcon> = {
  home: Home,
  briefcase: Briefcase,
  heart: Heart,
  star: Star,
  coffee: Coffee,
  'shopping-bag': ShoppingBag,
  dumbbell: Dumbbell,
  'graduation-cap': GraduationCap,
  trees: Trees,
  plane: Plane,
  car: Car,
  'map-pin': MapPin,
};
