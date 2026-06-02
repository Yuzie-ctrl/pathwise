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
    type?: string;
    class?: string;
    lat: string;
    lon: string;
    address?: NominatimAddress;
  }[];

  return data.map((item) => {
    const addressShort = formatAddressShort(
      item.address,
      item.display_name.split(',')[0],
    );
    // If the result is a named POI (e.g. a mall, restaurant, park), surface
    // the POI name as the TITLE and use the street-address as the subtitle.
    // Heuristic: Nominatim returns `name` for POIs; for pure addresses the
    // `name` field is either absent or equal to the street/number part.
    const isPoi =
      !!item.name &&
      item.name.trim().length > 0 &&
      item.name !== addressShort &&
      // Don't treat the first comma-separated chunk (often the house number
      // alone, e.g. "98") as a POI name.
      !/^\d+[A-Za-z]?$/.test(item.name.trim());
    const shortName = isPoi ? item.name!.trim() : addressShort;
    return {
      // Keep the full, comma-separated Nominatim description (city, postal code,
      // region, country) so UI can render a secondary detail line under the
      // short street-address title.
      displayName: item.display_name,
      shortName,
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

// Realistic average speeds (m/s) used to synthesize per-mode travel time
// from the leg's *actual* road-network distance. Using distance (not the
// car duration) keeps ETAs honest: car duration drops with highway bias,
// but for walking/cycling what matters is kilometers.
//
// Urban car  ≈ 40 km/h (signal-corrected)    = 11.1 m/s
// Walking    ≈ 4 km/h (requested baseline)   =  1.111 m/s
// Cycling    ≈ 15 km/h                       =  4.17 m/s
// City bus   ≈ 22 km/h (stops + wait factored in later)
const AVG_SPEED_MPS: Record<TransportMode, number> = {
  driving: 11.1,
  walking: 1.111, // 4 km/h
  cycling: 4.17, // 15 km/h
  transit: 6.1, // ≈ 22 km/h effective
};

/** Average speeds in km/h, exposed for ETA labels / schedule calc. */
export const AVG_SPEED_KMH: Record<TransportMode, number> = {
  walking: 4,
  cycling: 15,
  driving: 40,
  transit: 22,
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
  const speed = AVG_SPEED_MPS[mode] ?? AVG_SPEED_MPS.driving;

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
          durationSeconds: Math.round(override.distanceMeters / speed),
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
      const preDist = preCoords.distance ?? routeDistanceMeters(preCoords);
      const postDist = postCoords.distance ?? routeDistanceMeters(postCoords);
      if (preCoords.coordinates.length >= 2) {
        legs.push({
          distanceMeters: preDist,
          durationSeconds: Math.round(preDist / speed),
          coordinates: preCoords.coordinates,
          segmentIndex: i,
          mode,
        });
      }
      legs.push({
        distanceMeters: override.distanceMeters,
        durationSeconds: Math.round(override.distanceMeters / speed),
        coordinates: override.coordinates,
        segmentIndex: i,
        mode,
      });
      if (postCoords.coordinates.length >= 2) {
        legs.push({
          distanceMeters: postDist,
          durationSeconds: Math.round(postDist / speed),
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

    // Duration derived from actual distance × mode-specific speed — honest
    // ETAs regardless of what "duration" OSRM's car profile reports.
    const legDuration = Math.round(route.distance / speed);

    // For transit mode, split each leg into walking-start / bus / walking-end
    // so the map can render them with different colours (walk = green dashed,
    // bus = purple solid) — Google-Maps-like visualization.
    if (mode === 'transit' && coords.length >= 6) {
      const sub = splitTransitLeg(coords, route.distance, legDuration, i);
      legs.push(...sub);
    } else {
      legs.push({
        distanceMeters: route.distance,
        durationSeconds: legDuration,
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
  // Distribute the already-synthesized transit duration across sub-legs:
  // walks are slow (≈ 1.33 m/s) and take time proportional to their length;
  // whatever remains is the bus ride.
  const walkDist = totalDist * walkRatio;
  const walkTime = walkDist / AVG_SPEED_MPS.walking;
  const busTime = Math.max(0, totalDur - walkTime * 2);
  return [
    {
      coordinates: walk1,
      distanceMeters: walkDist,
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
      distanceMeters: walkDist,
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
  /**
   * When multiple freehand strokes were stitched, this holds the individually
   * road-snapped strokes (one polyline each) in draw order, so callers can
   * render just the user-drawn parts (without the road connectors) — e.g. the
   * transit planner peek view before a specific bus is chosen.
   */
  snappedStrokes?: MatchedPoint[][];
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

  // 1) Drop near-duplicate samples (within 5 m). Noisy raw input causes
  //    OSRM /match to hop into side streets for one sample and back.
  const cleaned: { latitude: number; longitude: number }[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const last = cleaned[cleaned.length - 1];
    if (haversine(last, points[i]) >= 5) {
      cleaned.push(points[i]);
    }
  }
  if (cleaned[cleaned.length - 1] !== points[points.length - 1]) {
    cleaned.push(points[points.length - 1]);
  }

  let totalLen = 0;
  for (let i = 1; i < cleaned.length; i++) {
    totalLen += haversine(cleaned[i - 1], cleaned[i]);
  }
  if (totalLen < 10) {
    return { coordinates: cleaned, distanceMeters: totalLen, durationSeconds: 0 };
  }
  const avgSpacing = totalLen / Math.max(1, cleaned.length - 1);
  // "Fine" = user zoomed in and traced a small street/path deliberately.
  const fine = avgSpacing < 12;

  // 2) Resample with a MINIMUM spacing — never place waypoints closer than
  //    35 m (fine) or 80 m (coarse). Waypoints closer than that let OSRM
  //    justify a brief detour that comes right back.
  const minStep = fine ? 35 : 80;
  const targetCount = Math.max(
    2,
    Math.min(80, Math.round(totalLen / minStep) + 1),
  );
  const resampled = resampleByDistance(cleaned, targetCount);
  if (resampled.length < 2) {
    return { coordinates: points, distanceMeters: 0, durationSeconds: 0 };
  }

  const profile = OSRM_PROFILES[mode];

  // --- Primary: OSRM /match ------------------------------------------------
  // `radiuses` per-point controls how far OSRM may snap each sample. When the
  // drawing is fine we keep radius moderate (30 m) to stay on the small road
  // the user drew; coarse drawings get 60 m so major roads win. `tidy=true`
  // lets OSRM drop obvious outliers — that's what prevents the short detours.
  const matchRadius = fine ? 25 : 75;
  try {
    const coordsStr = resampled
      .map((p) => `${p.longitude},${p.latitude}`)
      .join(';');
    const radii = resampled.map(() => matchRadius).join(';');
    const matchUrl =
      `https://router.project-osrm.org/match/v1/${profile}/${coordsStr}` +
      `?overview=full&geometries=geojson&radiuses=${radii}` +
      `&gaps=ignore&tidy=true&annotations=false`;
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
          dur += m.duration ?? 0;
        }
        if (stitched.length >= 2) {
          // Post-process to make the line look like a planned route, not a
          // freehand trace:
          //   1) cut short enter-then-exit detours / on-the-spot loops
          //   2) Douglas–Peucker simplify to drop micro zig-zags on a road
          //      that is essentially straight (epsilon scales with how
          //      carefully the user drew — fine drawings keep more detail).
          const deSpurred = removeShortDetours(stitched, fine ? 60 : 160);
          const epsilon = fine ? 6 : 16;
          const smoothed = simplifyPolyline(deSpurred, epsilon);
          let finalCoords = smoothed.length >= 2 ? smoothed : deSpurred;
          // 3) For coarse drawings, run a final road-snapping pass: re-route
          //    along the network through the simplified waypoints. This forces
          //    the line to follow the optimal road between sparse anchors and
          //    eliminates the residual "circles" and stray alley dips that
          //    /match leaves behind. Fine drawings skip this so deliberately
          //    traced minor paths are preserved verbatim.
          if (!fine) {
            const refined = await refineAlongRoads(
              finalCoords,
              profile,
              signal,
            );
            if (refined && refined.length >= 2) {
              finalCoords = simplifyPolyline(
                removeShortDetours(refined, 160),
                16,
              );
            }
          }
          const finalDist = routeDistanceMetersFlat(finalCoords);
          return {
            coordinates: finalCoords,
            distanceMeters: finalDist,
            durationSeconds: dur || Math.round(finalDist / AVG_SPEED_MPS.driving),
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
        const deSpurred = removeShortDetours(coords2, fine ? 60 : 120);
        const smoothed = simplifyPolyline(deSpurred, fine ? 6 : 14);
        const finalCoords = smoothed.length >= 2 ? smoothed : deSpurred;
        return {
          coordinates: finalCoords,
          distanceMeters: routeDistanceMetersFlat(finalCoords),
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

// ---------------------------------------------------------------------------
// Ambiguity detection — "which route is better?" learning prompt
// ---------------------------------------------------------------------------

export interface RouteAmbiguity {
  /** Map center to zoom to while asking the question. */
  center: { latitude: number; longitude: number };
  /** Suggested camera delta (degrees) for the zoom. */
  delta: number;
  /** Candidate local route variants (2–3) for the uncertain span. */
  variants: { latitude: number; longitude: number }[][];
  /** Index range in `full` that the variants replace (so a choice can be applied). */
  startIndex: number;
  endIndex: number;
}

/**
 * Detect ONE place where the snapped route diverges noticeably from what the
 * user drew — a spot where the AI is genuinely uncertain whether to dive into
 * a side street. Returns null when the snap closely follows the drawing
 * everywhere (no need to bother the user).
 *
 * Heuristic: resample both the raw drawing and the snapped result, then find
 * the snapped point that is farthest from the drawing. If that gap exceeds a
 * threshold (and the user drew coarsely, i.e. wasn't deliberately tracing a
 * tiny alley), build two local variants:
 *   1) the snapped span (AI's current guess)
 *   2) a "straighter / stay-on-main-road" span that ignores the wiggle
 */
export async function detectAmbiguousSpot(
  rawStrokes: { latitude: number; longitude: number }[][],
  snapped: { latitude: number; longitude: number }[],
  mode: TransportMode,
  signal?: AbortSignal,
): Promise<RouteAmbiguity | null> {
  const raw = rawStrokes.flat();
  if (raw.length < 4 || snapped.length < 4) return null;

  // Total drawing length — short drawings rarely have a meaningful fork.
  let total = 0;
  for (let i = 1; i < raw.length; i++) total += haversine(raw[i - 1], raw[i]);
  if (total < 200) return null;

  // For each snapped point, distance to the nearest raw point.
  let worstIdx = -1;
  let worstDist = 0;
  for (let i = 1; i < snapped.length - 1; i++) {
    let best = Infinity;
    for (let j = 0; j < raw.length; j++) {
      const d = haversine(snapped[i], raw[j]);
      if (d < best) best = d;
      if (best < 15) break;
    }
    if (best > worstDist) {
      worstDist = best;
      worstIdx = i;
    }
  }

  // Only ask when the divergence is real (40–250 m). Below 40 m the snap is
  // basically on the drawing; above 250 m it's likely a snap failure, not a
  // genuine fork worth a learning prompt.
  if (worstIdx < 0 || worstDist < 40 || worstDist > 250) return null;

  // Local span around the divergence (a few hundred metres).
  const spanStart = Math.max(0, worstIdx - 6);
  const spanEnd = Math.min(snapped.length - 1, worstIdx + 6);
  const a = snapped[spanStart];
  const b = snapped[spanEnd];

  // Variant 1 — AI's current snapped span.
  const variant1 = snapped.slice(spanStart, spanEnd + 1);

  // Variant 2 — a direct road route between the span endpoints that avoids
  // forcing the wiggle (straighter / stays on bigger roads).
  const profile = OSRM_PROFILES[mode];
  let variant2: { latitude: number; longitude: number }[] = [a, b];
  try {
    const alt = await tryOsrmRoute(profile, a, b, signal);
    if (alt.coordinates.length >= 2) {
      variant2 = simplifyPolyline(alt.coordinates, 8);
    }
  } catch {
    // keep straight fallback
  }

  // If the two variants are essentially identical, there's no real choice.
  if (polylinesSimilar(variant1, variant2, 25)) return null;

  const lats = [...variant1, ...variant2].map((p) => p.latitude);
  const lons = [...variant1, ...variant2].map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const delta = Math.max(0.004, (maxLat - minLat) * 2.2, (maxLon - minLon) * 2.2);

  return {
    center: {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
    },
    delta,
    variants: [variant1, variant2],
    startIndex: spanStart,
    endIndex: spanEnd,
  };
}

/** Replace a span [startIndex, endIndex] in `full` with `variant` coords. */
export function applyAmbiguityChoice(
  full: { latitude: number; longitude: number }[],
  ambiguity: RouteAmbiguity,
  variantIndex: number,
): { latitude: number; longitude: number }[] {
  const variant = ambiguity.variants[variantIndex];
  if (!variant || variant.length < 2) return full;
  const head = full.slice(0, ambiguity.startIndex);
  const tail = full.slice(ambiguity.endIndex + 1);
  return [...head, ...variant, ...tail];
}

/** Roughly equal polylines — average nearest-point distance under threshold. */
function polylinesSimilar(
  a: { latitude: number; longitude: number }[],
  b: { latitude: number; longitude: number }[],
  thresholdMeters: number,
): boolean {
  if (a.length === 0 || b.length === 0) return true;
  let sum = 0;
  for (const p of a) {
    let best = Infinity;
    for (const q of b) {
      const d = haversine(p, q);
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum / a.length < thresholdMeters;
}


/**
 * Match a *set* of freehand strokes into one continuous road-network route.
 *
 * The user may lift the finger between parts of the route. Each stroke is
 * snapped to roads independently with `matchDrawnRoute` (so the small wiggles
 * inside one stroke get straightened to the underlying road). The GAP between
 * the end of one stroke and the start of the next is then routed ALONG the
 * road network via OSRM `/route` (NOT a straight line), so the connector
 * follows existing streets exactly like the point-to-point planner does.
 *
 * The result is a single stitched polyline with honest distance/duration.
 */
export async function matchDrawnStrokes(
  strokes: { latitude: number; longitude: number }[][],
  mode: TransportMode,
  signal?: AbortSignal,
): Promise<MatchedRoute> {
  // Keep only strokes that actually have ≥ 2 points.
  const usable = strokes.filter((s) => s.length >= 2);
  if (usable.length === 0) {
    return { coordinates: [], distanceMeters: 0, durationSeconds: 0 };
  }
  if (usable.length === 1) {
    return matchDrawnRoute(usable[0], mode, signal);
  }

  const profile = OSRM_PROFILES[mode];
  const speed = AVG_SPEED_MPS[mode] ?? AVG_SPEED_MPS.driving;

  // 1) Snap each stroke to roads independently.
  const matchedStrokes: MatchedRoute[] = [];
  for (const stroke of usable) {
    const m = await matchDrawnRoute(stroke, mode, signal);
    if (m.coordinates.length >= 2) matchedStrokes.push(m);
  }
  if (matchedStrokes.length === 0) {
    return { coordinates: [], distanceMeters: 0, durationSeconds: 0 };
  }
  if (matchedStrokes.length === 1)
    return { ...matchedStrokes[0], snappedStrokes: [matchedStrokes[0].coordinates] };

  // 2) Stitch: stroke[0] → road-route gap → stroke[1] → road-route gap → …
  const stitched: MatchedPoint[] = [];
  let totalDist = 0;
  let totalDur = 0;

  const pushCoords = (coords: MatchedPoint[]) => {
    for (const pt of coords) {
      const last = stitched[stitched.length - 1];
      if (
        !last ||
        Math.abs(last.latitude - pt.latitude) > 1e-7 ||
        Math.abs(last.longitude - pt.longitude) > 1e-7
      ) {
        stitched.push(pt);
      }
    }
  };

  for (let i = 0; i < matchedStrokes.length; i++) {
    const seg = matchedStrokes[i];
    pushCoords(seg.coordinates);
    totalDist += seg.distanceMeters;
    totalDur += seg.durationSeconds;

    // Connect this stroke's end to the next stroke's start ALONG the road.
    if (i < matchedStrokes.length - 1) {
      const from = seg.coordinates[seg.coordinates.length - 1];
      const to = matchedStrokes[i + 1].coordinates[0];
      // If endpoints are already nearly coincident, skip the connector.
      if (haversine(from, to) > 8) {
        const gap = await tryOsrmRoute(profile, from, to, signal);
        if (gap.coordinates.length >= 2) {
          pushCoords(gap.coordinates);
          const gapDist =
            gap.distance ?? routeDistanceMetersFlat(gap.coordinates);
          totalDist += gapDist;
          totalDur += Math.round(gapDist / speed);
        }
      }
    }
  }

  if (stitched.length < 2) {
    return matchedStrokes[0];
  }

  return {
    coordinates: stitched,
    distanceMeters: totalDist,
    durationSeconds: totalDur || Math.round(totalDist / speed),
    snappedStrokes: matchedStrokes.map((m) => m.coordinates),
  };
}

/**
 * Re-route a simplified polyline along the road network so the line follows
 * optimal roads between sparse anchors (instead of /match's freehand-traced
 * detours). We pick a handful of anchor waypoints from the simplified line,
 * ask OSRM /route to connect them with generous radii, and return the road
 * geometry. Returns null on failure so the caller keeps its current line.
 */
async function refineAlongRoads(
  coords: { latitude: number; longitude: number }[],
  profile: string,
  signal?: AbortSignal,
): Promise<{ latitude: number; longitude: number }[] | null> {
  if (coords.length < 3) return null;
  // OSRM allows many waypoints, but keep it bounded. Resample to evenly
  // spaced anchors (max 25) so the route is constrained to the drawn path
  // without forcing micro-detours.
  const anchorCount = Math.min(25, Math.max(3, Math.round(coords.length / 2)));
  const anchors = resampleByDistance(coords, anchorCount);
  try {
    const coordsStr = anchors
      .map((p) => `${p.longitude},${p.latitude}`)
      .join(';');
    // Wide radii (90 m) let OSRM snap each anchor to the best nearby road,
    // smoothing out alley dips while staying on the drawn corridor.
    const radii = anchors.map(() => 90).join(';');
    const url =
      `https://router.project-osrm.org/route/v1/${profile}/${coordsStr}` +
      `?overview=full&geometries=geojson&continue_straight=true&radiuses=${radii}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code: string;
      routes?: { geometry: { coordinates: [number, number][] } }[];
    };
    if (data.code !== 'Ok' || !data.routes?.length) return null;
    return data.routes[0].geometry.coordinates.map(([lon, lat]) => ({
      latitude: lat,
      longitude: lon,
    }));
  } catch {
    return null;
  }
}

/**
 * Walk the polyline and drop short "enter-then-exit" detours.
 * A detour is detected when the polyline leaves the running main axis
 * for a short distance (< maxDetourMeters) and comes back near its entry
 * point — typical /match side-street false positives. Iterated a few times
 * because removing one loop can expose another that was nested inside it.
 */
function removeShortDetours(
  coords: { latitude: number; longitude: number }[],
  maxDetourMeters: number,
): { latitude: number; longitude: number }[] {
  let cur = coords;
  for (let pass = 0; pass < 3; pass++) {
    const next = removeShortDetoursOnce(cur, maxDetourMeters);
    if (next.length === cur.length) {
      cur = next;
      break;
    }
    cur = next;
  }
  return cur;
}

function removeShortDetoursOnce(
  coords: { latitude: number; longitude: number }[],
  maxDetourMeters: number,
): { latitude: number; longitude: number }[] {
  if (coords.length < 5) return coords;
  const out: { latitude: number; longitude: number }[] = [coords[0]];
  let i = 1;
  while (i < coords.length) {
    const here = coords[i];
    // Look ahead up to 40 points for a point that returns close to `here` —
    // if found and the excursion length is small, skip the whole loop. The
    // return threshold is wider (30 m) so "circles on the spot" get cut too.
    let loopEndIdx = -1;
    let accLen = 0;
    const maxLookAhead = Math.min(40, coords.length - i - 1);
    for (let j = 1; j <= maxLookAhead; j++) {
      accLen += haversine(coords[i + j - 1], coords[i + j]);
      if (accLen > maxDetourMeters) break;
      // A genuine loop returns near its entry after travelling more than the
      // straight-line gap would justify — detect both small U-turns and tight
      // on-the-spot circles.
      if (haversine(here, coords[i + j]) < 30 && accLen > 35) {
        loopEndIdx = i + j;
      }
    }
    out.push(here);
    if (loopEndIdx > -1) {
      i = loopEndIdx + 1;
    } else {
      i++;
    }
  }
  return out;
}

/**
 * Douglas–Peucker simplification — removes points that lie within `epsilon`
 * metres of the straight segment between their neighbours. This is what
 * smooths out the jagged micro-zig-zags /match leaves on a road that is
 * essentially straight, without dropping real corners.
 */
function simplifyPolyline(
  coords: { latitude: number; longitude: number }[],
  epsilonMeters: number,
): { latitude: number; longitude: number }[] {
  if (coords.length <= 2) return coords.slice();
  const keep = new Array(coords.length).fill(false);
  keep[0] = true;
  keep[coords.length - 1] = true;

  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let idx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpDistanceMeters(coords[i], coords[start], coords[end]);
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (maxDist > epsilonMeters && idx !== -1) {
      keep[idx] = true;
      stack.push([start, idx]);
      stack.push([idx, end]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

/** Perpendicular distance (m) of point p to the segment a→b, using a local
 *  equirectangular approximation (fine for the short spans we work with). */
function perpDistanceMeters(
  p: { latitude: number; longitude: number },
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const latRef = toRad((a.latitude + b.latitude) / 2);
  const x = (lon: number) => toRad(lon) * Math.cos(latRef) * R;
  const y = (lat: number) => toRad(lat) * R;
  const ax = x(a.longitude);
  const ay = y(a.latitude);
  const bx = x(b.longitude);
  const by = y(b.latitude);
  const px = x(p.longitude);
  const py = y(p.latitude);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
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
  /** Preferred vehicle sub-type for filtering/display. */
  vehicleKind?: 'bus' | 'tram' | 'trolley' | 'train';
  from: string;
  to: string;
  stopsCount?: number;
  /** When true, this segment corresponds to a configured dwell (pause) at a stop. */
  isDwell?: boolean;
  /** Optional details emitted by Google-Maps-like timelines. */
  headsign?: string;
  /** Intermediate stop names along the ride (for future timeline expansion). */
  intermediateStops?: string[];
}

export interface TransitOption {
  id: string;
  label: string;
  description: string;
  durationSeconds: number;
  walkMinutes: number;
  transfers: number;
  busLines: string[];
  /** Vehicle kinds present in this option (for the kind filter row). */
  vehicleKinds: ('bus' | 'tram' | 'trolley' | 'train')[];
  departureInMinutes: number;
  /** Detailed breakdown for Google-Maps-style detail sheet. */
  segments: TransitSegment[];
}

export interface TransitPlanStop {
  label: string;
  dwellMinutes: number;
}

export function buildTransitOptions(
  carDurationSeconds: number,
  distanceMeters: number,
  originLabel = 'Начало',
  destinationLabel = 'Конец',
  /** Optional via-stops between origin and destination so dwell pauses appear in the detail timeline. */
  viaStops: TransitPlanStop[] = [],
): TransitOption[] {
  if (carDurationSeconds <= 0) return [];
  const base = Math.round(carDurationSeconds * 1.4);
  const km = distanceMeters / 1000;
  const line = (n: number) => `№${Math.max(1, Math.round(km * 3) + n)}`;

  // If the user specified via-stops, we want the detail timeline to include
  // a walk→bus→…→walk sequence that "visits" each via-stop (+ its dwell pause).
  // Distribute total duration and distance proportionally across each hop.
  const allStops = [
    { label: originLabel, dwellMinutes: 0 },
    ...viaStops,
    { label: destinationLabel, dwellMinutes: 0 },
  ];
  const hopCount = allStops.length - 1;

  // Helper — build variant with a specific transfer count and vehicle-kind mix.
  type Variant = {
    id: string;
    label: string;
    description: string;
    durMul: number;
    walkFrac: number;
    lines: string[];
    kinds: ('bus' | 'tram' | 'trolley' | 'train')[];
    departIn: number;
  };

  const variants: Variant[] = [
    {
      id: 'transit-direct',
      label: 'Прямой маршрут',
      description: 'Без пересадок',
      durMul: 1.0,
      walkFrac: 0.12,
      lines: [line(0)],
      kinds: ['bus'],
      departIn: 4,
    },
    {
      id: 'transit-fast',
      label: 'С пересадкой',
      description: 'Быстрее на ~10%',
      durMul: 0.9,
      walkFrac: 0.1,
      lines: [line(2), line(5)],
      kinds: ['bus', 'tram'],
      departIn: 7,
    },
    {
      id: 'transit-slow',
      label: 'Меньше ходьбы',
      description: 'Дольше, но почти без ходьбы',
      durMul: 1.12,
      walkFrac: 0.04,
      lines: [line(1), line(4)],
      kinds: ['trolley', 'bus'],
      departIn: 12,
    },
  ];

  return variants.map((v) => {
    const totalDur = Math.round(base * v.durMul);
    const walkFracPerSide = v.walkFrac;
    const segments: TransitSegment[] = [];
    let walkMinutesSum = 0;

    // Distribute across hops — each hop becomes walk→bus→walk (shortened walks
    // when in the middle of the route).
    const hopDist = distanceMeters / Math.max(1, hopCount);
    const hopDur = totalDur / Math.max(1, hopCount);

    for (let h = 0; h < hopCount; h++) {
      const fromLabel = allStops[h].label;
      const toLabel = allStops[h + 1].label;
      const isFirstHop = h === 0;
      const isLastHop = h === hopCount - 1;

      // Walk-to-stop (only prepended on the very first hop OR when the previous
      // hop ended with bus arrival to a different area)
      if (isFirstHop) {
        const walkDist = hopDist * walkFracPerSide;
        const walkSec = Math.round(walkDist / AVG_SPEED_MPS.walking);
        walkMinutesSum += walkSec / 60;
        segments.push({
          kind: 'walk',
          durationSeconds: walkSec,
          distanceMeters: walkDist,
          from: fromLabel,
          to: 'Остановка',
        });
      }

      // Bus segment: pick one of the configured lines (alternate for multi-line variants)
      const lineForHop = v.lines[h % v.lines.length];
      const kindForHop = v.kinds[h % v.kinds.length] ?? 'bus';
      const busDist = hopDist * (1 - walkFracPerSide * (isFirstHop ? 2 : 1));
      const busSec = Math.max(60, Math.round(hopDur - (isFirstHop ? 2 : 1) * (walkFracPerSide * hopDist) / AVG_SPEED_MPS.walking));
      const stopsCount = Math.max(2, Math.round((busDist / 1000) * 1.2));
      const intermediateStops: string[] = [];
      for (let s = 1; s < stopsCount; s++) {
        intermediateStops.push(`Остановка ${s}`);
      }
      segments.push({
        kind: kindForHop === 'tram' ? 'tram' : kindForHop === 'train' ? 'train' : 'bus',
        durationSeconds: busSec,
        distanceMeters: busDist,
        line: lineForHop,
        vehicleKind: kindForHop,
        from: 'Остановка',
        to: isLastHop ? 'Остановка' : `Пересадка · ${toLabel}`,
        stopsCount,
        intermediateStops,
      });

      // Dwell at this stop (non-final stops)
      const dwellAtTo = allStops[h + 1].dwellMinutes ?? 0;
      if (!isLastHop && dwellAtTo > 0) {
        segments.push({
          kind: 'walk',
          durationSeconds: dwellAtTo * 60,
          distanceMeters: 0,
          from: toLabel,
          to: toLabel,
          isDwell: true,
        });
      }

      if (isLastHop) {
        const walkDist = hopDist * walkFracPerSide;
        const walkSec = Math.round(walkDist / AVG_SPEED_MPS.walking);
        walkMinutesSum += walkSec / 60;
        segments.push({
          kind: 'walk',
          durationSeconds: walkSec,
          distanceMeters: walkDist,
          from: 'Остановка',
          to: toLabel,
        });
      }
    }

    const realDur = segments.reduce((acc, s) => acc + (s.isDwell ? 0 : s.durationSeconds), 0);

    return {
      id: v.id,
      label: v.label,
      description: v.description,
      durationSeconds: realDur,
      walkMinutes: Math.max(1, Math.round(walkMinutesSum)),
      transfers: Math.max(0, v.lines.length - 1),
      busLines: v.lines,
      vehicleKinds: v.kinds,
      departureInMinutes: v.departIn,
      segments,
    };
  });
}

/**
 * Build `TransitOption` objects from real GTFS direct rides.
 * Each ride becomes one option: walk → bus → walk.
 */
export function buildTransitOptionsFromGtfs(
  rides: {
    route: { id: string; short_name: string; long_name: string; vehicle_kind: string; color: string | null };
    trip: { id: string; direction: number; headsign: string };
    fromStop: { id: string; name: string };
    toStop: { id: string; name: string };
    departureMinute: number;
    arrivalMinute: number;
    rideMinutes: number;
    walkFromMeters: number;
    walkToMeters: number;
    intermediateStops: string[];
    stopsCount: number;
  }[],
  originLabel: string,
  destinationLabel: string,
  reference: Date,
  viaStops: TransitPlanStop[] = [],
): TransitOption[] {
  if (rides.length === 0) return [];
  const nowMin = reference.getHours() * 60 + reference.getMinutes();

  return rides.map((ride, idx) => {
    const walkFromSec = Math.round(ride.walkFromMeters / AVG_SPEED_MPS.walking);
    const walkToSec = Math.round(ride.walkToMeters / AVG_SPEED_MPS.walking);
    const rideSec = Math.max(60, ride.rideMinutes * 60);
    const totalSec = walkFromSec + rideSec + walkToSec;
    const walkMinutes = Math.max(1, Math.round((walkFromSec + walkToSec) / 60));
    const departureInMinutes = (ride.departureMinute - nowMin + 1440) % 1440;

    const rideKind: TransitSegment['kind'] =
      ride.route.vehicle_kind === 'tram'
        ? 'tram'
        : ride.route.vehicle_kind === 'train'
          ? 'train'
          : 'bus';

    // Collapse viaStops dwells onto the single-vehicle timeline so the detail
    // pane can still show configured pauses.
    const segments: TransitSegment[] = [];
    segments.push({
      kind: 'walk',
      durationSeconds: walkFromSec,
      distanceMeters: ride.walkFromMeters,
      from: originLabel,
      to: ride.fromStop.name,
    });
    segments.push({
      kind: rideKind,
      durationSeconds: rideSec,
      distanceMeters: Math.max(
        ride.walkFromMeters,
        ride.rideMinutes * AVG_SPEED_MPS.driving * 60 * 0.55,
      ),
      line: ride.route.short_name,
      vehicleKind:
        ride.route.vehicle_kind === 'trolley'
          ? 'trolley'
          : ride.route.vehicle_kind === 'tram'
            ? 'tram'
            : ride.route.vehicle_kind === 'train'
              ? 'train'
              : 'bus',
      from: ride.fromStop.name,
      to: ride.toStop.name,
      stopsCount: ride.stopsCount,
      headsign: ride.trip.headsign,
      intermediateStops: ride.intermediateStops,
    });
    // Insert dwells from via-stops (they represent user-configured pauses at
    // the destination side of the ride — displayed as non-counted pause rows).
    for (const vs of viaStops) {
      if (vs.dwellMinutes > 0) {
        segments.push({
          kind: 'walk',
          durationSeconds: vs.dwellMinutes * 60,
          distanceMeters: 0,
          from: vs.label,
          to: vs.label,
          isDwell: true,
        });
      }
    }
    segments.push({
      kind: 'walk',
      durationSeconds: walkToSec,
      distanceMeters: ride.walkToMeters,
      from: ride.toStop.name,
      to: destinationLabel,
    });

    const vehicleKinds: TransitOption['vehicleKinds'] = [
      (ride.route.vehicle_kind === 'tram'
        ? 'tram'
        : ride.route.vehicle_kind === 'trolley'
          ? 'trolley'
          : ride.route.vehicle_kind === 'train'
            ? 'train'
            : 'bus'),
    ];

    return {
      id: `gtfs-${ride.route.id}-${ride.trip.id}-${idx}`,
      label: `${ride.route.short_name} · ${ride.trip.headsign || destinationLabel}`,
      description:
        idx === 0
          ? 'Прямой рейс'
          : `Альтернативный рейс ${idx + 1}`,
      durationSeconds: totalSec,
      walkMinutes,
      transfers: 0,
      busLines: [ride.route.short_name],
      vehicleKinds,
      departureInMinutes,
      segments,
    };
  });
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
