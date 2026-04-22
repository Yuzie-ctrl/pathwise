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

interface NominatimAddress {
  road?: string;
  pedestrian?: string;
  footway?: string;
  path?: string;
  cycleway?: string;
  residential?: string;
  street?: string;
  house_number?: string;
  neighbourhood?: string;
  suburb?: string;
  hamlet?: string;
  village?: string;
  town?: string;
  city?: string;
  city_district?: string;
  state?: string;
}

/**
 * Build a concise address label "Street N" (street first, then number).
 * Falls back sensibly when the address has no street / no number.
 */
export function formatAddressShort(
  addr: NominatimAddress | undefined,
  fallback: string,
): string {
  if (!addr) return fallback;
  const street =
    addr.road ||
    addr.pedestrian ||
    addr.footway ||
    addr.path ||
    addr.cycleway ||
    addr.residential ||
    addr.street;
  const number = addr.house_number;
  if (street && number) return `${street} ${number}`;
  if (street) return street;
  const area =
    addr.neighbourhood ||
    addr.suburb ||
    addr.hamlet ||
    addr.village ||
    addr.town ||
    addr.city ||
    addr.city_district;
  if (area) return area;
  return fallback;
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
    address?: NominatimAddress;
  }[];

  return data.map((item) => {
    const short = formatAddressShort(
      item.address,
      item.name || item.display_name.split(',')[0],
    );
    return {
      displayName: short,
      shortName: short,
      latitude: parseFloat(item.lat),
      longitude: parseFloat(item.lon),
    };
  });
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
  partial?: boolean;
}

export async function fetchRoute(
  stops: TripStop[],
  mode: TransportMode,
  signal?: AbortSignal,
  drawnRoutes?: DrawnRouteOverride[] | null,
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

    // If this leg matches a drawn-route override, use it.
    const override = (drawnRoutes ?? []).find(
      (r) => r.fromStopId === a.id && r.toStopId === b.id,
    );

    if (override && override.coordinates.length >= 2) {
      if (!override.partial) {
        // Full leg replacement — snap endpoints to stops.
        const coords = override.coordinates.slice();
        coords[0] = { latitude: a.latitude, longitude: a.longitude };
        coords[coords.length - 1] = {
          latitude: b.latitude,
          longitude: b.longitude,
        };
        legs.push({
          distanceMeters: override.distanceMeters,
          durationSeconds: Math.round(override.durationSeconds * multiplier),
          coordinates: coords,
          segmentIndex: i,
          mode,
        });
        continue;
      }

      // Partial drawing — router builds a→drawing start, drawing is kept,
      // drawing end → b. All three become sub-legs for one segmentIndex.
      const drawStart = override.coordinates[0];
      const drawEnd = override.coordinates[override.coordinates.length - 1];
      const preCoords = await tryOsrmRoute(profile, a, drawStart, signal);
      const postCoords = await tryOsrmRoute(profile, drawEnd, b, signal);
      const preDist = routeDistanceMeters(preCoords);
      const postDist = routeDistanceMeters(postCoords);
      const carSpeed = 30 / 3.6; // m/s approx
      if (preCoords.coordinates.length >= 2) {
        legs.push({
          distanceMeters: preCoords.distance ?? preDist,
          durationSeconds: Math.round(
            ((preCoords.duration ?? preDist / carSpeed) * multiplier),
          ),
          coordinates: preCoords.coordinates,
          segmentIndex: i,
          mode,
        });
      }
      legs.push({
        distanceMeters: override.distanceMeters,
        durationSeconds: Math.round(override.durationSeconds * multiplier),
        coordinates: override.coordinates,
        segmentIndex: i,
        mode,
      });
      if (postCoords.coordinates.length >= 2) {
        legs.push({
          distanceMeters: postCoords.distance ?? postDist,
          durationSeconds: Math.round(
            ((postCoords.duration ?? postDist / carSpeed) * multiplier),
          ),
          coordinates: postCoords.coordinates,
          segmentIndex: i,
          mode,
        });
      }
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
    if (coords.length > 0) {
      coords[0] = { latitude: a.latitude, longitude: a.longitude };
      coords[coords.length - 1] = { latitude: b.latitude, longitude: b.longitude };
    }

    // For transit mode, split each leg into walking-start / bus / walking-end
    // so the map can render them with different colours (walk = green dashed,
    // bus = purple solid) — Google-Maps-like visualization.
    if (mode === 'transit' && coords.length >= 6) {
      const sub = splitTransitLeg(coords, route.distance, route.duration, i);
      legs.push(...sub);
    } else {
      legs.push({
        distanceMeters: route.distance,
        durationSeconds: Math.round(route.duration * multiplier),
        coordinates: coords,
        segmentIndex: i,
        mode,
      });
    }
  }

  return legs;
}

// Split a car-profile leg into three visual sub-legs for transit rendering:
// first ~12% = walk, middle ~76% = bus, last ~12% = walk.
function splitTransitLeg(
  coords: { latitude: number; longitude: number }[],
  totalDist: number,
  totalDur: number,
  segmentIndex: number,
): RouteLeg[] {
  const n = coords.length;
  const walkStartEnd = Math.max(1, Math.round(n * 0.12));
  const walkEndStart = Math.max(n - walkStartEnd, walkStartEnd + 2);
  const walk1 = coords.slice(0, walkStartEnd + 1);
  const bus = coords.slice(walkStartEnd, walkEndStart + 1);
  const walk2 = coords.slice(walkEndStart, n);
  const walkRatio = 0.12;
  const busRatio = 1 - walkRatio * 2;
  // Time: walking slow, bus fast — override portions of total duration.
  // Assume OSRM gave us "car-like" duration; transit ~1.4× overall.
  const totalTransit = totalDur * 1.4;
  const walkTime = totalDist * walkRatio * (1 / 1.4); // 1.4 m/s walking → seconds
  const busTime = Math.max(0, totalTransit - walkTime * 2);
  return [
    {
      coordinates: walk1,
      distanceMeters: totalDist * walkRatio,
      durationSeconds: Math.round(walkTime),
      segmentIndex,
      mode: 'walking',
    },
    {
      coordinates: bus,
      distanceMeters: totalDist * busRatio,
      durationSeconds: Math.round(busTime),
      segmentIndex,
      mode: 'transit',
    },
    {
      coordinates: walk2,
      distanceMeters: totalDist * walkRatio,
      durationSeconds: Math.round(walkTime),
      segmentIndex,
      mode: 'walking',
    },
  ];
}

async function tryOsrmRoute(
  profile: string,
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
  signal?: AbortSignal,
): Promise<{
  coordinates: { latitude: number; longitude: number }[];
  distance?: number;
  duration?: number;
}> {
  try {
    const url = `https://router.project-osrm.org/route/v1/${profile}/${a.longitude},${a.latitude};${b.longitude},${b.latitude}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error('fail');
    const data = (await res.json()) as {
      code: string;
      routes?: OsrmRoute[];
    };
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('no');
    const r = data.routes[0];
    const coords = r.geometry.coordinates.map(([lon, lat]) => ({
      latitude: lat,
      longitude: lon,
    }));
    if (coords.length > 0) {
      coords[0] = a;
      coords[coords.length - 1] = b;
    }
    return { coordinates: coords, distance: r.distance, duration: r.duration };
  } catch {
    return { coordinates: [a, b] };
  }
}

function routeDistanceMeters(r: {
  coordinates: { latitude: number; longitude: number }[];
}): number {
  let d = 0;
  for (let i = 1; i < r.coordinates.length; i++) {
    d += haversine(r.coordinates[i - 1], r.coordinates[i]);
  }
  return d;
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
 * the drawing.
 *
 * Behaviour depends on how densely the user drew:
 *
 * - **Sparse / low-zoom drawing** (wide gaps between raw points): the user
 *   is sketching a general direction and expects the AI to pick sensible
 *   major roads. We resample to a smaller number of waypoints and use a
 *   generous radius (OSRM will snap each waypoint to the nearest road,
 *   which at low zoom tends to be a main road).
 *
 * - **Dense / high-zoom drawing** (tight gaps between points): the user is
 *   deliberately tracing a small road or footpath. We resample to more
 *   waypoints and use a tight radius so OSRM has to follow the drawing
 *   closely, including minor alleys / trails.
 */
export async function matchDrawnRoute(
  points: { latitude: number; longitude: number }[],
  mode: TransportMode,
  signal?: AbortSignal,
): Promise<MatchedRoute> {
  if (points.length < 2) {
    return { coordinates: points, distanceMeters: 0, durationSeconds: 0 };
  }

  // Measure how finely the user drew (avg meters between consecutive points).
  let totalLen = 0;
  let segCount = 0;
  for (let i = 1; i < points.length; i++) {
    totalLen += haversine(points[i - 1], points[i]);
    segCount++;
  }
  const avgSpacing = segCount > 0 ? totalLen / segCount : 0;
  const fine = avgSpacing < 20;

  // /match needs a trace that hugs the road: dense, ordered points.
  // OSRM matching profile: we want each sample snapped to the CLOSEST road.
  // More samples = tighter conformance to drawing.
  const targetCount = fine ? 80 : Math.max(40, Math.min(90, Math.round(totalLen / 25)));
  const resampled = resampleByDistance(points, targetCount);
  if (resampled.length < 2) {
    return { coordinates: points, distanceMeters: 0, durationSeconds: 0 };
  }

  const profile = OSRM_PROFILES[mode];

  // --- Primary: OSRM /match ------------------------------------------------
  // `radiuses` per-point controls how far OSRM may snap each sample. When the
  // drawing is fine we want tight snap (stay on the small road the user drew);
  // when the drawing is coarse, slightly more leeway so big roads win.
  const matchRadius = fine ? 25 : 45;
  try {
    const coordsStr = resampled
      .map((p) => `${p.longitude},${p.latitude}`)
      .join(';');
    const radii = resampled.map(() => matchRadius).join(';');
    const matchUrl =
      `https://router.project-osrm.org/match/v1/${profile}/${coordsStr}` +
      `?overview=full&geometries=geojson&radiuses=${radii}` +
      `&gaps=ignore&tidy=false&annotations=false`;
    const res = await fetch(matchUrl, { signal });
    if (res.ok) {
      const data = (await res.json()) as {
        code: string;
        matchings?: {
          distance?: number;
          duration?: number;
          geometry: { coordinates: [number, number][] };
        }[];
      };
      if (data.code === 'Ok' && data.matchings?.length) {
        // Stitch all matching segments in order into a single polyline,
        // deduping endpoint repeats.
        const stitched: MatchedPoint[] = [];
        let dist = 0;
        let dur = 0;
        for (const m of data.matchings) {
          for (const [lon, lat] of m.geometry.coordinates) {
            const pt = { latitude: lat, longitude: lon };
            const last = stitched[stitched.length - 1];
            if (
              !last ||
              Math.abs(last.latitude - pt.latitude) > 1e-7 ||
              Math.abs(last.longitude - pt.longitude) > 1e-7
            ) {
              stitched.push(pt);
            }
          }
          dist += m.distance ?? 0;
          dur += m.duration ?? 0;
        }
        if (stitched.length >= 2) {
          return {
            coordinates: stitched,
            distanceMeters: dist || routeDistanceMetersFlat(stitched),
            durationSeconds: dur || stitched.length * 2,
          };
        }
      }
    }
  } catch {
    // fall through
  }

  // --- Fallback: /route that must visit each resampled waypoint ------------
  try {
    const coords = resampled.map((p) => `${p.longitude},${p.latitude}`).join(';');
    const radii = resampled.map(() => matchRadius * 2).join(';');
    const url =
      `https://router.project-osrm.org/route/v1/${profile}/${coords}` +
      `?overview=full&geometries=geojson&continue_straight=false&radiuses=${radii}`;
    const res = await fetch(url, { signal });
    if (res.ok) {
      const data = (await res.json()) as {
        code: string;
        routes?: {
          distance: number;
          duration: number;
          geometry: { coordinates: [number, number][] };
        }[];
      };
      if (data.code === 'Ok' && data.routes?.length) {
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
      }
    }
  } catch {
    // fall through
  }

  // Last resort — raw line.
  let rawDist = 0;
  for (let i = 1; i < resampled.length; i++) {
    rawDist += haversine(resampled[i - 1], resampled[i]);
  }
  return {
    coordinates: resampled,
    distanceMeters: rawDist,
    durationSeconds: rawDist / 8.3,
  };
}

function routeDistanceMetersFlat(
  points: { latitude: number; longitude: number }[],
): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
  return d;
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

export interface TransitSegment {
  kind: 'walk' | 'bus' | 'tram' | 'train';
  durationSeconds: number;
  distanceMeters: number;
  line?: string; // "24A", etc.
  from: string;
  to: string;
  stopsCount?: number;
}

export interface TransitOption {
  id: string;
  label: string;
  description: string;
  durationSeconds: number;
  walkMinutes: number;
  transfers: number;
  busLines: string[];
  departureInMinutes: number;
  /** Detailed breakdown for Google-Maps-style detail sheet. */
  segments: TransitSegment[];
}

export function buildTransitOptions(
  carDurationSeconds: number,
  distanceMeters: number,
  originLabel = 'Начало',
  destinationLabel = 'Конец',
): TransitOption[] {
  if (carDurationSeconds <= 0) return [];
  const base = Math.round(carDurationSeconds * 1.4);
  const km = distanceMeters / 1000;
  const line = (n: number) => `№${Math.max(1, Math.round(km * 3) + n)}`;

  // Direct
  const directWalk1 = Math.max(60, Math.round(km * 0.6 * 60));
  const directBus = Math.max(0, base - directWalk1 * 2);
  const directWalk2 = directWalk1;
  const direct: TransitOption = {
    id: 'transit-direct',
    label: 'Прямой автобус',
    description: 'Без пересадок',
    durationSeconds: base,
    walkMinutes: Math.max(3, Math.round(km * 0.6)),
    transfers: 0,
    busLines: [line(0)],
    departureInMinutes: 4,
    segments: [
      {
        kind: 'walk',
        durationSeconds: directWalk1,
        distanceMeters: distanceMeters * 0.1,
        from: originLabel,
        to: 'Остановка',
      },
      {
        kind: 'bus',
        durationSeconds: directBus,
        distanceMeters: distanceMeters * 0.8,
        line: line(0),
        from: 'Остановка',
        to: 'Остановка',
        stopsCount: Math.max(3, Math.round(km * 1.2)),
      },
      {
        kind: 'walk',
        durationSeconds: directWalk2,
        distanceMeters: distanceMeters * 0.1,
        from: 'Остановка',
        to: destinationLabel,
      },
    ],
  };

  // With transfer — faster
  const fastDur = Math.round(base * 0.9);
  const fastWalk = Math.max(60, Math.round(km * 0.8 * 60));
  const fastBus1 = Math.round((fastDur - fastWalk * 2) * 0.55);
  const fastBus2 = Math.max(0, fastDur - fastWalk * 2 - fastBus1);
  const fast: TransitOption = {
    id: 'transit-fast',
    label: 'С пересадкой',
    description: 'Быстрее на ~10%',
    durationSeconds: fastDur,
    walkMinutes: Math.max(4, Math.round(km * 0.8)),
    transfers: 1,
    busLines: [line(2), line(5)],
    departureInMinutes: 7,
    segments: [
      {
        kind: 'walk',
        durationSeconds: fastWalk,
        distanceMeters: distanceMeters * 0.08,
        from: originLabel,
        to: 'Остановка',
      },
      {
        kind: 'bus',
        durationSeconds: fastBus1,
        distanceMeters: distanceMeters * 0.45,
        line: line(2),
        from: 'Остановка',
        to: 'Пересадка',
        stopsCount: Math.max(2, Math.round(km * 0.8)),
      },
      {
        kind: 'bus',
        durationSeconds: fastBus2,
        distanceMeters: distanceMeters * 0.37,
        line: line(5),
        from: 'Пересадка',
        to: 'Остановка',
        stopsCount: Math.max(2, Math.round(km * 0.6)),
      },
      {
        kind: 'walk',
        durationSeconds: fastWalk,
        distanceMeters: distanceMeters * 0.1,
        from: 'Остановка',
        to: destinationLabel,
      },
    ],
  };

  const slowDur = Math.round(base * 1.12);
  const slowWalk = 120;
  const slowBus1 = Math.round((slowDur - slowWalk * 2) * 0.5);
  const slowBus2 = Math.max(0, slowDur - slowWalk * 2 - slowBus1);
  const slow: TransitOption = {
    id: 'transit-slow',
    label: 'Меньше ходьбы',
    description: 'Дольше, но почти без ходьбы',
    durationSeconds: slowDur,
    walkMinutes: 2,
    transfers: 1,
    busLines: [line(1), line(4)],
    departureInMinutes: 12,
    segments: [
      {
        kind: 'walk',
        durationSeconds: slowWalk,
        distanceMeters: distanceMeters * 0.03,
        from: originLabel,
        to: 'Остановка',
      },
      {
        kind: 'bus',
        durationSeconds: slowBus1,
        distanceMeters: distanceMeters * 0.55,
        line: line(1),
        from: 'Остановка',
        to: 'Пересадка',
        stopsCount: Math.max(3, Math.round(km * 1)),
      },
      {
        kind: 'bus',
        durationSeconds: slowBus2,
        distanceMeters: distanceMeters * 0.38,
        line: line(4),
        from: 'Пересадка',
        to: 'Остановка',
        stopsCount: Math.max(2, Math.round(km * 0.7)),
      },
      {
        kind: 'walk',
        durationSeconds: slowWalk,
        distanceMeters: distanceMeters * 0.04,
        from: 'Остановка',
        to: destinationLabel,
      },
    ],
  };

  return [direct, fast, slow];
}

/**
 * All unique transit line numbers that could appear in the given options.
 * Used for the "filter by line" chip picker.
 */
export function allTransitLines(options: TransitOption[]): string[] {
  const set = new Set<string>();
  for (const o of options) for (const l of o.busLines) set.add(l);
  return Array.from(set).sort();
}
