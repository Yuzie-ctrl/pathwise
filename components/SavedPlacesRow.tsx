import { useRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Plus } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { triggerHaptic } from '@/lib/animations';
import { SAVED_PLACE_ICON_MAP } from '@/lib/savedPlaceIcons';
import {
  isPlaceSet,
  useSavedPlaces,
  type SavedPlace,
} from '@/lib/stores/savedPlacesStore';

/** Long-press duration (ms) before the edit menu opens. */
const HOLD_MS = 1000;

interface SavedPlacesRowProps {
  /** Tap on a place chip. */
  onPressPlace: (place: SavedPlace) => void;
  /** Long-press completed on a place chip → open editor. */
  onEditPlace: (place: SavedPlace) => void;
  /** Tap the "+" chip → add a new custom favorite. */
  onAddPlace: () => void;
}

export function SavedPlacesRow({
  onPressPlace,
  onEditPlace,
  onAddPlace,
}: SavedPlacesRowProps) {
  const places = useSavedPlaces((s) => s.places);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingHorizontal: 16,
        gap: 8,
        alignItems: 'center',
      }}
    >
      {places.map((place) => (
        <PlaceChip
          key={place.id}
          place={place}
          onPress={() => onPressPlace(place)}
          onEdit={() => onEditPlace(place)}
        />
      ))}
      <Pressable
        onPress={onAddPlace}
        className="flex-row items-center gap-1.5 bg-card px-3.5 py-2.5"
        style={{
          borderRadius: 4,
          transform: [{ skewX: '-8deg' }],
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.12,
          shadowRadius: 6,
          elevation: 4,
        }}
      >
        <View style={{ transform: [{ skewX: '8deg' }] }}>
          <View className="flex-row items-center gap-1.5">
            <Plus size={16} color="#2563eb" />
            <Text className="text-sm font-semibold text-primary">Любимые</Text>
          </View>
        </View>
      </Pressable>
    </ScrollView>
  );
}

interface PlaceChipProps {
  place: SavedPlace;
  onPress: () => void;
  onEdit: () => void;
}

function PlaceChip({ place, onPress, onEdit }: PlaceChipProps) {
  const Icon = SAVED_PLACE_ICON_MAP[place.icon];
  const set = isPlaceSet(place);
  const fill = useSharedValue(0);
  const firedRef = useRef(false);

  const triggerEdit = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    triggerHaptic('medium');
    onEdit();
  };

  // Long-press: animate a fill sweep left→right over HOLD_MS, then open edit.
  const longPress = Gesture.LongPress()
    .minDuration(HOLD_MS)
    .maxDistance(20)
    .onBegin(() => {
      firedRef.current = false;
      fill.value = 0;
      fill.value = withTiming(1, { duration: HOLD_MS });
    })
    .onStart(() => {
      runOnJS(triggerEdit)();
    })
    .onFinalize(() => {
      fill.value = withTiming(0, { duration: 180 });
    });

  const tap = Gesture.Tap()
    .maxDuration(HOLD_MS)
    .onEnd(() => {
      runOnJS(onPress)();
    });

  const gesture = Gesture.Exclusive(longPress, tap);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fill.value * 100}%`,
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        className="overflow-hidden bg-card"
        style={{
          borderRadius: 4,
          transform: [{ skewX: '-8deg' }],
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.12,
          shadowRadius: 6,
          elevation: 4,
        }}
      >
        {/* Fill sweep overlay during long-press */}
        <Animated.View
          pointerEvents="none"
          className="absolute bottom-0 left-0 top-0 bg-primary/15"
          style={fillStyle}
        />
        <View
          className="flex-row items-center gap-2 px-3.5 py-2.5"
          style={{ transform: [{ skewX: '8deg' }] }}
        >
          <Icon size={16} color={set ? '#2563eb' : '#9ca3af'} />
          <Text
            className={`text-sm font-semibold ${set ? 'text-foreground' : 'text-muted-foreground'}`}
            numberOfLines={1}
          >
            {place.name}
          </Text>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}
