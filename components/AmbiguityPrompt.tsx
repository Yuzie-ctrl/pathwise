import { Pressable, View } from 'react-native';
import { ChevronLeft, ChevronRight, GraduationCap } from 'lucide-react-native';

import { Text } from '@/components/ui/text';

interface AmbiguityPromptProps {
  /** Number of candidate variants (2–3). */
  variantCount: number;
  /** Currently previewed variant index. */
  activeIndex: number;
  onPrev: () => void;
  onNext: () => void;
  /** Tap the variant field → choose this variant as the better route. */
  onChoose: () => void;
}

/**
 * Top-screen learning prompt shown when the route matcher is uncertain which
 * way to go at a fork. The map (controlled by the parent) is already zoomed to
 * the uncertain spot showing the active variant. Tapping the "Вариант N" field
 * confirms that variant; the arrows cycle between candidates.
 */
export function AmbiguityPrompt({
  variantCount,
  activeIndex,
  onPrev,
  onNext,
  onChoose,
}: AmbiguityPromptProps) {
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: 16, left: 16, right: 16, zIndex: 60 }}
    >
      <View
        className="rounded-2xl bg-card px-4 py-3"
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.16,
          shadowRadius: 10,
          elevation: 8,
        }}
      >
        <Text className="text-base font-semibold text-foreground">
          Какой маршрут подходит лучше?
        </Text>
        <View className="mt-0.5 flex-row items-center gap-1">
          <GraduationCap size={12} color="#6b7280" />
          <Text className="text-xs text-muted-foreground">
            Это помогает мне учиться строить маршрут
          </Text>
        </View>

        <View className="mt-3 flex-row items-center gap-2">
          <Pressable
            onPress={onPrev}
            disabled={variantCount < 2}
            className={`h-11 w-11 items-center justify-center rounded-xl ${
              variantCount < 2 ? 'bg-muted opacity-40' : 'bg-muted'
            }`}
          >
            <ChevronLeft size={20} color="#374151" />
          </Pressable>

          <Pressable
            onPress={onChoose}
            className="flex-1 flex-row items-center justify-center rounded-xl bg-primary py-3"
          >
            <Text className="text-base font-semibold text-primary-foreground">
              Вариант {activeIndex + 1}
            </Text>
            <Text className="ml-1 text-xs text-primary-foreground/80">
              · выбрать
            </Text>
          </Pressable>

          <Pressable
            onPress={onNext}
            disabled={variantCount < 2}
            className={`h-11 w-11 items-center justify-center rounded-xl ${
              variantCount < 2 ? 'bg-muted opacity-40' : 'bg-muted'
            }`}
          >
            <ChevronRight size={20} color="#374151" />
          </Pressable>
        </View>
        <Text className="mt-2 text-center text-xs text-muted-foreground">
          {variantCount} {variantCount === 2 ? 'варианта' : 'варианта'} · стрелки
          переключают
        </Text>
      </View>
    </View>
  );
}
