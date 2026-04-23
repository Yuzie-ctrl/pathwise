import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Real source of truth: user-provided GTFS tables in Supabase
// Tables (case & spaces matter):
//   - GTFS_Rido_routes
//   - "GTFS Rido stops"
//   - "GTFS Rido trips"
//   - "GTFS Rido stop times"
//
// Columns used:
//   routes:     route_id (string hash), route_short_name, route_long_name,
//               route_type (int), route_color (hex no #), competent_authority
//   stops:      stop_id (int), stop_name, stop_lat, stop_lon, stop_area,
//               authority
//   trips:      route_id, service_id (int), trip_id (int), trip_headsign,
//               trip_long_name, direction_code ("A>B" / "B>A")
//   stop times: trip_id, arrival_time "HH:MM:SS", departure_time "HH:MM:SS",
//               stop_id, stop_sequence
//
// No calendar/calendar_dates is exposed, so we cannot filter by weekday.
// We show ALL departures regardless of selected day (the day picker in UI
// becomes a no-op but is kept for future calendar support).
// ---------------------------------------------------------------------------

const ROUTES_TABLE = 'GTFS_Rido_routes';
const STOPS_TABLE = 'GTFS Rido stops';
const TRIPS_TABLE = 'GTFS Rido trips';
const STOP_TIMES_TABLE = 'GTFS Rido stop times';

// Scope the app to Tallinn + Harjumaa only per product brief.
const ALLOWED_AUTHORITIES = ['Tallinna TA', 'Harjumaa ÜTK'];

// ---------------------------------------------------------------------------
// Public types — kept stable, TransportScheduleSheet depends on these.
// ---------------------------------------------------------------------------

export type VehicleKind =
  | 'bus'
  | 'tram'
  | 'trolley'
  | 'night_bus'
  | 'county_bus';
export type Operator = 'tallinn' | 'harjumaa';
export type ServiceDay = 'weekday' | 'saturday' | 'sunday';

export interface TransportRoute {
  id: string;
  short_name: string;
  long_name: string;
  vehicle_kind: VehicleKind;
  operator: Operator;
  color: string | null;
}

export interface TransportStop {
  id: string;
  name: string;
  name_alt: string | null;
  latitude: number;
  longitude: number;
}

export interface TransportTrip {
  id: string;
  route_id: string;
  direction: number;
  headsign: string;
}

export interface TransportStopTime {
  trip_id: string;
  stop_id: string;
  sequence: number;
  offset_minutes: number;
}

export interface TransportDeparture {
  trip_id: string;
  service_day: ServiceDay;
  departure_minute: number;
}

export interface RouteStopListItem {
  sequence: number;
  offset_minutes: number;
  stop: TransportStop;
}

export interface NextArrival {
  route: TransportRoute;
  trip: TransportTrip;
  minutesUntil: number;
  departureMinute: number;
  arrivalMinute: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function serviceDayFor(date: Date): ServiceDay {
  const d = date.getDay();
  if (d === 0) return 'sunday';
  if (d === 6) return 'saturday';
  return 'weekday';
}

export function minutesFromMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function minuteToHHMM(m: number): string {
  const total = ((m % 1440) + 1440) % 1440;
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}

/** "HH:MM:SS" → minutes-from-midnight. GTFS allows > 24 h (late-night). */
function parseGtfsTimeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length < 2) return null;
  const hh = Number.parseInt(parts[0], 10);
  const mm = Number.parseInt(parts[1], 10);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm; // can be >= 1440 for post-midnight trips — fine.
}

function routeTypeToVehicleKind(routeType: number, shortName: string): VehicleKind {
  // GTFS route_type: 0=tram/light rail, 2=rail, 3=bus, 11=trolley, 800=trolley.
  if (routeType === 0) return 'tram';
  if (routeType === 11 || routeType === 800) return 'trolley';
  // Tallinn night buses typically have "N" prefix.
  if (/^N\d/i.test(shortName)) return 'night_bus';
  // Harjumaa county buses are "V" lines or mainline pure-digit buses.
  if (/^V\d/i.test(shortName)) return 'county_bus';
  return 'bus';
}

function authorityToOperator(authority: string | null | undefined): Operator {
  if (authority === 'Tallinna TA') return 'tallinn';
  return 'harjumaa';
}

function normalizeColor(c: string | null | undefined): string | null {
  if (!c) return null;
  const s = c.trim();
  if (!s) return null;
  if (s.startsWith('#')) return s;
  return `#${s}`;
}

type RawRoute = {
  route_id: string;
  route_short_name: string;
  route_long_name: string | null;
  route_type: number;
  route_color: string | null;
  competent_authority: string | null;
};

function mapRoute(r: RawRoute): TransportRoute {
  const shortName = r.route_short_name ?? '';
  return {
    id: r.route_id,
    short_name: shortName,
    long_name: r.route_long_name ?? '',
    vehicle_kind: routeTypeToVehicleKind(r.route_type ?? 3, shortName),
    operator: authorityToOperator(r.competent_authority),
    color: normalizeColor(r.route_color),
  };
}

type RawStop = {
  stop_id: number;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  alias: string | null;
};

function mapStop(s: RawStop): TransportStop {
  return {
    id: String(s.stop_id),
    name: s.stop_name ?? '',
    name_alt: s.alias ?? null,
    latitude: Number(s.stop_lat),
    longitude: Number(s.stop_lon),
  };
}

type RawTrip = {
  trip_id: number;
  route_id: string;
  direction_code: string | null;
  trip_headsign: string | null;
  trip_long_name: string | null;
};

function mapTrip(t: RawTrip): TransportTrip {
  const dir = t.direction_code === 'B>A' ? 1 : 0;
  return {
    id: String(t.trip_id),
    route_id: t.route_id,
    direction: dir,
    headsign: t.trip_headsign ?? t.trip_long_name ?? '',
  };
}

export function vehicleColor(kind: VehicleKind, operator: Operator): string {
  if (kind === 'tram') return '#ea580c';
  if (kind === 'trolley') return '#7c3aed';
  if (kind === 'night_bus') return '#1e293b';
  if (operator === 'harjumaa') return '#b91c1c';
  return '#10b981';
}

export function vehicleLabel(kind: VehicleKind): string {
  switch (kind) {
    case 'tram':
      return 'Трамвай';
    case 'trolley':
      return 'Троллейбус';
    case 'night_bus':
      return 'Ночной автобус';
    case 'county_bus':
      return 'Пригородный';
    default:
      return 'Автобус';
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function fetchAllRoutes(): Promise<TransportRoute[]> {
  const { data, error } = await supabase
    .from(ROUTES_TABLE)
    .select(
      'route_id, route_short_name, route_long_name, route_type, route_color, competent_authority',
    )
    .in('competent_authority', ALLOWED_AUTHORITIES)
    .order('route_short_name');
  if (error) throw error;
  return ((data ?? []) as RawRoute[]).map(mapRoute);
}

export async function searchStops(q: string): Promise<TransportStop[]> {
  const needle = q.trim();
  if (!needle) return [];
  const { data, error } = await supabase
    .from(STOPS_TABLE)
    .select('stop_id, stop_name, stop_lat, stop_lon, alias')
    .ilike('stop_name', `%${needle}%`)
    .order('stop_name')
    .limit(20);
  if (error) throw error;
  return ((data ?? []) as RawStop[]).map(mapStop);
}

export async function searchRoutes(q: string): Promise<TransportRoute[]> {
  const needle = q.trim();
  if (!needle) return [];
  const { data, error } = await supabase
    .from(ROUTES_TABLE)
    .select(
      'route_id, route_short_name, route_long_name, route_type, route_color, competent_authority',
    )
    .ilike('route_short_name', `${needle}%`)
    .in('competent_authority', ALLOWED_AUTHORITIES)
    .order('route_short_name')
    .limit(40);
  if (error) throw error;
  return ((data ?? []) as RawRoute[]).map(mapRoute);
}

export async function fetchRoute(routeId: string): Promise<TransportRoute | null> {
  const { data, error } = await supabase
    .from(ROUTES_TABLE)
    .select(
      'route_id, route_short_name, route_long_name, route_type, route_color, competent_authority',
    )
    .eq('route_id', routeId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRoute(data as RawRoute) : null;
}

export async function fetchRouteTrips(routeId: string): Promise<TransportTrip[]> {
  // Many GTFS feeds have dozens of trips per route (one per service). For the
  // "choose direction" view we only need one representative trip per direction.
  const { data, error } = await supabase
    .from(TRIPS_TABLE)
    .select('trip_id, route_id, direction_code, trip_headsign, trip_long_name')
    .eq('route_id', routeId)
    .limit(500);
  if (error) throw error;
  const raw = (data ?? []) as RawTrip[];
  // Dedupe: one trip per (direction_code, trip_headsign).
  const seen = new Set<string>();
  const out: TransportTrip[] = [];
  for (const r of raw) {
    const key = `${r.direction_code ?? '?'}|${r.trip_headsign ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mapTrip(r));
    if (out.length >= 4) break; // at most 2 directions × up to 2 variants
  }
  out.sort((a, b) => a.direction - b.direction);
  return out;
}

export async function fetchStopById(stopId: string): Promise<TransportStop | null> {
  const idNum = Number.parseInt(stopId, 10);
  if (Number.isNaN(idNum)) return null;
  const { data, error } = await supabase
    .from(STOPS_TABLE)
    .select('stop_id, stop_name, stop_lat, stop_lon, alias')
    .eq('stop_id', idNum)
    .maybeSingle();
  if (error) throw error;
  return data ? mapStop(data as RawStop) : null;
}

export async function fetchTripStops(tripId: string): Promise<RouteStopListItem[]> {
  const idNum = Number.parseInt(tripId, 10);
  if (Number.isNaN(idNum)) return [];

  // 1. Get stop_times rows for this trip.
  const { data: stRows, error: stErr } = await supabase
    .from(STOP_TIMES_TABLE)
    .select('stop_id, stop_sequence, arrival_time, departure_time')
    .eq('trip_id', idNum)
    .order('stop_sequence');
  if (stErr) throw stErr;
  const times = (stRows ?? []) as {
    stop_id: number;
    stop_sequence: number;
    arrival_time: string | null;
    departure_time: string | null;
  }[];
  if (times.length === 0) return [];

  const firstMinutes =
    parseGtfsTimeToMinutes(times[0].departure_time ?? times[0].arrival_time) ?? 0;

  // 2. Bulk-fetch the stop records.
  const stopIds = Array.from(new Set(times.map((t) => t.stop_id)));
  const { data: stops, error: stopsErr } = await supabase
    .from(STOPS_TABLE)
    .select('stop_id, stop_name, stop_lat, stop_lon, alias')
    .in('stop_id', stopIds);
  if (stopsErr) throw stopsErr;
  const stopById = new Map<number, TransportStop>();
  for (const s of (stops ?? []) as RawStop[]) stopById.set(s.stop_id, mapStop(s));

  const out: RouteStopListItem[] = [];
  for (const t of times) {
    const stop = stopById.get(t.stop_id);
    if (!stop) continue;
    const m = parseGtfsTimeToMinutes(t.arrival_time ?? t.departure_time);
    out.push({
      sequence: t.stop_sequence,
      offset_minutes: m == null ? 0 : m - firstMinutes,
      stop,
    });
  }
  return out;
}

export async function fetchRoutesAtStop(stopId: string): Promise<TransportRoute[]> {
  const idNum = Number.parseInt(stopId, 10);
  if (Number.isNaN(idNum)) return [];

  // 1. Find distinct trip_ids serving this stop (capped).
  const { data: stRows, error: stErr } = await supabase
    .from(STOP_TIMES_TABLE)
    .select('trip_id')
    .eq('stop_id', idNum)
    .limit(2000);
  if (stErr) throw stErr;
  const tripIds = Array.from(
    new Set(((stRows ?? []) as { trip_id: number }[]).map((r) => r.trip_id)),
  );
  if (tripIds.length === 0) return [];

  // 2. Bulk-fetch trips to get their route_ids.
  const { data: trips, error: tErr } = await supabase
    .from(TRIPS_TABLE)
    .select('trip_id, route_id')
    .in('trip_id', tripIds.slice(0, 500));
  if (tErr) throw tErr;
  const routeIds = Array.from(
    new Set(
      ((trips ?? []) as { trip_id: number; route_id: string }[]).map(
        (t) => t.route_id,
      ),
    ),
  );
  if (routeIds.length === 0) return [];

  // 3. Bulk-fetch the routes, filtered to allowed authorities.
  const { data: routes, error: rErr } = await supabase
    .from(ROUTES_TABLE)
    .select(
      'route_id, route_short_name, route_long_name, route_type, route_color, competent_authority',
    )
    .in('route_id', routeIds)
    .in('competent_authority', ALLOWED_AUTHORITIES);
  if (rErr) throw rErr;
  const out = ((routes ?? []) as RawRoute[]).map(mapRoute);
  out.sort((a, b) => a.short_name.localeCompare(b.short_name, 'et'));
  return out;
}

/**
 * Compute the next N arrivals at a stop. Ignores weekday/sat/sun filter
 * because calendar table is not exposed.
 */
export async function fetchNextArrivals(
  stopId: string,
  reference: Date,
  limit = 6,
): Promise<NextArrival[]> {
  const idNum = Number.parseInt(stopId, 10);
  if (Number.isNaN(idNum)) return [];

  const nowMin = minutesFromMidnight(reference);

  // 1. All stop_times for this stop.
  const { data: st, error: stErr } = await supabase
    .from(STOP_TIMES_TABLE)
    .select('trip_id, arrival_time, departure_time')
    .eq('stop_id', idNum)
    .limit(3000);
  if (stErr) throw stErr;
  const times = (st ?? []) as {
    trip_id: number;
    arrival_time: string | null;
    departure_time: string | null;
  }[];
  if (times.length === 0) return [];

  // Index arrival minute per trip at this stop.
  const arrMinByTrip = new Map<number, number>();
  for (const t of times) {
    const m = parseGtfsTimeToMinutes(t.arrival_time ?? t.departure_time);
    if (m == null) continue;
    // Only the earliest time at this stop per trip (in case of duplicates).
    const prev = arrMinByTrip.get(t.trip_id);
    if (prev == null || m < prev) arrMinByTrip.set(t.trip_id, m);
  }

  const tripIds = Array.from(arrMinByTrip.keys());
  if (tripIds.length === 0) return [];

  // 2. Fetch trips → route_id map (chunked if large).
  const CHUNK = 300;
  const tripById = new Map<number, RawTrip>();
  for (let i = 0; i < tripIds.length; i += CHUNK) {
    const slice = tripIds.slice(i, i + CHUNK);
    const { data: trips, error: tErr } = await supabase
      .from(TRIPS_TABLE)
      .select('trip_id, route_id, direction_code, trip_headsign, trip_long_name')
      .in('trip_id', slice);
    if (tErr) throw tErr;
    for (const t of (trips ?? []) as RawTrip[]) tripById.set(t.trip_id, t);
  }

  // 3. Fetch routes (only allowed authorities).
  const routeIds = Array.from(
    new Set(Array.from(tripById.values()).map((t) => t.route_id)),
  );
  const routeById = new Map<string, TransportRoute>();
  for (let i = 0; i < routeIds.length; i += CHUNK) {
    const slice = routeIds.slice(i, i + CHUNK);
    const { data: routes, error: rErr } = await supabase
      .from(ROUTES_TABLE)
      .select(
        'route_id, route_short_name, route_long_name, route_type, route_color, competent_authority',
      )
      .in('route_id', slice)
      .in('competent_authority', ALLOWED_AUTHORITIES);
    if (rErr) throw rErr;
    for (const r of (routes ?? []) as RawRoute[])
      routeById.set(r.route_id, mapRoute(r));
  }

  const candidates: NextArrival[] = [];
  for (const [tripId, arrMin] of arrMinByTrip) {
    const trip = tripById.get(tripId);
    if (!trip) continue;
    const route = routeById.get(trip.route_id);
    if (!route) continue; // out-of-scope operator
    const normalized = arrMin % 1440;
    const minutesUntil = (normalized - nowMin + 1440) % 1440;
    candidates.push({
      route,
      trip: mapTrip(trip),
      minutesUntil,
      departureMinute: normalized,
      arrivalMinute: normalized,
    });
  }
  candidates.sort((a, b) => a.minutesUntil - b.minutesUntil);

  // Keep first arrival per (route, direction).
  const seen = new Set<string>();
  const out: NextArrival[] = [];
  for (const a of candidates) {
    const key = `${a.route.id}:${a.trip.direction}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * All arrival minutes (mod 1440) at `stopId` for the given trip pattern,
 * across all service calendars. Used by the hour × minutes grid.
 */
export async function fetchStopDailyArrivals(
  stopId: string,
  tripId: string,
  // kept for API compatibility; calendar not exposed by this dataset
  _serviceDay: ServiceDay,
): Promise<number[]> {
  const stopNum = Number.parseInt(stopId, 10);
  const tripNum = Number.parseInt(tripId, 10);
  if (Number.isNaN(stopNum) || Number.isNaN(tripNum)) return [];

  // 1. Find the sequence of the given stop in the reference trip.
  const { data: refRows, error: refErr } = await supabase
    .from(STOP_TIMES_TABLE)
    .select('stop_sequence')
    .eq('trip_id', tripNum)
    .eq('stop_id', stopNum)
    .maybeSingle();
  if (refErr) throw refErr;
  if (!refRows) return [];

  // 2. Resolve the route_id of this reference trip.
  const { data: refTrip, error: refTripErr } = await supabase
    .from(TRIPS_TABLE)
    .select('trip_id, route_id, direction_code, trip_headsign')
    .eq('trip_id', tripNum)
    .maybeSingle();
  if (refTripErr) throw refTripErr;
  if (!refTrip) return [];

  // 3. All trips on this route with the SAME direction & headsign — they form
  //    the family of departures for this direction.
  const { data: sisterTrips, error: sisterErr } = await supabase
    .from(TRIPS_TABLE)
    .select('trip_id, direction_code, trip_headsign')
    .eq('route_id', (refTrip as { route_id: string }).route_id)
    .limit(2000);
  if (sisterErr) throw sisterErr;
  const refTyped = refTrip as {
    route_id: string;
    direction_code: string | null;
    trip_headsign: string | null;
  };
  const sameDirection = (sisterTrips ?? []).filter(
    (t: { direction_code: string | null; trip_headsign: string | null }) =>
      t.direction_code === refTyped.direction_code &&
      t.trip_headsign === refTyped.trip_headsign,
  ) as { trip_id: number }[];
  const tripIds = Array.from(new Set(sameDirection.map((t) => t.trip_id)));
  if (tripIds.length === 0) return [];

  // 4. Pull arrival_time at this stop for all sister trips.
  const CHUNK = 300;
  const minutes: number[] = [];
  for (let i = 0; i < tripIds.length; i += CHUNK) {
    const slice = tripIds.slice(i, i + CHUNK);
    const { data: st, error: stErr } = await supabase
      .from(STOP_TIMES_TABLE)
      .select('arrival_time, departure_time, trip_id')
      .eq('stop_id', stopNum)
      .in('trip_id', slice);
    if (stErr) throw stErr;
    for (const row of (st ?? []) as {
      arrival_time: string | null;
      departure_time: string | null;
    }[]) {
      const m = parseGtfsTimeToMinutes(row.arrival_time ?? row.departure_time);
      if (m == null) continue;
      minutes.push(m % 1440);
    }
  }
  minutes.sort((a, b) => a - b);
  // Dedupe exact duplicates (service calendars × same clock time).
  const deduped: number[] = [];
  for (const m of minutes) if (deduped[deduped.length - 1] !== m) deduped.push(m);
  return deduped;
}

/**
 * Group arrivals (minutes from midnight) by hour → minutes-in-hour.
 */
export function groupArrivalsByHour(arrivals: number[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const m of arrivals) {
    const hour = Math.floor(m / 60) % 24;
    const minute = m % 60;
    const arr = map.get(hour) ?? [];
    arr.push(minute);
    map.set(hour, arr);
  }
  for (const [h, arr] of map) {
    arr.sort((a, b) => a - b);
    map.set(h, arr);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Favorites — shape only (store lives in lib/stores/transportFavoritesStore.ts)
// ---------------------------------------------------------------------------

export interface TransportFavorite {
  id: string;
  routeId: string;
  tripId: string;
  stopId: string;
  label: string;
  stopLabel: string;
  addedAt: number;
}
