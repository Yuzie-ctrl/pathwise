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

export interface DrawnRouteOverride {
  fromStopId: string;
  toStopId: string;
  coordinates: { latitude: number; longitude: number }[];
  distanceMeters: number;
  durationSeconds: number;
}

export async function fetchRoute(
  stops: TripStop[],
  mode: TransportMode,
  signal?: AbortSignal,
  drawnRoute?: DrawnRouteOverride | null,
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

    // If this leg matches the drawn-route override, use its geometry as-is.
    if (
      drawnRoute &&
      drawnRoute.fromStopId === a.id &&
      drawnRoute.toStopId === b.id &&
      drawnRoute.coordinates.length >= 2
    ) {
      const coords = drawnRoute.coordinates.slice();
      // Pin endpoints to stop coordinates.
      coords[0] = { latitude: a.latitude, longitude: a.longitude };
      coords[coords.length - 1] = {
        latitude: b.latitude,
        longitude: b.longitude,
      };
      legs.push({
        distanceMeters: drawnRoute.distanceMeters,
        durationSeconds: Math.round(drawnRoute.durationSeconds * multiplier),
        coordinates: coords,
      });
      continue;
    }

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

export interface MatchedRoute {
  coordinates: MatchedPoint[];
  distanceMeters: number;
  durationSeconds: number;
}

/**
 * Given a freehand drawn polyline, build a road-network route that follows
 * the drawing as closely as possible.
 *
 * We do NOT use OSRM /match here because it aggressively smooths the path
 * and often picks a shortcut between the start and end, ignoring the shape.
 *
 * Instead we sample the drawing into ~25 waypoints (by actual arc length so
 * they're evenly spaced along the line, not clustered where the user was
 * slow) and feed them to OSRM /route. OSRM is then forced to visit each
 * waypoint, so the resulting road-following polyline traces the curve of
 * the drawing — corners, detours and all.
 */
export async function matchDrawnRoute(
  points: { latitude: number; longitude: number }[],
  mode: TransportMode,
  signal?: AbortSignal,
): Promise<MatchedRoute> {
  if (points.length < 2) {
    return { coordinates: points, distanceMeters: 0, durationSeconds: 0 };
  }

  // 1) Resample by arc length so the router gets evenly-spaced guidance
  //    points. The public OSRM demo caps at ~100 coords per request; we
  //    target fewer so the router has freedom between them (it still has to
  //    pass through each one, just not every cm).
  const resampled = resampleByDistance(points, 25);
  if (resampled.length < 2) {
    return { coordinates: points, distanceMeters: 0, durationSeconds: 0 };
  }

  const profile = OSRM_PROFILES[mode];
  const coords = resampled
    .map((p) => `${p.longitude},${p.latitude}`)
    .join(';');
  // Generous radius — the user's drawing is rarely on-road; we want OSRM to
  // snap each waypoint to a nearby road, then route between them.
  const radii = resampled.map(() => 80).join(';');
  const url =
    `https://router.project-osrm.org/route/v1/${profile}/${coords}` +
    `?overview=full&geometries=geojson&continue_straight=false&radiuses=${radii}`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Route failed: ${res.status}`);
    const data = (await res.json()) as {
      code: string;
      routes?: {
        distance: number;
        duration: number;
        geometry: { coordinates: [number, number][] };
      }[];
    };
    if (data.code !== 'Ok' || !data.routes?.length) {
      throw new Error('No route');
    }
    const r = data.routes[0];
    const coords2 = r.geometry.coordinates.map(([lon, lat]) => ({
      latitude: lat,
      longitude: lon,
    }));
    return {
      coordinates: coords2,
      distanceMeters: r.distance,
      durationSeconds: r.duration,
    };
  } catch {
    // Fallback: try /match, then raw drawn points.
    try {
      const matchCoords = resampled
        .map((p) => `${p.longitude},${p.latitude}`)
        .join(';');
      const matchRadii = resampled.map(() => 30).join(';');
      const matchUrl = `https://router.project-osrm.org/match/v1/${profile}/${matchCoords}?overview=full&geometries=geojson&radiuses=${matchRadii}&gaps=ignore&tidy=true`;
      const res = await fetch(matchUrl, { signal });
      const data = (await res.json()) as {
        code: string;
        matchings?: {
          distance?: number;
          duration?: number;
          geometry: { coordinates: [number, number][] };
        }[];
      };
      if (data.code === 'Ok' && data.matchings?.length) {
        const result: MatchedPoint[] = [];
        let dist = 0;
        let dur = 0;
        for (const m of data.matchings) {
          for (const [lon, lat] of m.geometry.coordinates) {
            result.push({ latitude: lat, longitude: lon });
          }
          dist += m.distance ?? 0;
          dur += m.duration ?? 0;
        }
        return {
          coordinates: result,
          distanceMeters: dist,
          durationSeconds: dur,
        };
      }
    } catch {
      // ignore
    }
    // Compute raw-line length as a last resort.
    let rawDist = 0;
    for (let i = 1; i < resampled.length; i++) {
      rawDist += haversine(resampled[i - 1], resampled[i]);
    }
    return {
      coordinates: resampled,
      distanceMeters: rawDist,
      durationSeconds: rawDist / 8.3, // ~30 km/h
    };
  }
}

/**
 * Resample a polyline to `targetCount` points spaced evenly by arc length.
 * Always includes the first and last input points.
 */
function resampleByDistance(
  points: { latitude: number; longitude: number }[],
  targetCount: number,
): { latitude: number; longitude: number }[] {
  if (points.length <= 2) return points.slice();
  // Cumulative distances
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + haversine(points[i - 1], points[i]));
  }
  const total = cum[cum.length - 1];
  if (total === 0) return [points[0], points[points.length - 1]];

  const step = total / (targetCount - 1);
  const out: { latitude: number; longitude: number }[] = [points[0]];
  let j = 1;
  for (let i = 1; i < targetCount - 1; i++) {
    const target = step * i;
    while (j < cum.length - 1 && cum[j] < target) j++;
    const a = points[j - 1];
    const b = points[j];
    const segLen = cum[j] - cum[j - 1];
    const t = segLen === 0 ? 0 : (target - cum[j - 1]) / segLen;
    out.push({
      latitude: a.latitude + (b.latitude - a.latitude) * t,
      longitude: a.longitude + (b.longitude - a.longitude) * t,
    });
  }
  out.push(points[points.length - 1]);
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
