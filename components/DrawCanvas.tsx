import { useCallback, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  View,
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
  onRegionChange?: (region: MapRegion) => void;
  processing?: boolean;
}

/**
 * Native draw overlay.
 *
 * Gesture rules:
 * - 1 finger → draw (PanResponder grabs).
 * - 2+ fingers → overlay releases the responder and cancels the stroke so
 *   the underlying Leaflet WebView receives pinch-zoom / two-finger pan.
 *
 * Strokes are stored in lat/lng so they stay anchored when the map is moved.
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
  const [strokes, setStrokes] = useState<
    { latitude: number; longitude: number }[][]
  >([]);
  const currentStrokeRef = useRef<{ x: number; y: number }[]>([]);
  const [currentStrokePx, setCurrentStrokePx] = useState<
    { x: number; y: number }[]
  >([]);

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

  const latLngToPx = useCallback(
    (lat: number, lng: number) => {
      const { width, height } = size;
      if (!width || !height) return { x: 0, y: 0 };
      const { latitude, longitude, latitudeDelta, longitudeDelta } = region;
      const x = ((lng - longitude) / longitudeDelta) * width + width / 2;
      const y = ((latitude - lat) / latitudeDelta) * height + height / 2;
      return { x, y };
    },
    [region, size],
  );

  const hasDrawn = strokes.length > 0 || currentStrokePx.length > 0;

  const commitStroke = useCallback(() => {
    if (currentStrokeRef.current.length < 2) {
      currentStrokeRef.current = [];
      setCurrentStrokePx([]);
      return;
    }
    const latlng = currentStrokeRef.current.map((p) => pxToLatLng(p.x, p.y));
    setStrokes((prev) => [...prev, latlng]);
    currentStrokeRef.current = [];
    setCurrentStrokePx([]);
  }, [pxToLatLng]);

  const cancelStroke = () => {
    currentStrokeRef.current = [];
    setCurrentStrokePx([]);
  };

  // PanResponder: only grab single-finger gestures. Release when a 2nd
  // finger lands so the map underneath handles pinch/pan.
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (e) =>
          e.nativeEvent.touches.length === 1,
        onMoveShouldSetPanResponder: (e) =>
          e.nativeEvent.touches.length === 1,
        onPanResponderTerminationRequest: () => true,
        onPanResponderGrant: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          currentStrokeRef.current = [{ x: locationX, y: locationY }];
          setCurrentStrokePx([{ x: locationX, y: locationY }]);
        },
        onPanResponderMove: (e) => {
          if (e.nativeEvent.touches.length > 1) {
            cancelStroke();
            return;
          }
          const { locationX, locationY } = e.nativeEvent;
          const last =
            currentStrokeRef.current[currentStrokeRef.current.length - 1];
          if (last && Math.hypot(locationX - last.x, locationY - last.y) < 3)
            return;
          currentStrokeRef.current.push({ x: locationX, y: locationY });
          setCurrentStrokePx([...currentStrokeRef.current]);
        },
        onPanResponderRelease: commitStroke,
        onPanResponderTerminate: commitStroke,
      }),
    [commitStroke],
  );

  const handleConfirm = () => {
    const flat = strokes.flat();
    const extra = currentStrokeRef.current.map((p) => pxToLatLng(p.x, p.y));
    const all = [...flat, ...extra];
    if (all.length < 2) return;
    onConfirm(all);
  };

  const handleClear = () => {
    currentStrokeRef.current = [];
    setCurrentStrokePx([]);
    setStrokes([]);
  };

  const committedSvgPath = useMemo(() => {
    if (!size.width || !size.height) return '';
    return strokes
      .map((stroke) =>
        stroke
          .map((pt, idx) => {
            const { x, y } = latLngToPx(pt.latitude, pt.longitude);
            return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' '),
      )
      .join(' ');
  }, [strokes, latLngToPx, size.width, size.height]);

  const currentSvgPath = useMemo(() => {
    if (currentStrokePx.length === 0) return '';
    return currentStrokePx
      .map(
        (pt, idx) =>
          `${idx === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`,
      )
      .join(' ');
  }, [currentStrokePx]);

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }}
      pointerEvents="box-none"
      onLayout={onLayout}
    >
      {/* Faint tint */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(37, 99, 235, 0.03)',
        }}
      />

      {/* Gesture capture */}
      <View
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        {...panResponder.panHandlers}
      />

      {size.width > 0 && (committedSvgPath || currentSvgPath) ? (
        <Svg
          width={size.width}
          height={size.height}
          style={{ position: 'absolute', top: 0, left: 0 }}
          pointerEvents="none"
        >
          {committedSvgPath ? (
            <Path
              d={committedSvgPath}
              stroke="#2563eb"
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ) : null}
          {currentSvgPath ? (
            <Path
              d={currentSvgPath}
              stroke="#2563eb"
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ) : null}
        </Svg>
      ) : null}

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
              ? 'ИИ построит маршрут строго по вашей линии'
              : 'Одним пальцем — рисуйте, двумя — двигайте и приближайте'}
          </Text>
        </View>
      </View>

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
            <Text className="text-base font-medium text-foreground">
              Стереть
            </Text>
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
