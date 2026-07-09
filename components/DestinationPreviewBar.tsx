import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Navigation2, X } from 'lucide-react-native';

import { Text } from '@/components/ui/text';

interface DestinationPreviewBarProps {
  label: string;
  detail?: string;
  onGo: () => void;
  onCancel: () => void;
}

/** Bottom bar shown when a place is picked (via search or a set favorite):
 *  a labeled summary + a big "В путь!" button that opens point selection. */
export function DestinationPreviewBar({
  label,
  detail,
  onGo,
  onCancel,
}: DestinationPreviewBarProps) {
  return (
    <SafeAreaView
      edges={['bottom']}
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
    >
      <View className="px-4 pb-4">
        <View
          className="rounded-3xl bg-card p-4"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.16,
            shadowRadius: 12,
            elevation: 8,
          }}
        >
          <View className="mb-3 flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <Text
                className="text-lg font-bold text-foreground"
                numberOfLines={1}
              >
                {label}
              </Text>
              {detail ? (
                <Text
                  className="mt-0.5 text-sm text-muted-foreground"
                  numberOfLines={2}
                >
                  {detail}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={onCancel}
              hitSlop={8}
              className="h-8 w-8 items-center justify-center rounded-full bg-muted"
            >
              <X size={16} color="#6b7280" />
            </Pressable>
          </View>
          <Pressable
            onPress={onGo}
            className="flex-row items-center justify-center gap-2 rounded-2xl bg-primary py-4"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.18,
              shadowRadius: 8,
              elevation: 6,
            }}
          >
            <Navigation2 size={20} color="#fff" />
            <Text className="text-base font-bold text-white">В путь!</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
