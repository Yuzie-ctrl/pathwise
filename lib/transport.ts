import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VehicleKind = 'bus' | 'tram' | 'trolley' | 'night_bus' | 'county_bus';
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
  departureMinute: number; // minutes from midnight
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

export function vehicleColor(kind: VehicleKind, operator: Operator): string {
  if (kind === 'tram') return '#ea580c';
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
    .from('transport_routes')
    .select('*')
    .order('short_name');
  if (error) throw error;
  return (data ?? []) as TransportRoute[];
}

export async function searchStops(q: string): Promise<TransportStop[]> {
  const { data, error } = await supabase
    .from('transport_stops')
    .select('*')
    .ilike('name', `${q}%`)
    .order('name')
    .limit(20);
  if (error) throw error;
  return (data ?? []) as TransportStop[];
}

export async function searchRoutes(q: string): Promise<TransportRoute[]> {
  const { data, error } = await supabase
    .from('transport_routes')
    .select('*')
    .ilike('short_name', `${q}%`)
    .order('short_name')
    .limit(30);
  if (error) throw error;
  return (data ?? []) as TransportRoute[];
}

export async function fetchRoute(routeId: string): Promise<TransportRoute | null> {
  const { data, error } = await supabase
    .from('transport_routes')
    .select('*')
    .eq('id', routeId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as TransportRoute | null;
}

export async function fetchRouteTrips(routeId: string): Promise<TransportTrip[]> {
  const { data, error } = await supabase
    .from('transport_trips')
    .select('*')
    .eq('route_id', routeId)
    .order('direction');
  if (error) throw error;
  return (data ?? []) as TransportTrip[];
}

export async function fetchStopById(stopId: string): Promise<TransportStop | null> {
  const { data, error } = await supabase
    .from('transport_stops')
    .select('*')
    .eq('id', stopId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as TransportStop | null;
}

/**
 * Return the ordered list of stops for a given trip, with the typical
 * offset in minutes from the trip start.
 */
export async function fetchTripStops(tripId: string): Promise<RouteStopListItem[]> {
  const { data, error } = await supabase
    .from('transport_stop_times')
    .select('sequence, offset_minutes, stop:transport_stops(*)')
    .eq('trip_id', tripId)
    .order('sequence');
  if (error) throw error;
  const rows = (data ?? []) as unknown as {
    sequence: number;
    offset_minutes: number;
    stop: TransportStop;
  }[];
  return rows.map((r) => ({
    sequence: r.sequence,
    offset_minutes: r.offset_minutes,
    stop: r.stop,
  }));
}

/**
 * List all routes that stop at a given stop (across all trips).
 */
export async function fetchRoutesAtStop(stopId: string): Promise<TransportRoute[]> {
  const { data, error } = await supabase
    .from('transport_stop_times')
    .select('trip:transport_trips(route:transport_routes(*))')
    .eq('stop_id', stopId);
  if (error) throw error;
  type Row = { trip: { route: TransportRoute } | null };
  const rows = (data ?? []) as unknown as Row[];
  const seen = new Set<string>();
  const routes: TransportRoute[] = [];
  for (const r of rows) {
    const rt = r.trip?.route;
    if (rt && !seen.has(rt.id)) {
      seen.add(rt.id);
      routes.push(rt);
    }
  }
  routes.sort((a, b) => a.short_name.localeCompare(b.short_name, 'et'));
  return routes;
}

/**
 * Compute the next N arrivals at a stop for a given reference date.
 * Returns items sorted by minutesUntil ascending.
 */
export async function fetchNextArrivals(
  stopId: string,
  reference: Date,
  limit = 6,
): Promise<NextArrival[]> {
  // 1. All stop_times for this stop with their trip + route.
  const { data, error } = await supabase
    .from('transport_stop_times')
    .select(
      'trip_id, offset_minutes, trip:transport_trips(*, route:transport_routes(*))',
    )
    .eq('stop_id', stopId);
  if (error) throw error;
  type Row = {
    trip_id: string;
    offset_minutes: number;
    trip: (TransportTrip & { route: TransportRoute }) | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return [];

  const tripIds = Array.from(new Set(rows.map((r) => r.trip_id)));
  const svcDay = serviceDayFor(reference);
  const nowMin = minutesFromMidnight(reference);

  const { data: depData, error: depErr } = await supabase
    .from('transport_trip_departures')
    .select('trip_id, departure_minute')
    .in('trip_id', tripIds)
    .eq('service_day', svcDay)
    .gte('departure_minute', Math.max(0, nowMin - 60))
    .order('departure_minute');
  if (depErr) throw depErr;

  const departures = (depData ?? []) as {
    trip_id: string;
    departure_minute: number;
  }[];

  // Index stop_times by trip
  const offsetByTrip = new Map<string, Row>();
  for (const r of rows) offsetByTrip.set(r.trip_id, r);

  const arrivals: NextArrival[] = [];
  for (const dep of departures) {
    const st = offsetByTrip.get(dep.trip_id);
    if (!st || !st.trip || !st.trip.route) continue;
    const arrivalMin = dep.departure_minute + st.offset_minutes;
    const minutesUntil = arrivalMin - nowMin;
    if (minutesUntil < 0) continue;
    arrivals.push({
      route: st.trip.route,
      trip: st.trip,
      minutesUntil,
      departureMinute: dep.departure_minute,
      arrivalMinute: arrivalMin,
    });
  }
  arrivals.sort((a, b) => a.minutesUntil - b.minutesUntil);

  // Keep only next unique (route + direction) arrivals up to `limit`.
  const seen = new Set<string>();
  const out: NextArrival[] = [];
  for (const a of arrivals) {
    const key = `${a.route.id}:${a.trip.direction}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * All arrival times at a given stop on a given service day, for a specific trip.
 * Used by "schedule grid" (hour × minutes) view.
 */
export async function fetchStopDailyArrivals(
  stopId: string,
  tripId: string,
  serviceDay: ServiceDay,
): Promise<number[]> {
  // offset on the trip for this stop
  const { data: off, error: offErr } = await supabase
    .from('transport_stop_times')
    .select('offset_minutes')
    .eq('stop_id', stopId)
    .eq('trip_id', tripId)
    .maybeSingle();
  if (offErr) throw offErr;
  if (!off) return [];
  const offset = off.offset_minutes as number;

  const { data, error } = await supabase
    .from('transport_trip_departures')
    .select('departure_minute')
    .eq('trip_id', tripId)
    .eq('service_day', serviceDay)
    .order('departure_minute');
  if (error) throw error;
  return (data ?? []).map((r) => (r.departure_minute as number) + offset);
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
  // sort minutes
  for (const [h, arr] of map) {
    arr.sort((a, b) => a - b);
    map.set(h, arr);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Favorites (local storage via AsyncStorage)
// ---------------------------------------------------------------------------

export interface TransportFavorite {
  /** Format: `${routeId}:${tripId}:${stopId}` */
  id: string;
  routeId: string;
  tripId: string;
  stopId: string;
  label: string;   // "115 Tammneeme - Randvere - Mähe - Tallinn"
  stopLabel: string; // "Randvere keskus"
  addedAt: number;
}
