import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Check, Sparkles, X } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import type { MapRegion } from '@/components/MapView.types';

interface DrawCanvasProps {
  region: MapRegion;
  onCancel: () => void;
  onConfirm: (coords: { latitude: number; longitude: number }[]) => void;
  onRegionChange?: (region: MapRegion) => void;
  processing?: boolean;
  partial?: boolean;
}

/**
 * Web implementation of the draw overlay.
 *
 * Gesture model:
 * - 1 finger / left mouse button → draw (captured, doesn't pan the map)
 * - 2 fingers → pinch-zoom map (pass through)
 * - Mouse wheel → zoom map (pass through)
 * - Middle / right mouse button → pan the map (pass through)
 *
 * We achieve this by placing a transparent DOM div on top of the map with
 * `pointer-events: auto` but intercepting only primary-button / single-touch
 * pointer events. Wheel events are never captured, so they reach the map.
 * On `touchstart` with 2+ fingers we forward that touch event to the map
 * underneath by briefly disabling our overlay's pointer events.
 */
export function DrawCanvas({
  region,
  onCancel,
  onConfirm,
  processing,
  partial,
}: DrawCanvasProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [strokes, setStrokes] = useState<
    { latitude: number; longitude: number }[][]
  >([]);
  const currentStrokeRef = useRef<{ x: number; y: number }[]>([]);
  const [currentStrokePx, setCurrentStrokePx] = useState<
    { x: number; y: number }[]
  >([]);
  const drawingPointerId = useRef<number | null>(null);

  // Measure our own size; we're absolute-positioned so ResizeObserver works
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ width: r.width, height: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pxToLatLng = useCallback(
    (x: number, y: number) => {
      const { width, height } = size;
      if (!width || !height) return { latitude: 0, longitude: 0 };
      // Web Mercator — matches pigeon-maps / Leaflet so drawn strokes stay
      // anchored when the map pans or zooms.
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

  // --- Pointer handlers --------------------------------------------------

  const getLocal = (ev: PointerEvent) => {
    const el = overlayRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };

  // Attach global pointer listeners so drawing continues even if the pointer
  // leaves the overlay.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    const onPointerDown = (ev: PointerEvent) => {
      // Only single primary-button / single-finger touches start drawing.
      // Let wheel, middle/right button, and multi-touch fall through to map.
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      // For touch: if there is another active pointer, this is a 2nd finger —
      // abort current stroke so pinch/pan can reach the map.
      if (ev.pointerType === 'touch' && drawingPointerId.current !== null) {
        cancelStroke();
        return;
      }
      drawingPointerId.current = ev.pointerId;
      const p = getLocal(ev);
      currentStrokeRef.current = [p];
      setCurrentStrokePx([p]);
      try {
        el.setPointerCapture(ev.pointerId);
      } catch {
        // ignore
      }
      ev.preventDefault();
      ev.stopPropagation();
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (drawingPointerId.current !== ev.pointerId) return;
      const p = getLocal(ev);
      const last = currentStrokeRef.current[currentStrokeRef.current.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 2) return;
      currentStrokeRef.current.push(p);
      setCurrentStrokePx([...currentStrokeRef.current]);
      ev.preventDefault();
      ev.stopPropagation();
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (drawingPointerId.current !== ev.pointerId) return;
      drawingPointerId.current = null;
      commitStroke();
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch {
        // ignore
      }
    };

    const cancelStroke = () => {
      drawingPointerId.current = null;
      currentStrokeRef.current = [];
      setCurrentStrokePx([]);
    };

    const commitStroke = () => {
      if (currentStrokeRef.current.length < 2) {
        currentStrokeRef.current = [];
        setCurrentStrokePx([]);
        return;
      }
      const latlng = currentStrokeRef.current.map((p) =>
        pxToLatLng(p.x, p.y),
      );
      setStrokes((prev) => [...prev, latlng]);
      currentStrokeRef.current = [];
      setCurrentStrokePx([]);
    };

    // Listen for 2-finger touches on the overlay to immediately abort the
    // current stroke (so the pinch reaches the map through our forwarding
    // logic below).
    const onTouchStart = (ev: TouchEvent) => {
      if (ev.touches.length >= 2) {
        cancelStroke();
      }
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('touchstart', onTouchStart, { passive: true });

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('touchstart', onTouchStart);
    };
  }, [pxToLatLng]);

  // Forward wheel events straight through to the map below. We do this by
  // keeping our overlay's `touch-action: none` on the drawing layer, but the
  // overlay's CSS `pointer-events` is set to `auto` only on single-pointer
  // gestures — wheel events already bypass it because the overlay uses
  // `pointer-events: auto` and we don't capture wheel. Actually, wheel will
  // land on our overlay first. So we listen for wheel and redispatch.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      // Find the element directly beneath our overlay at the same point,
      // then forward the wheel to it so the map zooms.
      const prevPE = el.style.pointerEvents;
      el.style.pointerEvents = 'none';
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      el.style.pointerEvents = prevPE;
      if (target && target !== el) {
        const forwarded = new WheelEvent('wheel', {
          deltaX: ev.deltaX,
          deltaY: ev.deltaY,
          deltaZ: ev.deltaZ,
          deltaMode: ev.deltaMode,
          clientX: ev.clientX,
          clientY: ev.clientY,
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(forwarded);
      }
      ev.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // --- Actions -----------------------------------------------------------

  const handleConfirm = () => {
    const flat = strokes.flat();
    const extra = currentStrokeRef.current.map((p) =>
      pxToLatLng(p.x, p.y),
    );
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
    >
      {/* Tint (non-interactive) */}
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

      {/* Capture layer — DOM div. Accepts single-finger draws, forwards wheel
          to the map, allows 2-finger pinch to pass through by aborting the
          stroke on multi-touch. */}
      {/* eslint-disable-next-line react/forbid-dom-props */}
      <div
        ref={overlayRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          // Single pointer events → us. Pinch is deferred to map by our
          // touchstart handler above.
          touchAction: 'none',
          cursor: 'crosshair',
          zIndex: 5,
        }}
      />

      {/* SVG rendering of strokes (non-interactive) */}
      {size.width > 0 && (committedSvgPath || currentSvgPath) ? (
        /* eslint-disable-next-line react/forbid-dom-props */
        <svg
          width={size.width}
          height={size.height}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            pointerEvents: 'none',
            zIndex: 6,
          }}
        >
          {committedSvgPath ? (
            <path
              d={committedSvgPath}
              stroke="#2563eb"
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ) : null}
          {currentSvgPath ? (
            <path
              d={currentSvgPath}
              stroke="#2563eb"
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ) : null}
        </svg>
      ) : null}

      {/* Top hint */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', top: 16, left: 16, right: 16, zIndex: 10 }}
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
              ? partial
                ? 'ИИ подстроит линию под реальные дороги. Можете нарисовать часть или весь маршрут'
                : 'ИИ подстроит линию под реальные дороги'
              : partial
                ? 'Нарисуйте часть или весь маршрут до точки. ИИ подстроит под дороги'
                : 'Рисуйте одним пальцем · двумя — двигайте, колёсико — зум'}
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
          zIndex: 10,
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
