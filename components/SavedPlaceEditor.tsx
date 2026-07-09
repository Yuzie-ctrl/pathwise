import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, MapPin, Search, Trash2, X } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { geocodeSearch, type GeocodeResult } from '@/lib/routing';
import { SAVED_PLACE_ICON_MAP } from '@/lib/savedPlaceIcons';
import {
  SAVED_PLACE_ICONS,
  isPlaceSet,
  type SavedPlace,
  type SavedPlaceIcon,
} from '@/lib/stores/savedPlacesStore';

interface SavedPlaceEditorProps {
  /** The place being edited, or null for a brand-new custom favorite. */
  place: SavedPlace | null;
  /** Whether we're creating a new custom favorite (needs name + icon). */
  creating: boolean;
  /** Live preview: called as the user picks a search result so the parent
   *  map can pan/zoom to it (centered). */
  onPreviewLocation: (r: GeocodeResult) => void;
  /** Commit the chosen address. For creating, also carries name + icon. */
  onSave: (data: {
    name: string;
    icon: SavedPlaceIcon;
    location: GeocodeResult;
  }) => void;
  /** Remove this saved place. */
  onRemove: () => void;
  onClose: () => void;
}

export function SavedPlaceEditor({
  place,
  creating,
  onPreviewLocation,
  onSave,
  onRemove,
  onClose,
}: SavedPlaceEditorProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<GeocodeResult | null>(
    place && isPlaceSet(place)
      ? {
          displayName: place.displayName || place.name,
          shortName: place.name,
          latitude: place.latitude as number,
          longitude: place.longitude as number,
        }
      : null,
  );
  const [name, setName] = useState(creating ? '' : (place?.name ?? ''));
  const [icon, setIcon] = useState<SavedPlaceIcon>(
    place?.icon ?? SAVED_PLACE_ICONS[0],
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const canEditNameIcon = creating || place?.kind === 'custom';

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await geocodeSearch(query, controller.signal);
        setResults(data);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(handle);
    };
  }, [query]);

  const handlePickResult = (r: GeocodeResult) => {
    setSelected(r);
    setResults([]);
    setQuery('');
    inputRef.current?.blur();
    onPreviewLocation(r);
  };

  const canSave = useMemo(() => {
    if (!selected) return false;
    if (canEditNameIcon && name.trim().length === 0) return false;
    return true;
  }, [selected, canEditNameIcon, name]);

  const handleSave = () => {
    if (!selected) return;
    const finalName = canEditNameIcon
      ? name.trim()
      : (place?.name ?? selected.shortName);
    onSave({ name: finalName, icon, location: selected });
  };

  const title = creating
    ? 'Новое место'
    : place
      ? place.name
      : 'Сохранённое место';

  return (
    <View className="absolute inset-0 z-[60]">
      {/* Dimmed map scrim (map stays in place behind this) */}
      <Pressable className="absolute inset-0 bg-black/40" onPress={onClose} />

      <SafeAreaView
        edges={['top']}
        pointerEvents="box-none"
        style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
      >
        <View className="px-4 pt-2">
          <View
            className="rounded-2xl bg-card p-3"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.16,
              shadowRadius: 10,
              elevation: 8,
            }}
          >
            <View className="mb-2 flex-row items-center justify-between">
              <Text className="text-base font-bold text-foreground">
                {title}
              </Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <X size={20} color="#888" />
              </Pressable>
            </View>

            {canEditNameIcon ? (
              <View className="mb-2">
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Название места"
                  placeholderTextColor="#9ca3af"
                  className="rounded-xl bg-muted px-3 py-3 text-base text-foreground"
                  style={{ fontFamily: 'Inter_400Regular' }}
                />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{ gap: 8, paddingVertical: 8 }}
                >
                  {SAVED_PLACE_ICONS.map((key) => {
                    const IconCmp = SAVED_PLACE_ICON_MAP[key];
                    const active = key === icon;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => setIcon(key)}
                        className={`h-11 w-11 items-center justify-center rounded-xl ${active ? 'bg-primary' : 'bg-muted'}`}
                      >
                        <IconCmp
                          size={20}
                          color={active ? '#fff' : '#6b7280'}
                        />
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            {/* Address search */}
            <View className="flex-row items-center rounded-xl bg-muted px-3">
              <Search size={18} color="#888" />
              <TextInput
                ref={inputRef}
                value={query}
                onChangeText={setQuery}
                placeholder="Изменить адрес"
                placeholderTextColor="#9ca3af"
                className="ml-2 flex-1 py-3 text-base text-foreground"
                style={{ fontFamily: 'Inter_400Regular' }}
                returnKeyType="search"
              />
              {loading ? <ActivityIndicator size="small" /> : null}
            </View>

            {selected && results.length === 0 ? (
              <View className="mt-2 flex-row items-center gap-2 rounded-xl bg-primary/10 px-3 py-2">
                <MapPin size={16} color="#2563eb" />
                <Text
                  className="flex-1 text-sm text-foreground"
                  numberOfLines={1}
                >
                  {selected.shortName}
                </Text>
              </View>
            ) : null}

            {results.length > 0 ? (
              <View className="mt-2 max-h-56 overflow-hidden rounded-xl border border-border">
                <ScrollView keyboardShouldPersistTaps="handled">
                  {results.map((r, i) => (
                    <Pressable
                      key={`${r.latitude}-${r.longitude}-${i}`}
                      onPress={() => handlePickResult(r)}
                      className="flex-row items-start gap-2 border-b border-border px-3 py-2.5 active:bg-muted"
                    >
                      <View className="mt-0.5">
                        <MapPin size={16} color="#2563eb" />
                      </View>
                      <View className="flex-1">
                        <Text
                          className="text-sm text-foreground"
                          numberOfLines={1}
                        >
                          {r.shortName}
                        </Text>
                        <Text
                          className="text-xs text-muted-foreground"
                          numberOfLines={1}
                        >
                          {r.displayName}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}
          </View>
        </View>
      </SafeAreaView>

      {/* Bottom actions */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
        pointerEvents="box-none"
      >
        <SafeAreaView edges={['bottom']} pointerEvents="box-none">
          <View className="gap-2 px-4 pb-4">
            {place && (place.kind === 'custom' || isPlaceSet(place)) ? (
              confirmDelete ? (
                <View
                  className="flex-row items-center gap-2 rounded-2xl bg-card p-2"
                  style={{
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.14,
                    shadowRadius: 8,
                    elevation: 5,
                  }}
                >
                  <Pressable
                    onPress={() => setConfirmDelete(false)}
                    className="flex-1 items-center rounded-xl bg-muted py-3"
                  >
                    <Text className="text-sm font-semibold text-foreground">
                      Отмена
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={onRemove}
                    className="flex-1 items-center rounded-xl bg-destructive py-3"
                  >
                    <Text className="text-sm font-semibold text-white">
                      Удалить
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => setConfirmDelete(true)}
                  className="flex-row items-center justify-center gap-2 rounded-2xl bg-card py-3"
                  style={{
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.12,
                    shadowRadius: 8,
                    elevation: 5,
                  }}
                >
                  <Trash2 size={17} color="#ef4444" />
                  <Text className="text-sm font-semibold text-destructive">
                    Удалить из сохранённых
                  </Text>
                </Pressable>
              )
            ) : null}

            <Pressable
              onPress={handleSave}
              disabled={!canSave}
              className={`flex-row items-center justify-center gap-2 rounded-2xl py-4 ${canSave ? 'bg-primary' : 'bg-muted'}`}
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: canSave ? 0.18 : 0,
                shadowRadius: 8,
                elevation: canSave ? 6 : 0,
              }}
            >
              <Check size={18} color={canSave ? '#fff' : '#9ca3af'} />
              <Text
                className={`text-base font-bold ${canSave ? 'text-white' : 'text-muted-foreground'}`}
              >
                Выбрать текущий адрес
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}
