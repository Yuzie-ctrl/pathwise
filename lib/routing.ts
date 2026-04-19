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

  return legs;
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
