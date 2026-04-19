import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { MapPin, Search, X } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { geocodeSearch, type GeocodeResult } from '@/lib/routing';

interface SearchSheetProps {
  placeholder?: string;
  onSelect: (result: GeocodeResult) => void;
  onClose: () => void;
}

export function SearchSheet({ placeholder = 'Поиск места', onSelect, onClose }: SearchSheetProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await geocodeSearch(query, controller.signal);
        setResults(data);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setError('Не удалось выполнить поиск');
        }
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(handle);
    };
  }, [query]);

  const hint = useMemo(() => {
    if (query.trim().length === 0) return 'Начните вводить название места';
    if (query.trim().length < 2) return 'Введите хотя бы 2 символа';
    if (!loading && results.length === 0 && !error) return 'Ничего не найдено';
    return null;
  }, [query, loading, results.length, error]);

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center gap-2 border-b border-border px-4 py-3">
        <View className="flex-1 flex-row items-center rounded-xl bg-muted px-3">
          <View className="mr-2">
            <Search size={18} color="#888" />
          </View>
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            placeholder={placeholder}
            placeholderTextColor="#888"
            className="flex-1 py-3 text-base text-foreground"
            style={{ fontFamily: 'Inter_400Regular' }}
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <X size={16} color="#888" />
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={onClose} hitSlop={8} className="px-2 py-2">
          <Text className="text-base font-medium text-primary">Отмена</Text>
        </Pressable>
      </View>

      {loading ? (
        <View className="items-center py-6">
          <ActivityIndicator />
        </View>
      ) : null}

      {error ? (
        <View className="px-4 py-4">
          <Text className="text-sm text-destructive">{error}</Text>
        </View>
      ) : null}

      <ScrollView keyboardShouldPersistTaps="handled" className="flex-1">
        {hint ? (
          <View className="px-4 py-6">
            <Text className="text-sm text-muted-foreground">{hint}</Text>
          </View>
        ) : null}
        {results.map((r, i) => (
          <Pressable
            key={`${r.latitude}-${r.longitude}-${i}`}
            onPress={() => onSelect(r)}
            className="flex-row items-start gap-3 border-b border-border px-4 py-3 active:bg-muted"
          >
            <View className="mt-1">
              <MapPin size={18} color="#2563eb" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-medium text-foreground" numberOfLines={1}>
                {r.shortName}
              </Text>
              <Text className="text-xs text-muted-foreground" numberOfLines={2}>
                {r.displayName}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
