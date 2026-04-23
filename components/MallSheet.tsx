import { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import {
  GestureDetector,
  Gesture,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  clamp,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  Locate,
  MapPin,
  Navigation2,
  Store,
  X,
} from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import type { Mall } from '@/lib/malls';

interface MallSheetProps {
  mall: Mall | null;
  onClose: () => void;
}

type StepId = 'locate' | 'navigate';

export function MallSheet({ mall, onClose }: MallSheetProps) {
  const [floor, setFloor] = useState<number>(1);
  const [landmarkChips, setLandmarkChips] = useState<string[]>([]);
  const [landmarkInput, setLandmarkInput] = useState('');
  const [destinationInput, setDestinationInput] = useState('');
  const [confirmedDestination, setConfirmedDestination] = useState<string | null>(
    null,
  );
  const [step, setStep] = useState<StepId>('locate');

  // Autocomplete suggestions filtered by current input — LIMITED to the
  // stores that are actually tenants of this mall. Falls back gracefully
  // for malls without a curated tenant list.
  const storePool = useMemo(
    () => mall?.stores ?? [],
    [mall?.stores],
  );

  const landmarkSuggestions = useMemo(() => {
    const q = landmarkInput.trim().toLowerCase();
    if (q.length === 0) return [];
    return storePool
      .filter(
        (s) => s.toLowerCase().includes(q) && !landmarkChips.includes(s),
      )
      .slice(0, 6);
  }, [landmarkInput, landmarkChips, storePool]);

  const destinationSuggestions = useMemo(() => {
    const q = destinationInput.trim().toLowerCase();
    if (q.length === 0) return [];
    return storePool.filter((s) => s.toLowerCase().includes(q)).slice(0, 6);
  }, [destinationInput, storePool]);

  // Reset state whenever a different mall is opened.
  const mallId = mall?.id ?? '';
  useEffect(() => {
    setFloor(1);
    setLandmarkChips([]);
    setLandmarkInput('');
    setDestinationInput('');
    setConfirmedDestination(null);
    setStep('locate');
  }, [mallId]);

  if (!mall) return null;

  const currentFloor =
    mall.floors.find((f) => f.number === floor) ?? mall.floors[0];

  const addLandmark = (value: string) => {
    const v = value.trim();
    if (v.length === 0) return;
    if (landmarkChips.includes(v)) {
      setLandmarkInput('');
      return;
    }
    const next = [...landmarkChips, v].slice(0, 4);
    setLandmarkChips(next);
    setLandmarkInput('');
    if (next.length >= 2) {
      setStep('navigate');
    }
  };

  const submitLandmark = () => {
    addLandmark(landmarkInput);
  };

  const removeChip = (v: string) => {
    setLandmarkChips((prev) => {
      const next = prev.filter((c) => c !== v);
      if (next.length < 2) setStep('locate');
      return next;
    });
  };

  const submitDestination = () => {
    const v = destinationInput.trim();
    if (v.length === 0) return;
    setConfirmedDestination(v);
  };

  return (
    <Modal
      visible={mall !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable
          onPress={() => {
            Keyboard.dismiss();
            onClose();
          }}
          className="flex-1 items-center justify-center bg-black/50 px-4"
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="w-full max-w-[520px] overflow-hidden rounded-3xl bg-card"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.25,
              shadowRadius: 16,
              elevation: 12,
              maxHeight: '92%',
            }}
          >
            {/* Header */}
            <View className="flex-row items-center justify-between px-5 pt-4">
              <View className="flex-1 pr-2">
                <Text
                  className="text-lg font-bold text-foreground"
                  numberOfLines={1}
                >
                  {mall.name}
                </Text>
                <Text
                  className="text-xs text-muted-foreground"
                  numberOfLines={1}
                >
                  Карта торгового центра
                </Text>
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={8}
                className="h-9 w-9 items-center justify-center rounded-full bg-muted active:bg-muted/70"
              >
                <X size={18} color="#333" />
              </Pressable>
            </View>

            <ScrollView
              className="mt-3"
              contentContainerStyle={{ paddingBottom: 18 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Floor switcher + map area */}
              <View className="px-5">
                <View className="flex-row gap-3">
                  {/* Pinch-zoomable map */}
                  <View
                    className="flex-1 overflow-hidden rounded-2xl bg-muted"
                    style={{ aspectRatio: 16 / 9, minHeight: 180 }}
                  >
                    {currentFloor?.image ? (
                      <ZoomableImage
                        source={currentFloor.image}
                        youPosition={
                          landmarkChips.length >= 2
                            ? hashToRatio(
                                `${mall.id}-${landmarkChips.join('|')}`,
                              )
                            : null
                        }
                        destinationPosition={
                          confirmedDestination
                            ? hashToRatio(`${mall.id}-dest-${confirmedDestination}`)
                            : null
                        }
                      />
                    ) : (
                      <View className="flex-1 items-center justify-center p-4">
                        <Store size={28} color="#999" />
                        <Text className="mt-2 text-center text-xs text-muted-foreground">
                          Карта появится скоро
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Floor buttons column */}
                  <View className="gap-2">
                    {mall.floors.map((f) => {
                      const active = f.number === floor;
                      return (
                        <Pressable
                          key={f.number}
                          onPress={() => setFloor(f.number)}
                          className={`h-10 w-10 items-center justify-center rounded-xl border ${
                            active
                              ? 'border-primary bg-primary'
                              : 'border-border bg-muted'
                          }`}
                        >
                          <Text
                            className={`text-sm font-bold ${
                              active
                                ? 'text-primary-foreground'
                                : 'text-foreground'
                            }`}
                          >
                            {f.number}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                <Text className="mt-2 text-[11px] text-muted-foreground">
                  {currentFloor?.label} · щипком можно приблизить карту
                </Text>
              </View>

              {/* Landmarks input */}
              <View className="mt-4 px-5">
                <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Сориентируйтесь
                </Text>
                {landmarkChips.length > 0 ? (
                  <View className="mb-2 flex-row flex-wrap gap-2">
                    {landmarkChips.map((c) => (
                      <View
                        key={c}
                        className="flex-row items-center gap-1 rounded-full bg-foreground/90 px-3 py-1.5"
                      >
                        <Text className="text-xs font-medium text-background">
                          {c}
                        </Text>
                        <Pressable onPress={() => removeChip(c)} hitSlop={6}>
                          <X size={12} color="#fff" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}
                {landmarkChips.length < 2 ? (
                  <>
                    <View className="flex-row items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                      <Store size={14} color="#666" />
                      <TextInput
                        value={landmarkInput}
                        onChangeText={setLandmarkInput}
                        onSubmitEditing={submitLandmark}
                        placeholder="Какие два магазина вы видите?"
                        placeholderTextColor="#999"
                        returnKeyType="done"
                        // Keep the keyboard open and don't reset focus/text on
                        // submit-commit. We manually clear via addLandmark().
                        blurOnSubmit={false}
                        autoCorrect={false}
                        autoCapitalize="none"
                        style={{
                          flex: 1,
                          color: '#111',
                          paddingVertical: Platform.OS === 'ios' ? 6 : 2,
                        }}
                      />
                      <Pressable onPress={submitLandmark} hitSlop={6}>
                        <Locate size={16} color="#2563eb" />
                      </Pressable>
                    </View>
                    {landmarkSuggestions.length > 0 ? (
                      <View className="mt-1 rounded-xl border border-border bg-card">
                        {landmarkSuggestions.map((s) => (
                          <Pressable
                            key={s}
                            onPress={() => addLandmark(s)}
                            className="flex-row items-center gap-2 border-b border-border/50 px-3 py-2 last:border-b-0 active:bg-muted/50"
                          >
                            <Store size={12} color="#2563eb" />
                            <Text className="flex-1 text-sm text-foreground">
                              {s}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </>
                ) : null}

                {landmarkChips.length >= 2 ? (
                  <View className="mt-1 rounded-xl bg-emerald-100 px-3 py-2 dark:bg-emerald-500/20">
                    <View className="flex-row items-center gap-1.5">
                      <MapPin size={12} color="#059669" />
                      <Text className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                        Вы примерно здесь
                      </Text>
                    </View>
                    <Text className="mt-0.5 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                      Между точек: {landmarkChips.join(' и ')}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Destination input (after locate step) */}
              {step === 'navigate' ? (
                <View className="mt-4 px-5">
                  <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    В какой магазин вам надо?
                  </Text>
                  {confirmedDestination ? (
                    <View className="rounded-xl bg-primary/10 px-3 py-2.5">
                      <View className="flex-row items-center gap-2">
                        <Navigation2 size={14} color="#2563eb" />
                        <Text
                          className="flex-1 text-sm font-semibold text-foreground"
                          numberOfLines={1}
                        >
                          {confirmedDestination}
                        </Text>
                        <Pressable
                          onPress={() => {
                            setConfirmedDestination(null);
                            setDestinationInput('');
                          }}
                          hitSlop={6}
                        >
                          <X size={14} color="#2563eb" />
                        </Pressable>
                      </View>
                      <Text className="mt-1 text-[11px] text-muted-foreground">
                        Маршрут по карте: от {landmarkChips[0] ?? '—'} к{' '}
                        {confirmedDestination}. Следуйте по коридору к{' '}
                        {mall.floors.length > 1 ? 'эскалатору ' : ''}
                        {currentFloor?.label ?? '1 этажу'}.
                      </Text>
                    </View>
                  ) : (
                    <>
                      <View className="flex-row items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                        <Store size={14} color="#666" />
                        <TextInput
                          value={destinationInput}
                          onChangeText={setDestinationInput}
                          onSubmitEditing={submitDestination}
                          placeholder="Название магазина"
                          placeholderTextColor="#999"
                          returnKeyType="done"
                          blurOnSubmit={false}
                          autoCorrect={false}
                          autoCapitalize="none"
                          style={{
                            flex: 1,
                            color: '#111',
                            paddingVertical: Platform.OS === 'ios' ? 6 : 2,
                          }}
                        />
                        <Pressable onPress={submitDestination} hitSlop={6}>
                          <Navigation2 size={16} color="#2563eb" />
                        </Pressable>
                      </View>
                      {destinationSuggestions.length > 0 ? (
                        <View className="mt-1 rounded-xl border border-border bg-card">
                          {destinationSuggestions.map((s) => (
                            <Pressable
                              key={s}
                              onPress={() => {
                                setDestinationInput(s);
                                setConfirmedDestination(s);
                              }}
                              className="flex-row items-center gap-2 border-b border-border/50 px-3 py-2 last:border-b-0 active:bg-muted/50"
                            >
                              <Store size={12} color="#2563eb" />
                              <Text className="flex-1 text-sm text-foreground">
                                {s}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                    </>
                  )}
                </View>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Pinch-to-zoom image wrapper
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Deterministic [0..1, 0..1] position from a string — used to place
// "Вы здесь" + destination overlays on the floor plan image without
// real coordinate data.
// ---------------------------------------------------------------------
function hashToRatio(seed: string): { x: number; y: number } {
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) | 0;
    h2 = ((h2 << 5) + h2 + c * 7) | 0;
  }
  // Map to inner 0.18..0.82 range so circles aren't clipped by rounded corners.
  const x = 0.18 + ((Math.abs(h1) % 1000) / 1000) * 0.64;
  const y = 0.18 + ((Math.abs(h2) % 1000) / 1000) * 0.64;
  return { x, y };
}

function ZoomableImage({
  source,
  youPosition,
  destinationPosition,
}: {
  source: NonNullable<Mall['floors'][0]['image']>;
  youPosition: { x: number; y: number } | null;
  destinationPosition: { x: number; y: number } | null;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const MIN_SCALE = 1;
  const MAX_SCALE = 6;

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = clamp(savedScale.value * e.scale, MIN_SCALE, MAX_SCALE);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.001) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(2)
    .onUpdate((e) => {
      if (scale.value <= 1.001) return;
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1.1) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
      } else {
        scale.value = withTiming(2.5);
        savedScale.value = 2.5;
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={[{ width: '100%', height: '100%' }, animStyle]}>
        <Image
          source={source}
          style={{ width: '100%', height: '100%' }}
          resizeMode="contain"
        />
        {/* Overlays: position absolutely in % — stay in sync with image. */}
        {youPosition ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: `${youPosition.x * 100}%`,
              top: `${youPosition.y * 100}%`,
              transform: [{ translateX: -16 }, { translateY: -16 }],
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                borderWidth: 3,
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239,68,68,0.25)',
              }}
            />
            <View
              style={{
                position: 'absolute',
                left: 12,
                top: 12,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: '#ef4444',
              }}
            />
          </View>
        ) : null}
        {destinationPosition ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: `${destinationPosition.x * 100}%`,
              top: `${destinationPosition.y * 100}%`,
              transform: [{ translateX: -12 }, { translateY: -12 }],
            }}
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: '#2563eb',
                borderWidth: 2,
                borderColor: '#fff',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MapPin size={12} color="#fff" />
            </View>
          </View>
        ) : null}
        {/* Dashed "path" line between you + destination */}
        {youPosition && destinationPosition ? (
          <PathLine from={youPosition} to={destinationPosition} />
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

function PathLine({
  from,
  to,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
}) {
  // Render as a single absolutely-positioned rotated View acting as a dashed
  // line. We approximate the hypotenuse in percent coordinates by flattening
  // to pixel values via onLayout.
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  if (size.w === 0 || size.h === 0) {
    return (
      <View
        onLayout={(e) =>
          setSize({
            w: e.nativeEvent.layout.width,
            h: e.nativeEvent.layout.height,
          })
        }
        style={{ position: 'absolute', inset: 0 }}
      />
    );
  }
  const x1 = from.x * size.w;
  const y1 = from.y * size.h;
  const x2 = to.x * size.w;
  const y2 = to.y * size.h;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x1,
        top: y1,
        width: length,
        height: 3,
        transform: [{ translateY: -1.5 }, { rotate: `${angleDeg}deg` }],
        transformOrigin: '0% 50%' as unknown as undefined,
      }}
    >
      <View
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: '#2563eb',
          opacity: 0.85,
          borderRadius: 2,
        }}
      />
    </View>
  );
}
