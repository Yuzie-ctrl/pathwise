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

// The public OSRM demo server (router.project-osrm.org) only actually serves
// the `car` profile — requesting `foot`/`bike` returns the same car route.
// We therefore always request `car` geometry and synthesize realistic
// durations for each non-car mode from typical average speeds.
const OSRM_PROFILES: Record<TransportMode, string> = {
  walking: 'car',
  driving: 'car',
  cycling: 'car',
  transit: 'car',
};

// Approximate ratios applied to the car duration to simulate each mode.
// (Car in city ≈ 30 km/h. Foot ≈ 5 km/h → 6×. Bike ≈ 15 km/h → 2×. Bus ≈ 1.4×.)
const DURATION_MULTIPLIER: Record<TransportMode, number> = {
  driving: 1,
  walking: 6,
  cycling: 2,
  transit: 1.4,
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
  const multiplier = DURATION_MULTIPLIER[mode] ?? 1;

  // Query OSRM once per leg so each polyline is guaranteed to start/end
  // exactly at the waypoint coordinates (no gaps, no overshoot).
  const legs: RouteLeg[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const url = `https://router.project-osrm.org/route/v1/${profile}/${a.longitude},${a.latitude};${b.longitude},${b.latitude}?overview=full&geometries=geojson`;
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
    const coords = route.geometry.coordinates.map(([lon, lat]) => ({
      latitude: lat,
      longitude: lon,
    }));
    // Ensure the polyline actually starts at A and ends at B (patch endpoints).
    if (coords.length > 0) {
      coords[0] = { latitude: a.latitude, longitude: a.longitude };
      coords[coords.length - 1] = { latitude: b.latitude, longitude: b.longitude };
    }
    legs.push({
      distanceMeters: route.distance,
      durationSeconds: Math.round(route.duration * multiplier),
      coordinates: coords,
    });
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
  // OSRM /match officially accepts up to 100 points. Drop obvious duplicates
  // (to respect the density limit) then downsample only if needed.
  const dedup: { latitude: number; longitude: number }[] = [];
  for (const p of points) {
    const last = dedup[dedup.length - 1];
    if (!last) {
      dedup.push(p);
      continue;
    }
    // ~11m at the equator for 0.0001°
    const dLat = Math.abs(p.latitude - last.latitude);
    const dLon = Math.abs(p.longitude - last.longitude);
    if (dLat < 0.00005 && dLon < 0.00005) continue;
    dedup.push(p);
  }
  const sampled = downsample(dedup, 95);
  const profile = OSRM_PROFILES[mode];
  const coords = sampled.map((p) => `${p.longitude},${p.latitude}`).join(';');
  // Tighter radius → fewer wild snaps to far-away roads.
  const radii = sampled.map(() => 25).join(';');
  const url = `https://router.project-osrm.org/match/v1/${profile}/${coords}?overview=full&geometries=geojson&radiuses=${radii}&gaps=ignore&tidy=true`;
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

// ---------------------------------------------------------------------------
// Transit route variants
// ---------------------------------------------------------------------------
//
// OSRM demo has no transit data feed. To provide Google-Maps-like "several bus
// options" UX we synthesize plausible variants from a baseline car route
// duration: a direct express, one with a single transfer, and a scenic route.
// Numbers are approximate and clearly labelled — this is a UX placeholder
// until a real transit API is wired up.

export interface TransitOption {
  id: string;
  label: string;
  description: string;
  durationSeconds: number;
  walkMinutes: number;
  transfers: number;
  busLines: string[];
  departureInMinutes: number;
}

export function buildTransitOptions(
  carDurationSeconds: number,
  distanceMeters: number,
): TransitOption[] {
  if (carDurationSeconds <= 0) return [];
  const base = Math.round(carDurationSeconds * 1.4);
  const km = distanceMeters / 1000;
  // Simple deterministic "bus line" naming based on distance — just visual.
  const line = (n: number) => `№${Math.max(1, Math.round(km * 3) + n)}`;
  return [
    {
      id: 'transit-direct',
      label: 'Прямой автобус',
      description: 'Без пересадок',
      durationSeconds: base,
      walkMinutes: Math.max(3, Math.round(km * 0.6)),
      transfers: 0,
      busLines: [line(0)],
      departureInMinutes: 4,
    },
    {
      id: 'transit-fast',
      label: 'С пересадкой',
      description: 'Быстрее на ~10%',
      durationSeconds: Math.round(base * 0.9),
      walkMinutes: Math.max(4, Math.round(km * 0.8)),
      transfers: 1,
      busLines: [line(2), line(5)],
      departureInMinutes: 7,
    },
    {
      id: 'transit-slow',
      label: 'Меньше ходьбы',
      description: 'Дольше, но почти без ходьбы',
      durationSeconds: Math.round(base * 1.12),
      walkMinutes: 2,
      transfers: 1,
      busLines: [line(1), line(4)],
      departureInMinutes: 12,
    },
  ];
}
