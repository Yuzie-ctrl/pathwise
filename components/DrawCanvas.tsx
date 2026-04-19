import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Check, Hand, Pencil, Sparkles, X } from 'lucide-react-native';

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
 * Overlay canvas for freehand drawing on top of the map. Supports two modes:
 * - draw: single-finger gestures are captured and turned into a polyline.
 *   Multi-touch (2+ fingers) falls through to the map so users can pinch-zoom
 *   without leaving draw mode.
 * - pan: canvas lets all gestures through to the map so users can freely pan
 *   and zoom. Tap the pencil button to return to drawing.
 *
 * The drawn path is stored in lat/lng so that when the user pans/zooms the
 * map, the existing strokes stay anchored to real-world positions (they are
 * re-projected to pixel coordinates on every render).
 */
export function DrawCanvas({
  region,
  onCancel,
  onConfirm,
  onRegionChange: _onRegionChange,
  processing,
}: DrawCanvasProps) {
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  // Stored in lat/lng so strokes stay anchored when the map is panned/zoomed.
  const [strokes, setStrokes] = useState<
    { latitude: number; longitude: number }[][]
  >([]);
  const currentStrokeRef = useRef<{ x: number; y: number }[]>([]);
  const [currentStrokePx, setCurrentStrokePx] = useState<
    { x: number; y: number }[]
  >([]);
  const [mode, setMode] = useState<'draw' | 'pan'>('draw');

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

  // --- Gesture handling --------------------------------------------------

  // Only claim the responder for single-finger gestures in draw mode.
  const shouldSetResponder = (e: GestureResponderEvent) => {
    if (mode !== 'draw') return false;
    if (e.nativeEvent.touches && e.nativeEvent.touches.length > 1) return false;
    return true;
  };

  const handleStart = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    currentStrokeRef.current = [{ x: locationX, y: locationY }];
    setCurrentStrokePx([{ x: locationX, y: locationY }]);
  };

  const handleMove = (e: GestureResponderEvent) => {
    // If a second finger lands, abort the stroke so the pinch-zoom gesture
    // can reach the underlying map on the next grant.
    if (e.nativeEvent.touches && e.nativeEvent.touches.length > 1) {
      currentStrokeRef.current = [];
      setCurrentStrokePx([]);
      return;
    }
    const { locationX, locationY } = e.nativeEvent;
    const last = currentStrokeRef.current[currentStrokeRef.current.length - 1];
    if (last && Math.hypot(locationX - last.x, locationY - last.y) < 3) return;
    currentStrokeRef.current.push({ x: locationX, y: locationY });
    setCurrentStrokePx([...currentStrokeRef.current]);
  };

  const commitStroke = () => {
    if (currentStrokeRef.current.length < 2) {
      currentStrokeRef.current = [];
      setCurrentStrokePx([]);
      return;
    }
    const latlng = currentStrokeRef.current.map((p) => pxToLatLng(p.x, p.y));
    setStrokes((prev) => [...prev, latlng]);
    currentStrokeRef.current = [];
    setCurrentStrokePx([]);
  };

  const handleRelease = () => commitStroke();
  const handleTerminate = () => commitStroke();

  const handleConfirm = () => {
    // Flatten all strokes into a single polyline (in draw order). Single
    // stroke is the common case.
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

  // --- Render ------------------------------------------------------------

  // Re-project all stored (lat/lng) strokes to the current pixel grid.
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
      // In pan mode the whole overlay becomes transparent to touches (except
      // the floating UI buttons, which opt back in via their own views).
      pointerEvents="box-none"
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
          backgroundColor:
            mode === 'draw'
              ? 'rgba(37, 99, 235, 0.04)'
              : 'rgba(37, 99, 235, 0.015)',
        }}
      />

      {/* Gesture capture — only active in draw mode */}
      {mode === 'draw' ? (
        <View
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          onStartShouldSetResponder={shouldSetResponder}
          onMoveShouldSetResponder={shouldSetResponder}
          onResponderGrant={handleStart}
          onResponderMove={handleMove}
          onResponderRelease={handleRelease}
          onResponderTerminate={handleTerminate}
          onResponderTerminationRequest={() => true}
        />
      ) : null}

      {/* SVG overlay — always on, renders strokes regardless of mode */}
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
            {mode === 'pan'
              ? 'Двигайте и приближайте карту — рисунок останется на месте'
              : hasDrawn
                ? 'ИИ подстроит маршрут под дороги · двумя пальцами можно зумить'
                : 'Рисуйте пальцем · двумя пальцами — зум, или переключитесь в «двигать»'}
          </Text>
        </View>
      </View>

      {/* Mode toggle (right side) */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          right: 16,
          top: 80,
          gap: 8,
        }}
      >
        <Pressable
          onPress={() => setMode((m) => (m === 'draw' ? 'pan' : 'draw'))}
          className="h-12 w-12 items-center justify-center rounded-full bg-card active:bg-muted"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.18,
            shadowRadius: 6,
            elevation: 6,
            backgroundColor: mode === 'draw' ? '#2563eb' : '#ffffff',
          }}
          accessibilityLabel={
            mode === 'draw'
              ? 'Переключиться в режим движения карты'
              : 'Переключиться в режим рисования'
          }
        >
          {mode === 'draw' ? (
            <Pencil size={20} color="#ffffff" />
          ) : (
            <Hand size={20} color="#2563eb" />
          )}
        </Pressable>
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
