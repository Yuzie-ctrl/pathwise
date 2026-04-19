import { useState } from 'react';
import { Modal, Pressable, TextInput, View } from 'react-native';
import { Clock } from 'lucide-react-native';

import { Text } from '@/components/ui/text';

interface DwellPickerProps {
  visible: boolean;
  currentMinutes: number;
  stopLabel?: string;
  onClose: () => void;
  onSelect: (minutes: number) => void;
}

const PRESETS = [
  { label: 'Без остановки', minutes: 0 },
  { label: '5 мин', minutes: 5 },
  { label: '15 мин', minutes: 15 },
  { label: '30 мин', minutes: 30 },
  { label: '1 час', minutes: 60 },
  { label: '2 часа', minutes: 120 },
];

export function DwellPicker({
  visible,
  currentMinutes,
  stopLabel,
  onClose,
  onSelect,
}: DwellPickerProps) {
  const [customValue, setCustomValue] = useState('');

  const handleCustom = () => {
    const n = parseInt(customValue, 10);
    if (Number.isFinite(n) && n >= 0) {
      onSelect(n);
      setCustomValue('');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        className="flex-1 items-center justify-center bg-black/50 px-6"
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="w-full max-w-sm rounded-2xl bg-background p-5"
        >
          <View className="mb-4 flex-row items-center gap-2">
            <View>
              <Clock size={20} color="#2563eb" />
            </View>
            <Text className="text-lg font-semibold text-foreground">
              Время пребывания
            </Text>
          </View>
          {stopLabel ? (
            <Text
              className="mb-4 text-sm text-muted-foreground"
              numberOfLines={1}
            >
              {stopLabel}
            </Text>
          ) : null}

          <View className="flex-row flex-wrap gap-2">
            {PRESETS.map((p) => {
              const active = p.minutes === currentMinutes;
              return (
                <Pressable
                  key={p.label}
                  onPress={() => onSelect(p.minutes)}
                  className={`rounded-full border px-4 py-2 ${
                    active
                      ? 'border-primary bg-primary'
                      : 'border-border bg-muted'
                  }`}
                >
                  <Text
                    className={`text-sm font-medium ${
                      active ? 'text-primary-foreground' : 'text-foreground'
                    }`}
                  >
                    {p.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View className="mt-5">
            <Text className="mb-2 text-xs font-medium text-muted-foreground">
              Свое значение (мин)
            </Text>
            <View className="flex-row gap-2">
              <TextInput
                value={customValue}
                onChangeText={setCustomValue}
                placeholder="напр. 45"
                placeholderTextColor="#999"
                keyboardType="number-pad"
                className="flex-1 rounded-lg border border-border bg-muted px-3 py-2 text-foreground"
                style={{ fontFamily: 'Inter_400Regular' }}
              />
              <Pressable
                onPress={handleCustom}
                disabled={!customValue}
                className={`items-center justify-center rounded-lg px-4 ${
                  customValue ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    customValue
                      ? 'text-primary-foreground'
                      : 'text-muted-foreground'
                  }`}
                >
                  OK
                </Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
