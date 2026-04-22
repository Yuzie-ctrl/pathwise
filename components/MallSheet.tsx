import { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
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

  const submitLandmark = () => {
    const v = landmarkInput.trim();
    if (v.length === 0) return;
    if (landmarkChips.includes(v)) {
      setLandmarkInput('');
      return;
    }
    const next = [...landmarkChips, v].slice(0, 4);
    setLandmarkChips(next);
    setLandmarkInput('');
    if (next.length >= 2) {
      // Two landmarks — we "triangulate" the user position.
      setStep('navigate');
    }
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
      <Pressable
        onPress={onClose}
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
              <Text className="text-xs text-muted-foreground" numberOfLines={1}>
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
          >
            {/* Floor switcher + map area */}
            <View className="px-5">
              <View className="flex-row gap-3">
                {/* Map */}
                <View
                  className="flex-1 overflow-hidden rounded-2xl bg-muted"
                  style={{ aspectRatio: 16 / 9, minHeight: 180 }}
                >
                  {currentFloor?.image ? (
                    <Image
                      source={currentFloor.image}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="contain"
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
                            active ? 'text-primary-foreground' : 'text-foreground'
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
                {currentFloor?.label}
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
                      className="flex-row items-center gap-1 rounded-full bg-muted px-3 py-1.5"
                    >
                      <Text className="text-xs font-medium text-foreground">
                        {c}
                      </Text>
                      <Pressable onPress={() => removeChip(c)} hitSlop={6}>
                        <X size={12} color="#666" />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
              {landmarkChips.length < 2 ? (
                <View className="flex-row items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                  <Store size={14} color="#666" />
                  <TextInput
                    value={landmarkInput}
                    onChangeText={setLandmarkInput}
                    onSubmitEditing={submitLandmark}
                    placeholder="Какие два магазина вы видите?"
                    placeholderTextColor="#999"
                    returnKeyType="done"
                    style={{ flex: 1, color: '#111', paddingVertical: 4 }}
                  />
                  <Pressable onPress={submitLandmark} hitSlop={6}>
                    <Locate size={16} color="#2563eb" />
                  </Pressable>
                </View>
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
                  <View className="flex-row items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
                    <Store size={14} color="#666" />
                    <TextInput
                      value={destinationInput}
                      onChangeText={setDestinationInput}
                      onSubmitEditing={submitDestination}
                      placeholder="Название магазина"
                      placeholderTextColor="#999"
                      returnKeyType="done"
                      style={{ flex: 1, color: '#111', paddingVertical: 4 }}
                    />
                    <Pressable onPress={submitDestination} hitSlop={6}>
                      <Navigation2 size={16} color="#2563eb" />
                    </Pressable>
                  </View>
                )}
              </View>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
