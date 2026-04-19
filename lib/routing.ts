import type { RouteLeg, TransportMode, TripStop } from './stores/tripStore';

// ---------------------------------------------------------------------------
// Geocoding (Nominatim / OpenStreetMap)
// ---------------------------------------------------------------------------

export interface GeocodeResult {
  displayName: string;
  shortName: string;
  latitude: number;
  longitude: number;
}

export async function geocodeSearch(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', trimmed);
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '8');

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);

  const data = (await res.json()) as {
    display_name: string;
    name?: string;
    lat: string;
    lon: string;
  }[];

  return data.map((item) => ({
    displayName: item.display_name,
    shortName: item.name || item.display_name.split(',')[0],
    latitude: parseFloat(item.lat),
    longitude: parseFloat(item.lon),
  }));
}

// ---------------------------------------------------------------------------
// Routing (OSRM public demo server)
// ---------------------------------------------------------------------------

const OSRM_PROFILES: Record<TransportMode, string> = {
  walking: 'foot',
  driving: 'car',
  cycling: 'bike',
  // Public OSRM demo has no transit profile. Use car as a best-effort proxy
  // so we can still draw a bus-like route along roads.
  transit: 'car',
};

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: {
    coordinates: [number, number][]; // [lon, lat]
  };
  legs: {
    distance: number;
    duration: number;
  }[];
}

export async function fetchRoute(
  stops: TripStop[],
  mode: TransportMode,
  signal?: AbortSignal,
): Promise<RouteLeg[]> {
  if (stops.length < 2) return [];

  const profile = OSRM_PROFILES[mode];
  const coords = stops.map((s) => `${s.longitude},${s.latitude}`).join(';');

  const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Routing failed: ${res.status}`);

  const data = (await res.json()) as {
    code: string;
    routes: OsrmRoute[];
  };
  if (data.code !== 'Ok' || data.routes.length === 0) {
    throw new Error('No route found');
  }

  const route = data.routes[0];
  const allCoords = route.geometry.coordinates.map(([lon, lat]) => ({
    latitude: lat,
    longitude: lon,
  }));

  // Split the full geometry into per-leg slices proportional to each leg's
  // duration (OSRM's overview geometry is a single polyline across all waypoints).
  const totalDur = route.duration || 1;
  const legs: RouteLeg[] = [];
  let cursor = 0;
  for (let i = 0; i < route.legs.length; i++) {
    const leg = route.legs[i];
    const isLast = i === route.legs.length - 1;
    const share = leg.duration / totalDur;
    const count = isLast
      ? allCoords.length - cursor
      : Math.max(2, Math.round(allCoords.length * share));
    const end = isLast ? allCoords.length : Math.min(allCoords.length, cursor + count);
    legs.push({
      distanceMeters: leg.distance,
      durationSeconds: leg.duration,
      coordinates: allCoords.slice(cursor, Math.max(end, cursor + 2)),
    });
    cursor = end;
  }

  // For transit approximation, slow the car duration by 1.4× so the ETA feels
  // more bus-like (stops, traffic).
  if (mode === 'transit') {
    for (const l of legs) {
      l.durationSeconds = Math.round(l.durationSeconds * 1.4);
    }
  }

  return legs;
}

// ---------------------------------------------------------------------------
// Map matching (for freehand drawn routes) — OSRM /match
// ---------------------------------------------------------------------------

export interface MatchedPoint {
  latitude: number;
  longitude: number;
}

export async function matchDrawnRoute(
  points: { latitude: number; longitude: number }[],
  mode: TransportMode,
  signal?: AbortSignal,
): Promise<MatchedPoint[]> {
  if (points.length < 2) return points;
  // OSRM /match accepts at most ~100 points; downsample if needed
  const sampled = downsample(points, 80);
  const profile = OSRM_PROFILES[mode];
  const coords = sampled.map((p) => `${p.longitude},${p.latitude}`).join(';');
  const url = `https://router.project-osrm.org/match/v1/${profile}/${coords}?overview=full&geometries=geojson&radiuses=${sampled.map(() => 50).join(';')}`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Match failed: ${res.status}`);
    const data = (await res.json()) as {
      code: string;
      matchings?: { geometry: { coordinates: [number, number][] } }[];
    };
    if (data.code !== 'Ok' || !data.matchings?.length) throw new Error('No match');
    const result: MatchedPoint[] = [];
    for (const m of data.matchings) {
      for (const [lon, lat] of m.geometry.coordinates) {
        result.push({ latitude: lat, longitude: lon });
      }
    }
    return result;
  } catch {
    // Fallback to raw path
    return sampled;
  }
}

function downsample<T>(arr: T[], maxCount: number): T[] {
  if (arr.length <= maxCount) return arr;
  const step = arr.length / maxCount;
  const out: T[] = [];
  for (let i = 0; i < maxCount; i++) out.push(arr[Math.floor(i * step)]);
  out.push(arr[arr.length - 1]);
  return out;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export function midpointOfLine(
  coords: { latitude: number; longitude: number }[],
): { latitude: number; longitude: number } | null {
  if (coords.length === 0) return null;
  if (coords.length === 1) return coords[0];
  // Walk along the polyline, find the point at half the total length
  const segLengths: number[] = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversine(coords[i - 1], coords[i]);
    segLengths.push(d);
    total += d;
  }
  const target = total / 2;
  let acc = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const next = acc + segLengths[i];
    if (next >= target) {
      const t = segLengths[i] === 0 ? 0 : (target - acc) / segLengths[i];
      const a = coords[i];
      const b = coords[i + 1];
      return {
        latitude: a.latitude + (b.latitude - a.latitude) * t,
        longitude: a.longitude + (b.longitude - a.longitude) * t,
      };
    }
    acc = next;
  }
  return coords[Math.floor(coords.length / 2)];
}

export function haversine(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 мин';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} мин`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '0 м';
  if (meters < 1000) return `${Math.round(meters)} м`;
  return `${(meters / 1000).toFixed(1)} км`;
}

export function formatETA(totalSeconds: number): string {
  const now = new Date();
  const eta = new Date(now.getTime() + totalSeconds * 1000);
  const hh = eta.getHours().toString().padStart(2, '0');
  const mm = eta.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}
