import { useCallback, useRef, useState } from 'react';
import {
  Pressable,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Check, Sparkles, X } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import type { MapRegion } from '@/components/MapView.types';

interface DrawCanvasProps {
  region: MapRegion;
  onCancel: () => void;
  onConfirm: (coords: { latitude: number; longitude: number }[]) => void;
  processing?: boolean;
}

/**
 * Overlay canvas for freehand drawing on top of the map. Captures pointer
 * events and converts pixel coordinates into lat/lng using the current map
 * region (equirectangular approximation — good enough at typical city-zoom
 * scales for drawing input).
 */
export function DrawCanvas({
  region,
  onCancel,
  onConfirm,
  processing,
}: DrawCanvasProps) {
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [svgPath, setSvgPath] = useState('');
  const pathRef = useRef<{ x: number; y: number }[]>([]);
  const [hasDrawn, setHasDrawn] = useState(false);

  const onLayout = (e: LayoutChangeEvent) => {
    setSize({
      width: e.nativeEvent.layout.width,
      height: e.nativeEvent.layout.height,
    });
  };

  const pxToLatLng = useCallback(
    (x: number, y: number) => {
      const { width, height } = size;
      if (!width || !height) return { latitude: 0, longitude: 0 };
      const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
      const lng = longitude + ((x - width / 2) / width) * longitudeDelta;
      const lat = latitude - ((y - height / 2) / height) * latitudeDelta;
      return { latitude: lat, longitude: lng };
    },
    [region, size],
  );

  const handleStart = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    pathRef.current = [{ x: locationX, y: locationY }];
    setSvgPath(`M${locationX.toFixed(1)},${locationY.toFixed(1)}`);
    setHasDrawn(true);
  };

  const handleMove = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    const last = pathRef.current[pathRef.current.length - 1];
    if (last && Math.hypot(locationX - last.x, locationY - last.y) < 3) return;
    pathRef.current.push({ x: locationX, y: locationY });
    setSvgPath(
      (prev) => `${prev} L${locationX.toFixed(1)},${locationY.toFixed(1)}`,
    );
  };

  const handleConfirm = () => {
    if (pathRef.current.length < 2) return;
    const coords = pathRef.current.map((p) => pxToLatLng(p.x, p.y));
    onConfirm(coords);
  };

  const handleClear = () => {
    pathRef.current = [];
    setSvgPath('');
    setHasDrawn(false);
  };

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }}
      onLayout={onLayout}
    >
      {/* Semi-transparent tint so user knows they're in draw mode */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(37, 99, 235, 0.04)',
        }}
      />

      {/* Gesture capture */}
      <View
        style={{ flex: 1 }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={handleStart}
        onResponderMove={handleMove}
      >
        {size.width > 0 ? (
          <Svg
            width={size.width}
            height={size.height}
            style={{ position: 'absolute', top: 0, left: 0 }}
            pointerEvents="none"
          >
            {svgPath ? (
              <Path
                d={svgPath}
                stroke="#2563eb"
                strokeWidth={5}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ) : null}
          </Svg>
        ) : null}
      </View>

      {/* Top hint */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', top: 16, left: 16, right: 16 }}
      >
        <View
          className="flex-row items-center gap-2 rounded-2xl bg-card px-4 py-3"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.12,
            shadowRadius: 8,
            elevation: 6,
          }}
        >
          <Sparkles size={16} color="#2563eb" />
          <Text className="flex-1 text-sm text-foreground">
            {hasDrawn
              ? 'ИИ подстроит маршрут под дороги'
              : 'Нарисуйте маршрут пальцем по карте'}
          </Text>
        </View>
      </View>

      {/* Bottom actions */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: 24,
          left: 16,
          right: 16,
          flexDirection: 'row',
          gap: 12,
        }}
      >
        <Pressable
          onPress={onCancel}
          className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-card py-3"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.12,
            shadowRadius: 8,
            elevation: 4,
          }}
        >
          <X size={18} color="#444" />
          <Text className="text-base font-medium text-foreground">Отмена</Text>
        </Pressable>
        {hasDrawn ? (
          <Pressable
            onPress={handleClear}
            className="flex-row items-center justify-center gap-2 rounded-2xl bg-card px-4 py-3"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.12,
              shadowRadius: 8,
              elevation: 4,
            }}
          >
            <Text className="text-base font-medium text-foreground">Стереть</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={handleConfirm}
          disabled={!hasDrawn || processing}
          className={`flex-1 flex-row items-center justify-center gap-2 rounded-2xl py-3 ${
            hasDrawn && !processing ? 'bg-primary' : 'bg-muted'
          }`}
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.18,
            shadowRadius: 8,
            elevation: 4,
          }}
        >
          <Check size={18} color={hasDrawn && !processing ? '#fff' : '#999'} />
          <Text
            className={`text-base font-semibold ${
              hasDrawn && !processing
                ? 'text-primary-foreground'
                : 'text-muted-foreground'
            }`}
          >
            {processing ? 'Обработка…' : 'Готово'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
