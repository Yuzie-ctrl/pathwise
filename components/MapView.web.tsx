import { Map, Marker } from 'pigeon-maps';
import { useCallback, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { DEFAULT_REGION } from './MapView.types';
import type { MapViewProps, MapRegion, MapType } from './MapView.types';

export type {
  MapViewProps,
  MapRegion,
  MapMarker,
  MapPolyline,
  MapPolygon,
  MapCircle,
  LatLng,
  MapPressEvent,
  MapType,
  MarkerColor,
} from './MapView.types';

function regionToCenter(
  region: MapRegion,
): [latitude: number, longitude: number] {
  return [region.latitude, region.longitude];
}

function deltaToZoom(latitudeDelta: number): number {
  return Math.round(Math.log2(360 / latitudeDelta));
}

// ---------------------------------------------------------------------------
// Tile providers
// ---------------------------------------------------------------------------
function tileProvider(mapType?: MapType) {
  if (mapType === 'satellite' || mapType === 'hybrid') {
    return (x: number, y: number, z: number) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  }
  if (mapType === 'terrain') {
    return (x: number, y: number, z: number) =>
      `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`;
  }
  return undefined; // default OSM
}

// ---------------------------------------------------------------------------
// Marker color → hue for pigeon-maps default marker
// ---------------------------------------------------------------------------
const COLOR_HUE: Record<string, number> = {
  red: 0,
  orange: 30,
  yellow: 50,
  green: 120,
  cyan: 180,
  blue: 210,
  purple: 280,
};

// ---------------------------------------------------------------------------
// Lat/Lng -> pixel conversion (Web Mercator), relative to a center/zoom pair.
// Matches pigeon-maps default 256px tile size.
// ---------------------------------------------------------------------------
function latLngToPixel(
  lat: number,
  lng: number,
  center: [number, number],
  zoom: number,
  width: number,
  height: number,
): [number, number] {
  const tileSize = 256;
  const scale = Math.pow(2, zoom);
  const project = (la: number, ln: number) => {
    const x = ((ln + 180) / 360) * tileSize * scale;
    const sin = Math.sin((la * Math.PI) / 180);
    const y =
      (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * tileSize * scale;
    return [x, y];
  };
  const [cx, cy] = project(center[0], center[1]);
  const [px, py] = project(lat, lng);
  return [px - cx + width / 2, py - cy + height / 2];
}

export default function MapView({
  initialRegion = DEFAULT_REGION,
  region,
  onRegionChange,
  onRegionChangeComplete,
  mapType = 'standard',
  markers = [],
  polylines = [],
  polygons: _polygons = [],
  circles: _circles = [],
  onPress,
  onMarkerPress,
  scrollEnabled = true,
  zoomEnabled = true,
  zoomLevel,
  minZoomLevel,
  maxZoomLevel,
  style,
  className,
}: MapViewProps) {
  const activeRegion = region ?? initialRegion;
  const center = regionToCenter(activeRegion);
  const zoom = zoomLevel ?? deltaToZoom(activeRegion.latitudeDelta);

  const [viewport, setViewport] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [currentZoom, setCurrentZoom] = useState(zoom);
  const [currentCenter, setCurrentCenter] =
    useState<[number, number]>(center);
  const lastExternalRegion = useRef<MapRegion>(activeRegion);

  // Sync controlled region → internal state
  if (
    region &&
    (region.latitude !== lastExternalRegion.current.latitude ||
      region.longitude !== lastExternalRegion.current.longitude ||
      region.latitudeDelta !== lastExternalRegion.current.latitudeDelta)
  ) {
    lastExternalRegion.current = region;
    // Defer to avoid setState-in-render warning
    queueMicrotask(() => {
      setCurrentCenter([region.latitude, region.longitude]);
      setCurrentZoom(deltaToZoom(region.latitudeDelta));
    });
  }

  const handleBoundsChange = useCallback(
    ({ center: c, zoom: z }: { center: [number, number]; zoom: number }) => {
      setCurrentCenter(c);
      setCurrentZoom(z);
      const latDelta = 360 / Math.pow(2, z);
      const newRegion: MapRegion = {
        latitude: c[0],
        longitude: c[1],
        latitudeDelta: latDelta,
        longitudeDelta: latDelta,
      };
      onRegionChange?.(newRegion);
      onRegionChangeComplete?.(newRegion);
    },
    [onRegionChange, onRegionChangeComplete],
  );

  const handleClick = useCallback(
    ({ latLng }: { latLng: [number, number] }) => {
      onPress?.({ coordinate: { latitude: latLng[0], longitude: latLng[1] } });
    },
    [onPress],
  );

  const provider = tileProvider(mapType);

  const explicitHeight =
    typeof style === 'object' && style !== null && 'height' in style
      ? (style.height as number)
      : undefined;
  // Prefer measured viewport height so a flex:1 container fills the screen.
  const mapHeight = viewport.height || explicitHeight || 400;
  const mapWidth = viewport.width || undefined;

  // Build SVG polylines
  const svgPaths = useMemo(() => {
    if (!viewport.width || !viewport.height) return null;
    return polylines.map((p, i) => {
      const d = p.coordinates
        .map((c, idx) => {
          const [x, y] = latLngToPixel(
            c.latitude,
            c.longitude,
            currentCenter,
            currentZoom,
            viewport.width,
            viewport.height,
          );
          return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
      const dash = p.lineDashPattern ? p.lineDashPattern.join(',') : undefined;
      return (
        <path
          key={p.id ?? `pl-${i}`}
          d={d}
          stroke={p.strokeColor ?? '#2563eb'}
          strokeWidth={p.strokeWidth ?? 4}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={dash}
          fill="none"
        />
      );
    });
  }, [polylines, viewport, currentCenter, currentZoom]);

  return (
    <View
      style={[{ flex: 1, overflow: 'hidden' }, style]}
      className={className}
      onLayout={(e) =>
        setViewport({
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height,
        })
      }
    >
      <Map
        center={currentCenter}
        zoom={currentZoom}
        onBoundsChanged={handleBoundsChange}
        onClick={onPress ? handleClick : undefined}
        provider={provider}
        animate
        mouseEvents={scrollEnabled}
        touchEvents={scrollEnabled}
        minZoom={minZoomLevel ?? 2}
        maxZoom={maxZoomLevel ?? 22}
        zoomSnap={zoomEnabled}
        height={mapHeight}
        width={mapWidth}
      >
        {markers
          .filter((m) => !m.badgeText && !m.badgeHtml)
          .map((marker, index) => (
            <Marker
              key={marker.id ?? index}
              anchor={[marker.coordinate.latitude, marker.coordinate.longitude]}
              color={`hsl(${COLOR_HUE[marker.color ?? 'red'] ?? 0}, 80%, 50%)`}
              onClick={
                onMarkerPress ? () => onMarkerPress(marker) : undefined
              }
            />
          ))}
      </Map>

      {/* SVG overlay for polylines — sits above tiles & pins, below badges */}
      {svgPaths && svgPaths.length > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        >
          <svg
            width={viewport.width}
            height={viewport.height}
            style={{ position: 'absolute', top: 0, left: 0 }}
          >
            {svgPaths}
          </svg>
        </View>
      ) : null}

      {/* Numbered / dwell / heading badge overlays — positioned manually on top of the SVG */}
      {viewport.width > 0
        ? markers
            .filter((m) => m.badgeText || m.badgeHtml)
            .map((marker, index) => {
              const [x, y] = latLngToPixel(
                marker.coordinate.latitude,
                marker.coordinate.longitude,
                currentCenter,
                currentZoom,
                viewport.width,
                viewport.height,
              );
              const rot = marker.rotationDegrees ?? 0;
              return (
                <View
                  key={`badge-${marker.id ?? index}`}
                  pointerEvents="box-none"
                  style={{
                    position: 'absolute',
                    left: x,
                    top: y,
                    transform: [{ translateX: -14 }, { translateY: -14 }],
                    zIndex: 1000,
                  }}
                >
                  {marker.badgeHtml ? (
                    // eslint-disable-next-line react/forbid-dom-props
                    <div
                      onClick={() => onMarkerPress?.(marker)}
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: marker.badgeHtml }}
                      style={{
                        transform: `rotate(${rot}deg)`,
                        cursor: onMarkerPress ? 'pointer' : 'default',
                        userSelect: 'none',
                      }}
                    />
                  ) : (
                    // eslint-disable-next-line react/forbid-dom-props
                    <div
                      onClick={() => onMarkerPress?.(marker)}
                      style={{
                        background: marker.badgeColor ?? '#2563eb',
                        color: '#fff',
                        border: '2px solid #fff',
                        borderRadius: 9999,
                        padding: '2px 8px',
                        minWidth: 28,
                        height: 28,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: 12,
                        boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
                        fontFamily: 'sans-serif',
                        cursor: onMarkerPress ? 'pointer' : 'default',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                        transform: `rotate(${rot}deg)`,
                      }}
                    >
                      {marker.badgeText}
                    </div>
                  )}
                </View>
              );
            })
        : null}
    </View>
  );
}
