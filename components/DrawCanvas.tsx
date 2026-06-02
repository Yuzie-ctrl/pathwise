import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Check, Eraser, Pencil, Sparkles, X } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import type { MapRegion } from '@/components/MapView.types';

type LatLng = { latitude: number; longitude: number };

interface DrawCanvasProps {
  region: MapRegion;
  onCancel: () => void;
  onConfirm: (coords: LatLng[]) => void;
  /** Receives each drawn stroke separately so gaps can be road-routed. */
  onConfirmStrokes?: (strokes: LatLng[][]) => void;
  onRegionChange?: (region: MapRegion) => void;
  processing?: boolean;
  /** When true, the drawing will be used as a partial route to the current destination. */
  partial?: boolean;
  /** Preload existing drawn strokes for editing. */
  initialStrokes?: LatLng[][];
  /** Called when the user confirms with NO strokes left (erased everything)
   *  while editing — lets the parent drop all drawn overrides. */
  onClearAll?: () => void;
}

const STROKE_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#0891b2',
];

/**
 * Native draw overlay.
 *
 * Gesture rules:
 * - 1 finger → draw (PanResponder grabs).
 * - 2+ fingers → overlay releases the responder and cancels the stroke so
 *   the underlying Leaflet WebView receives pinch-zoom / two-finger pan.
 *
 * Strokes are stored in lat/lng so they stay anchored when the map is moved.
 *
 * Eraser mode: instead of clearing everything, the user lassos an area; any
 * stroke whose points fall inside the lasso polygon is removed.
 *
 * Each committed stroke is numbered; tapping the number lets the user change
 * that stroke's order in the route.
 */
export function DrawCanvas({
  region,
  onCancel,
  onConfirm,
  onConfirmStrokes,
  processing,
  partial,
  initialStrokes,
  onClearAll,
}: DrawCanvasProps) {
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [strokes, setStrokes] = useState<LatLng[][]>(initialStrokes ?? []);
  const seededRef = useRef(false);
  useEffect(() => {
    if (!seededRef.current && initialStrokes && initialStrokes.length) {
      setStrokes(initialStrokes);
      seededRef.current = true;
    }
  }, [initialStrokes]);

  const [mode, setMode] = useState<'draw' | 'erase'>('draw');
  const currentStrokeRef = useRef<{ x: number; y: number }[]>([]);
  const [currentStrokePx, setCurrentStrokePx] = useState<
    { x: number; y: number }[]
  >([]);
  // Lasso (erase) capture in px.
  const lassoRef = useRef<{ x: number; y: number }[]>([]);
  const [lassoPx, setLassoPx] = useState<{ x: number; y: number }[]>([]);
  // Reorder modal state.
  const [reorderIdx, setReorderIdx] = useState<number | null>(null);

  const onLayout = (e: LayoutChangeEvent) => {
    setSize({
      width: e.nativeEvent.layout.width,
      height: e.nativeEvent.layout.height,
    });
  };

  const pxToLatLng = useCallback(
    (x: number, y: number): LatLng => {
      const { width, height } = size;
      if (!width || !height) return { latitude: 0, longitude: 0 };
      const { latitude, longitude, latitudeDelta } = region;
      const tileSize = 256;
      const zoom = Math.log2(360 / latitudeDelta);
      const scale = Math.pow(2, zoom) * tileSize;
      const sinC = Math.sin((latitude * Math.PI) / 180);
      const cxWorld = ((longitude + 180) / 360) * scale;
      const cyWorld =
        (0.5 - Math.log((1 + sinC) / (1 - sinC)) / (4 * Math.PI)) * scale;
      const worldX = cxWorld + (x - width / 2);
      const worldY = cyWorld + (y - height / 2);
      const lng = (worldX / scale) * 360 - 180;
      const n = Math.PI - (2 * Math.PI * worldY) / scale;
      const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
      return { latitude: lat, longitude: lng };
    },
    [region, size],
  );

  const latLngToPx = useCallback(
    (lat: number, lng: number) => {
      const { width, height } = size;
      if (!width || !height) return { x: 0, y: 0 };
      const { latitude, longitude, latitudeDelta } = region;
      const tileSize = 256;
      const zoom = Math.log2(360 / latitudeDelta);
      const scale = Math.pow(2, zoom) * tileSize;
      const project = (la: number, ln: number) => {
        const sin = Math.sin((la * Math.PI) / 180);
        const px = ((ln + 180) / 360) * scale;
        const py =
          (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
        return [px, py] as const;
      };
      const [cx, cy] = project(latitude, longitude);
      const [px, py] = project(lat, lng);
      return { x: px - cx + width / 2, y: py - cy + height / 2 };
    },
    [region, size],
  );

  const hasDrawn = strokes.length > 0 || currentStrokePx.length > 0;

  const commitStroke = useCallback(() => {
    if (mode === 'erase') {
      // Finalize lasso erase.
      const poly = lassoRef.current.slice();
      lassoRef.current = [];
      setLassoPx([]);
      if (poly.length < 3) return;
      setStrokes((prev) =>
        prev.filter((stroke) => {
          // Remove a stroke if a meaningful fraction of its points lie inside.
          let inside = 0;
          for (const pt of stroke) {
            const px = latLngToPx(pt.latitude, pt.longitude);
            if (pointInPolygon(px, poly)) inside++;
          }
          return inside / stroke.length < 0.4;
        }),
      );
      return;
    }
    if (currentStrokeRef.current.length < 2) {
      currentStrokeRef.current = [];
      setCurrentStrokePx([]);
      return;
    }
    const latlng = currentStrokeRef.current.map((p) => pxToLatLng(p.x, p.y));
    setStrokes((prev) => [...prev, latlng]);
    currentStrokeRef.current = [];
    setCurrentStrokePx([]);
  }, [mode, pxToLatLng, latLngToPx]);

  const cancelStroke = () => {
    currentStrokeRef.current = [];
    setCurrentStrokePx([]);
    lassoRef.current = [];
    setLassoPx([]);
  };

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
          if (mode === 'erase') {
            lassoRef.current = [{ x: locationX, y: locationY }];
            setLassoPx([{ x: locationX, y: locationY }]);
          } else {
            currentStrokeRef.current = [{ x: locationX, y: locationY }];
            setCurrentStrokePx([{ x: locationX, y: locationY }]);
          }
        },
        onPanResponderMove: (e) => {
          if (e.nativeEvent.touches.length > 1) {
            cancelStroke();
            return;
          }
          const { locationX, locationY } = e.nativeEvent;
          const buf = mode === 'erase' ? lassoRef.current : currentStrokeRef.current;
          const last = buf[buf.length - 1];
          if (last && Math.hypot(locationX - last.x, locationY - last.y) < 3)
            return;
          buf.push({ x: locationX, y: locationY });
          if (mode === 'erase') setLassoPx([...buf]);
          else setCurrentStrokePx([...buf]);
        },
        onPanResponderRelease: commitStroke,
        onPanResponderTerminate: commitStroke,
      }),
    [commitStroke, mode],
  );

  const handleConfirm = () => {
    const extra = currentStrokeRef.current.map((p) => pxToLatLng(p.x, p.y));
    const allStrokes = [...strokes];
    if (extra.length >= 2) allStrokes.push(extra);
    const usable = allStrokes.filter((s) => s.length >= 2);
    if (usable.length === 0) {
      // Nothing left — if we started from an existing route (editing), this
      // means "erase everything"; let the parent drop all drawn overrides.
      if (seededRef.current && onClearAll) {
        onClearAll();
      }
      return;
    }
    if (onConfirmStrokes) {
      onConfirmStrokes(usable);
      return;
    }
    const all = usable.flat();
    if (all.length < 2) return;
    onConfirm(all);
  };

  const moveStrokeTo = (from: number, to: number) => {
    setStrokes((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = prev.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    setReorderIdx(null);
  };

  // Per-stroke svg path + label anchor.
  const strokePaths = useMemo(() => {
    if (!size.width || !size.height) return [];
    return strokes.map((stroke) => {
      const pts = stroke.map((pt) => latLngToPx(pt.latitude, pt.longitude));
      const d = pts
        .map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(' ');
      const mid = pts[Math.floor(pts.length / 2)] ?? { x: 0, y: 0 };
      return { d, label: mid };
    });
  }, [strokes, latLngToPx, size.width, size.height]);

  const currentSvgPath = useMemo(() => {
    if (currentStrokePx.length === 0) return '';
    return currentStrokePx
      .map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
      .join(' ');
  }, [currentStrokePx]);

  const lassoSvgPath = useMemo(() => {
    if (lassoPx.length < 2) return '';
    return (
      lassoPx
        .map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
        .join(' ') + ' Z'
    );
  }, [lassoPx]);

  return (
    <View
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      pointerEvents="box-none"
      onLayout={onLayout}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor:
            mode === 'erase' ? 'rgba(220,38,38,0.04)' : 'rgba(37, 99, 235, 0.03)',
        }}
      />

      <View
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        {...panResponder.panHandlers}
      />

      {size.width > 0 ? (
        <Svg
          width={size.width}
          height={size.height}
          style={{ position: 'absolute', top: 0, left: 0 }}
          pointerEvents="none"
        >
          {strokePaths.map((sp, idx) => (
            <Path
              key={`s${idx}`}
              d={sp.d}
              stroke={STROKE_COLORS[idx % STROKE_COLORS.length]}
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              opacity={mode === 'erase' ? 0.55 : 1}
            />
          ))}
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
          {lassoSvgPath ? (
            <Path
              d={lassoSvgPath}
              stroke="#dc2626"
              strokeWidth={2}
              strokeDasharray="6 5"
              fill="rgba(220,38,38,0.10)"
            />
          ) : null}
          {/* Stroke number badges */}
          {strokePaths.map((sp, idx) => (
            <Circle
              key={`c${idx}`}
              cx={sp.label.x}
              cy={sp.label.y}
              r={12}
              fill={STROKE_COLORS[idx % STROKE_COLORS.length]}
            />
          ))}
        </Svg>
      ) : null}

      {/* Number badges. In draw mode they are tappable (reorder); in erase
          mode they are non-interactive but the digit must still be visible. */}
      {strokePaths.map((sp, idx) => (
        <Pressable
          key={`b${idx}`}
          onPress={mode === 'draw' ? () => setReorderIdx(idx) : undefined}
          pointerEvents={mode === 'draw' ? 'auto' : 'none'}
          style={{
            position: 'absolute',
            left: sp.label.x - 16,
            top: sp.label.y - 16,
            width: 32,
            height: 32,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text className="text-xs font-bold" style={{ color: '#fff' }}>
            {idx + 1}
          </Text>
        </Pressable>
      ))}

      {/* Top instruction banner */}
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
          <Sparkles size={16} color={mode === 'erase' ? '#dc2626' : '#2563eb'} />
          <Text className="flex-1 text-sm text-foreground">
            {mode === 'erase'
              ? 'Обведите участок — линии внутри удалятся, остальные останутся'
              : hasDrawn
                ? 'ИИ подстроит линии под дороги и соединит части по дорогам'
                : partial
                  ? 'Нарисуйте часть или весь маршрут (можно несколькими линиями)'
                  : 'Рисуйте одним пальцем (можно несколько линий), двумя — двигайте карту'}
          </Text>
        </View>
      </View>

      {/* Bottom controls */}
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
          className="flex-row items-center justify-center gap-2 rounded-2xl bg-card px-4 py-3"
          style={btnShadow}
        >
          <X size={18} color="#444" />
        </Pressable>

        {/* Draw / Erase toggle */}
        <Pressable
          onPress={() => setMode((m) => (m === 'draw' ? 'erase' : 'draw'))}
          disabled={!hasDrawn && mode === 'draw'}
          className={`flex-row items-center justify-center gap-2 rounded-2xl px-4 py-3 ${
            mode === 'erase' ? 'bg-destructive' : 'bg-card'
          }`}
          style={btnShadow}
        >
          {mode === 'erase' ? (
            <>
              <Pencil size={18} color="#fff" />
              <Text className="text-sm font-medium" style={{ color: '#fff' }}>
                Рисовать
              </Text>
            </>
          ) : (
            <>
              <Eraser size={18} color="#444" />
              <Text className="text-sm font-medium text-foreground">Стереть</Text>
            </>
          )}
        </Pressable>

        <Pressable
          onPress={handleConfirm}
          disabled={(!hasDrawn && !(seededRef.current && !!onClearAll)) || processing}
          className={`flex-1 flex-row items-center justify-center gap-2 rounded-2xl py-3 ${
            (hasDrawn || (seededRef.current && !!onClearAll)) && !processing ? 'bg-primary' : 'bg-muted'
          }`}
          style={btnShadow}
        >
          <Check size={18} color={(hasDrawn || (seededRef.current && !!onClearAll)) && !processing ? '#fff' : '#999'} />
          <Text
            className={`text-base font-semibold ${
              (hasDrawn || (seededRef.current && !!onClearAll)) && !processing
                ? 'text-primary-foreground'
                : 'text-muted-foreground'
            }`}
          >
            {processing ? 'Обработка…' : 'Готово'}
          </Text>
        </Pressable>
      </View>

      {/* Reorder modal */}
      <Modal
        visible={reorderIdx !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setReorderIdx(null)}
      >
        <Pressable
          className="flex-1 items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
          onPress={() => setReorderIdx(null)}
        >
          <Pressable
            className="w-72 rounded-2xl bg-card p-4"
            onPress={(e) => e.stopPropagation()}
          >
            <Text className="mb-1 text-base font-semibold text-foreground">
              Линия {reorderIdx !== null ? reorderIdx + 1 : ''}
            </Text>
            <Text className="mb-3 text-sm text-muted-foreground">
              Выберите новый номер для этой линии
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {strokes.map((_, i) => (
                <Pressable
                  key={i}
                  onPress={() =>
                    reorderIdx !== null && moveStrokeTo(reorderIdx, i)
                  }
                  className={`h-11 w-11 items-center justify-center rounded-xl ${
                    reorderIdx === i ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <Text
                    className={`text-base font-semibold ${
                      reorderIdx === i
                        ? 'text-primary-foreground'
                        : 'text-foreground'
                    }`}
                  >
                    {i + 1}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const btnShadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.12,
  shadowRadius: 8,
  elevation: 4,
} as const;

/** Ray-casting point-in-polygon test. */
function pointInPolygon(
  pt: { x: number; y: number },
  poly: { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
