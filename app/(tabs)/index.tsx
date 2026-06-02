import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Brush, CalendarClock, Eye, EyeOff, Locate, Search } from 'lucide-react-native';

import MapView, {
  type MapMarker,
  type MapPolyline,
  type MapRegion,
} from '@/components/MapView';
import { DrawCanvas } from '@/components/DrawCanvas';
import { AmbiguityPrompt } from '@/components/AmbiguityPrompt';
import { MallSheet } from '@/components/MallSheet';
import { NavigationBar } from '@/components/NavigationBar';
import { RoutePlanner } from '@/components/RoutePlanner';
import { SearchSheet } from '@/components/SearchSheet';
import { TransitPlanner } from '@/components/TransitPlanner';
import { TransportScheduleSheet } from '@/components/TransportScheduleSheet';
import { Text } from '@/components/ui/text';
import {
  applyAmbiguityChoice,
  buildTransitLegsFromStops,
  computePostConnectorVariants,
  detectAmbiguousSpot,
  fetchRoute,
  formatDistance,
  formatDuration,
  matchDrawnRoute,
  matchDrawnStrokes,
  midpointOfLine,
  type GeocodeResult,
  type MatchedRoute,
  type PostConnectorVariants,
  type RouteAmbiguity,
  type TransitOption,
} from '@/lib/routing';
import { MALLS, type Mall } from '@/lib/malls';
import { useTripStore, type TransportMode } from '@/lib/stores/tripStore';

const STOP_COLORS: ('green' | 'red' | 'orange' | 'purple' | 'cyan' | 'blue')[] = [
  'green',
  'red',
  'orange',
  'purple',
  'cyan',
  'blue',
];

// Route line style per transport mode
const MODE_STYLE: Record<
  TransportMode,
  { color: string; dashed: boolean; width: number }
> = {
  driving: { color: '#2563eb', dashed: false, width: 5 },
  walking: { color: '#10b981', dashed: true, width: 4 },
  cycling: { color: '#f59e0b', dashed: false, width: 5 },
  transit: { color: '#8b5cf6', dashed: false, width: 5 },
};

const DEFAULT_REGION: MapRegion = {
  latitude: 55.751244,
  longitude: 37.618423, // Moscow — neutral starting view
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

export default function Home() {
  const stops = useTripStore((s) => s.stops);
  const mode = useTripStore((s) => s.mode);
  const legs = useTripStore((s) => s.legs);
  const setLegs = useTripStore((s) => s.setLegs);
  const setLoadingRoute = useTripStore((s) => s.setLoadingRoute);
  const addStop = useTripStore((s) => s.addStop);
  const setOriginToMyLocation = useTripStore((s) => s.setOriginToMyLocation);
  const setOriginToPlace = useTripStore((s) => s.setOriginToPlace);
  const clearStops = useTripStore((s) => s.clearStops);
  const navigating = useTripStore((s) => s.navigating);
  const setNavigating = useTripStore((s) => s.setNavigating);
  const drawnRoutes = useTripStore((s) => s.drawnRoutes);
  const addDrawnRoute = useTripStore((s) => s.addDrawnRoute);
  const setDrawnRoutes = useTripStore((s) => s.setDrawnRoutes);
  const setDrawnStrokesAdapted = useTripStore((s) => s.setDrawnStrokesAdapted);
  const setDrawnFromMainScreen = useTripStore((s) => s.setDrawnFromMainScreen);

  const [region, setRegion] = useState<MapRegion>(DEFAULT_REGION);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [plannerCollapsed, setPlannerCollapsed] = useState(false);
  const [searchMode, setSearchMode] = useState<null | 'destination' | 'origin' | 'stop'>(
    null,
  );
  const [locating, setLocating] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [drawProcessing, setDrawProcessing] = useState(false);
  /** When non-null, the current drawing session is for a partial override
   *  targeting the leg ending at this stop id (pre+draw+post get stitched). */
  const [drawTargetStopId, setDrawTargetStopId] = useState<string | null>(null);
  /** Currently selected transit variant (when user taps a bus option). */
  const [selectedTransitOption, setSelectedTransitOption] =
    useState<TransitOption | null>(null);
  /** Mall POI sheet — shown when the user taps a mall pin on the map. */
  const [activeMall, setActiveMall] = useState<Mall | null>(null);
  /** Whether mall pins are rendered on the map. Toggled with the store button. */
  const [mallsVisible, setMallsVisible] = useState(true);
  /** Transport-schedule sheet — opened via calendar button on main screen. */
  const [scheduleOpen, setScheduleOpen] = useState(false);
  /** Stop id the user is actively editing via search-sheet replace flow. */
  const [editingStopId, setEditingStopId] = useState<string | null>(null);

  /**
   * Ambiguity ("which route is better?") session. When non-null, the matched
   * route is held pending a user choice; the map is zoomed to the fork and a
   * top prompt lets the user cycle/choose variants.
   */
  const [ambiguity, setAmbiguity] = useState<{
    spot: RouteAmbiguity;
    matched: MatchedRoute;
    activeIndex: number;
  } | null>(null);
  /** Strokes to preload into the canvas when editing an existing drawn route. */
  const [initialStrokes, setInitialStrokes] = useState<
    { latitude: number; longitude: number }[][] | undefined
  >(undefined);
  /** True while the transit planner is peeked down to reveal the drawn route. */
  const [transitPeeking, setTransitPeeking] = useState(false);
  const drawnStrokesAdapted = useTripStore((s) => s.drawnStrokesAdapted);

  /**
   * Post-connector chooser for a partial drawing: two ways to finish from the
   * drawing end to the destination (a possibly-U-turning shortest route vs a
   * straight-ahead longer one). Tapping a card commits that choice.
   */
  const [postChooser, setPostChooser] = useState<{
    fromStopId: string;
    toStopId: string;
    variants: PostConnectorVariants;
    choice: 'uturn' | 'forward';
  } | null>(null);

  const routeReqRef = useRef(0);

  const plannerVisible = stops.length >= 2;

  // ---------------------------------------------------------------------
  // Geolocation
  // ---------------------------------------------------------------------
  const locate = useCallback(async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Нет доступа', 'Разрешите доступ к геолокации в настройках');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };
      setUserLocation(coords);
      setRegion({
        ...coords,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      });
      // If origin is "myLocation" stub, refresh it with real coords
      if (stops.length > 0 && stops[0].originKind === 'myLocation') {
        setOriginToMyLocation(coords);
      }
    } catch {
      Alert.alert('Ошибка', 'Не удалось определить местоположение');
    } finally {
      setLocating(false);
    }
  }, [stops, setOriginToMyLocation]);

  // Best-effort initial locate
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Lowest,
          });
          const coords = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          };
          setUserLocation(coords);
          setRegion({
            ...coords,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          });
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  // Watch device heading for the directional user-location arrow
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        sub = await Location.watchHeadingAsync((h) => {
          if (cancelled) return;
          // Use true heading when trustworthy, otherwise magnetic.
          const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (typeof deg === 'number' && Number.isFinite(deg)) {
            setHeading(deg);
          }
        });
      } catch {
        // heading unavailable on this device / platform — silent fallback
      }
    })();
    return () => {
      cancelled = true;
      if (sub) {
        try {
          sub.remove();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // ---------------------------------------------------------------------
  // Recompute route when stops or mode change
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (stops.length < 2) {
      setLegs([]);
      return;
    }
    if (stops[0].latitude === 0 && stops[0].longitude === 0) {
      setLegs([]);
      return;
    }
    const reqId = ++routeReqRef.current;
    const controller = new AbortController();
    setLoadingRoute(true);
    fetchRoute(stops, mode, controller.signal, drawnRoutes)
      .then((newLegs) => {
        if (reqId !== routeReqRef.current) return;
        setLegs(newLegs);
      })
      .catch(() => {
        if (reqId !== routeReqRef.current) return;
        setLegs([]);
      })
      .finally(() => {
        if (reqId !== routeReqRef.current) return;
        setLoadingRoute(false);
      });
    return () => controller.abort();
  }, [stops, mode, setLegs, setLoadingRoute, drawnRoutes]);

  // ---------------------------------------------------------------------
  // Fit camera to stops when planner is visible
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (navigating) return;
    if (stops.length < 2) return;
    // When any drawn override exists, don't auto-fit — the user just drew
    // it and any camera change would visually reflow/shift the view.
    if (drawnRoutes.length > 0) return;
    // When a transit option is selected, the user may pan/zoom to specific
    // segments — don't steal the camera.
    if (selectedTransitOption) return;
    const valid = stops.filter((s) => s.latitude !== 0 || s.longitude !== 0);
    if (valid.length < 2) return;
    const lats = valid.map((s) => s.latitude);
    const lons = valid.map((s) => s.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const latDelta = Math.max(0.01, (maxLat - minLat) * 1.6);
    const lonDelta = Math.max(0.01, (maxLon - minLon) * 1.6);
    setRegion({
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: latDelta,
      longitudeDelta: lonDelta,
    });
  }, [stops, navigating, drawnRoutes, selectedTransitOption]);

  // Clear selected transit option whenever mode leaves transit.
  useEffect(() => {
    if (mode !== 'transit' && selectedTransitOption) {
      setSelectedTransitOption(null);
    }
  }, [mode, selectedTransitOption]);

  // ---------------------------------------------------------------------
  const style = MODE_STYLE[mode];

  const polylines: MapPolyline[] = useMemo(() => {
    // While the post-connector chooser is open, overlay BOTH completion
    // variants: the non-chosen one in gray, the chosen one highlighted.
    if (postChooser) {
      const out: MapPolyline[] = [];
      // Underlying computed legs stay visible (drawn stretch + pre connector).
      legs.forEach((leg, i) => {
        const legStyle = MODE_STYLE[leg.mode ?? mode];
        out.push({
          id: `pc-base-${i}`,
          coordinates: leg.coordinates,
          strokeColor: leg.drawn ? '#ec4899' : legStyle.color,
          strokeWidth: leg.drawn ? legStyle.width + 1 : legStyle.width,
          lineDashPattern: legStyle.dashed ? [8, 6] : undefined,
        });
      });
      const other = postChooser.choice === 'uturn' ? 'forward' : 'uturn';
      const otherV = postChooser.variants[other];
      const chosenV = postChooser.variants[postChooser.choice];
      if (otherV.coordinates.length >= 2) {
        out.push({
          id: 'pc-other',
          coordinates: otherV.coordinates,
          strokeColor: '#9ca3af',
          strokeWidth: 5,
          lineDashPattern: [10, 8],
        });
      }
      if (chosenV.coordinates.length >= 2) {
        out.push({
          id: 'pc-chosen',
          coordinates: chosenV.coordinates,
          strokeColor: '#2563eb',
          strokeWidth: 6,
        });
      }
      return out;
    }
    // While the ambiguity prompt is open, show ONLY the active variant span
    // (zoomed-in) so the user can clearly compare options.
    if (ambiguity) {
      const variant = ambiguity.spot.variants[ambiguity.activeIndex] ?? [];
      const out: MapPolyline[] = [];
      if (ambiguity.matched.coordinates.length >= 2) {
        out.push({
          id: 'amb-context',
          coordinates: ambiguity.matched.coordinates,
          strokeColor: '#cbd5e1',
          strokeWidth: 4,
        });
      }
      if (variant.length >= 2) {
        out.push({
          id: 'amb-variant',
          coordinates: variant,
          strokeColor: '#2563eb',
          strokeWidth: 6,
        });
      }
      return out;
    }
    // While the transit planner is peeked down, show ONLY the user's drawn
    // (road-adapted) segments — no bus route, since none is chosen yet.
    if (transitPeeking) {
      return drawnStrokesAdapted
        .filter((s) => s.length >= 2)
        .map((coords, i) => ({
          id: `drawn-peek-${i}`,
          coordinates: coords,
          strokeColor: '#ec4899',
          strokeWidth: 6,
        }));
    }
    // During an active partial-drawing session, hide every pre-existing route
    // line — the user should see a clean canvas between the two target stops.
    if (drawing) return [];
    if (legs.length === 0) {
      if (stops.length >= 2) {
        return [
          {
            id: 'fallback',
            coordinates: stops.map((s) => ({
              latitude: s.latitude,
              longitude: s.longitude,
            })),
            strokeColor: style.color,
            strokeWidth: 3,
            lineDashPattern: [6, 4],
          },
        ];
      }
      return [];
    }
    return legs.map((leg, i) => {
      const isDrawn = !!leg.drawn;
      const legStyle = MODE_STYLE[leg.mode ?? mode];
      return {
        id: `leg-${i}`,
        coordinates: leg.coordinates,
        // Only the actually hand-drawn stretch is highlighted; the road-routed
        // connectors before/after a partial drawing keep the normal mode color.
        strokeColor: isDrawn ? '#ec4899' : legStyle.color,
        strokeWidth: isDrawn ? legStyle.width + 1 : legStyle.width,
        lineDashPattern: legStyle.dashed ? [8, 6] : undefined,
      };
    });
  }, [legs, stops, style, mode, drawing, ambiguity, postChooser, transitPeeking, drawnStrokesAdapted]);

  const markers: MapMarker[] = useMemo(() => {
    const out: MapMarker[] = [];

    // When the user is actively drawing a partial route between two specific
    // stops, the map should be uncluttered: show ONLY the "from" and "to"
    // stops for this drawing session, nothing else.
    if (drawing && drawTargetStopId) {
      const toIdx = stops.findIndex((s) => s.id === drawTargetStopId);
      if (toIdx > 0) {
        const fromStop = stops[toIdx - 1];
        const toStop = stops[toIdx];
        [fromStop, toStop].forEach((s, i) => {
          if (s.latitude === 0 && s.longitude === 0) return;
          if (i === 0 && s.originKind === 'myLocation') return;
          out.push({
            id: s.id,
            coordinate: { latitude: s.latitude, longitude: s.longitude },
            color: STOP_COLORS[(toIdx - 1 + i) % STOP_COLORS.length],
          });
        });
      }
      // Include user-location dot so user can see where they are while drawing
      if (userLocation) {
        const arrowHtml = `<div style="position:relative;width:40px;height:40px;pointer-events:none;display:flex;align-items:center;justify-content:center">
  <div style="position:absolute;inset:0;border-radius:9999px;background:rgba(59,130,246,0.18)"></div>
  <div style="position:absolute;width:18px;height:18px;border-radius:9999px;background:#3b82f6;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,0.35)"></div>
  ${heading != null ? `<div style="position:absolute;top:-2px;left:50%;width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:14px solid #3b82f6;transform:translateX(-50%)"></div>` : ''}
</div>`;
        out.push({
          id: 'user',
          coordinate: userLocation,
          badgeHtml: arrowHtml,
          rotationDegrees: heading ?? 0,
        });
      }
      return out;
    }

    // Stop pins (exclude origin when it's myLocation stub)
    stops.forEach((s, idx) => {
      if (idx === 0 && s.originKind === 'myLocation') return;
      if (s.latitude === 0 && s.longitude === 0) return;
      out.push({
        id: s.id,
        coordinate: { latitude: s.latitude, longitude: s.longitude },
        // No title/description — we don't want white label pills on the map.
        color: STOP_COLORS[idx % STOP_COLORS.length],
      });
    });

    // Numbered segment badges — place at midpoint of each logical segment.
    // When a segment contains a hand-drawn sub-leg, anchor the badge to that
    // drawn stretch and color it pink so the user sees which part is drawn.
    const segments = new Map<
      number,
      { coords: { latitude: number; longitude: number }[]; drawnCoords: { latitude: number; longitude: number }[] | null }
    >();
    legs.forEach((leg, i) => {
      const segIdx = leg.segmentIndex ?? i;
      const entry = segments.get(segIdx) ?? { coords: [], drawnCoords: null };
      entry.coords.push(...leg.coordinates);
      if (leg.drawn) entry.drawnCoords = leg.coordinates;
      segments.set(segIdx, entry);
    });
    segments.forEach((entry, segIdx) => {
      const isDrawn = !!entry.drawnCoords;
      const anchor = entry.drawnCoords ?? entry.coords;
      const mid = midpointOfLine(anchor);
      if (!mid) return;
      out.push({
        id: `leg-badge-${segIdx}`,
        coordinate: mid,
        badgeText: String(segIdx + 1),
        badgeColor: isDrawn ? '#ec4899' : style.color,
      });
    });

    // Dwell badges next to each stop that has a non-zero dwell (skip last)
    stops.forEach((s, idx) => {
      if (idx === 0) return;
      if (idx === stops.length - 1) return;
      if (s.dwellMinutes <= 0) return;
      if (s.latitude === 0 && s.longitude === 0) return;
      out.push({
        id: `dwell-${s.id}`,
        coordinate: { latitude: s.latitude, longitude: s.longitude },
        badgeText: `⏸ ${s.dwellMinutes}м`,
        badgeColor: '#f59e0b',
      });
    });

    if (userLocation) {
      // Heading-aware blue-dot with a directional arrow. badgeHtml so the
      // map renderer displays our styled element (no pin).
      const arrowHtml = `<div style="position:relative;width:40px;height:40px;pointer-events:none;display:flex;align-items:center;justify-content:center">
  <div style="position:absolute;inset:0;border-radius:9999px;background:rgba(59,130,246,0.18)"></div>
  <div style="position:absolute;width:18px;height:18px;border-radius:9999px;background:#3b82f6;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,0.35)"></div>
  ${
    heading != null
      ? `<div style="position:absolute;top:-2px;left:50%;width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:14px solid #3b82f6;transform:translateX(-50%)"></div>`
      : ''
  }
</div>`;
      out.push({
        id: 'user',
        coordinate: userLocation,
        badgeHtml: arrowHtml,
        rotationDegrees: heading ?? 0,
      });
    }

    // Mall POI pins — always visible. Tapping one opens the MallSheet.
    // Only add when not navigating (to keep arrival UI clean) and when
    // the user has not hidden them via the toggle.
    if (!navigating && mallsVisible) {
      MALLS.forEach((m) => {
        const mallBadge = `<div style="pointer-events:none;display:flex;align-items:center;justify-content:center;min-width:28px;height:28px;padding:0 8px;border-radius:14px;background:#111827;color:#fff;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.35);border:2px solid #fff;white-space:nowrap">🛍 ${m.name.split(' ')[0]}</div>`;
        out.push({
          id: `mall-${m.id}`,
          coordinate: { latitude: m.latitude, longitude: m.longitude },
          badgeHtml: mallBadge,
        });
      });
    }
    return out;
  }, [stops, legs, userLocation, style, heading, drawing, drawTargetStopId, navigating, mallsVisible]);

  // ---------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------
  const openDestinationSearch = () => setSearchMode('destination');
  const openOriginSearch = () => setSearchMode('origin');
  const openStopSearch = () => setSearchMode('stop');
  const closeSearch = () => {
    setSearchMode(null);
    setEditingStopId(null);
  };

  const ensureOriginFromUser = useCallback(() => {
    if (stops.length > 0) return;
    if (userLocation) {
      setOriginToMyLocation(userLocation);
    } else {
      setOriginToMyLocation({ latitude: 0, longitude: 0 });
    }
  }, [stops.length, userLocation, setOriginToMyLocation]);

  const handleSearchSelect = (r: GeocodeResult) => {
    // If we're editing an existing stop, REPLACE its coordinates/label.
    if (editingStopId) {
      useTripStore.getState().replaceStop(editingStopId, {
        label: r.shortName,
        displayName: r.displayName,
        latitude: r.latitude,
        longitude: r.longitude,
      });
      setEditingStopId(null);
      setSearchMode(null);
      return;
    }
    if (searchMode === 'origin') {
      setOriginToPlace({
        label: r.shortName,
        displayName: r.displayName,
        latitude: r.latitude,
        longitude: r.longitude,
      });
      setSearchMode(null);
      return;
    }
    if (searchMode === 'stop') {
      addStop({
        label: r.shortName,
        displayName: r.displayName,
        latitude: r.latitude,
        longitude: r.longitude,
      });
      setSearchMode(null);
      return;
    }
    // Destination flow from the main screen: this is the very first
    // destination the user is planning → default to walking mode so the
    // freshly-opened planner lands on "Пешком" automatically.
    const isFirstDestination = stops.length === 0;
    ensureOriginFromUser();
    addStop({
      label: r.shortName,
      displayName: r.displayName,
      latitude: r.latitude,
      longitude: r.longitude,
    });
    if (isFirstDestination) {
      useTripStore.getState().setMode('walking');
    }
    setSearchMode(null);
    setPlannerCollapsed(false);
  };

  const handleEditStop = useCallback((stopId: string) => {
    setEditingStopId(stopId);
    setSearchMode('stop');
  }, []);

  const handlePickMyLocation = () => {
    // Available in origin/destination contexts as a quick action.
    if (searchMode === 'origin') {
      if (userLocation) setOriginToMyLocation(userLocation);
      else setOriginToMyLocation({ latitude: 0, longitude: 0 });
      setSearchMode(null);
      return;
    }
    // Destination or stop: treat it as the current point — only useful as origin,
    // but if user chose it, make sure origin is current-location and don't add
    // a duplicate stop.
    if (searchMode === 'destination' || searchMode === 'stop') {
      if (userLocation) setOriginToMyLocation(userLocation);
      setSearchMode(null);
    }
  };

  const handlePickDraw = () => {
    setSearchMode(null);
    setDrawing(true);
  };

  const handleClosePlanner = () => {
    // Full reset: remove all stops, legs, and navigation state.
    clearStops();
    setNavigating(false);
    setPlannerCollapsed(false);
    setSelectedTransitOption(null);
  };

  const handleStartTrip = () => {
    if (stops.length < 2) return;
    if (stops[0].latitude === 0 && stops[0].longitude === 0) {
      if (userLocation) {
        setOriginToMyLocation(userLocation);
      } else {
        Alert.alert('Нет точки отправления', 'Включите геолокацию или выберите точку вручную');
        return;
      }
    }
    setNavigating(true);
    setPlannerCollapsed(true);
  };

  const handleStopTrip = () => {
    // Stop trip only — keep stops so user can resume from planner.
    setNavigating(false);
    setPlannerCollapsed(false);
  };

  const handleExitTripAndReset = () => {
    setNavigating(false);
    clearStops();
    setPlannerCollapsed(false);
  };

  const applyMatchedRoute = async (matched: MatchedRoute) => {
    if (matched.coordinates.length < 2) {
      Alert.alert('Не удалось', 'Не получилось распознать маршрут');
      return;
    }

    // Case A — drawing for a specific destination stop (partial route)
    if (drawTargetStopId) {
      const currentStops = useTripStore.getState().stops;
      const toIdx = currentStops.findIndex((s) => s.id === drawTargetStopId);
      if (toIdx <= 0) {
        setDrawTargetStopId(null);
        setDrawing(false);
        return;
      }
      const fromStop = currentStops[toIdx - 1];
      const toStop = currentStops[toIdx];
      addDrawnRoute({
        fromStopId: fromStop.id,
        toStopId: toStop.id,
        coordinates: matched.coordinates,
        distanceMeters: matched.distanceMeters,
        durationSeconds: matched.durationSeconds,
        partial: true,
      });
      // Preserve the currently selected transport mode — the user may have
      // drawn a bus override, a driving override, etc. Do NOT force walking.
      setDrawTargetStopId(null);
      setDrawing(false);
      // Show the planner expanded so the user can immediately see the route
      // summary (total time / distance) down to the bottom of the sheet.
      setPlannerCollapsed(false);

      // Offer two ways to finish the connector from the drawing end to the
      // destination: a possibly-U-turning shortest route vs a straight-ahead
      // longer one. Only prompt when they meaningfully differ.
      const drawEnd = matched.coordinates[matched.coordinates.length - 1];
      const destPt = { latitude: toStop.latitude, longitude: toStop.longitude };
      try {
        const variants = await computePostConnectorVariants(drawEnd, destPt, mode);
        if (variants) {
          setPostChooser({
            fromStopId: fromStop.id,
            toStopId: toStop.id,
            variants,
            choice: 'uturn',
          });
          // Zoom to the area covering both completion variants.
          const pts = [
            ...variants.uturn.coordinates,
            ...variants.forward.coordinates,
          ];
          if (pts.length >= 2) {
            const lats = pts.map((p) => p.latitude);
            const lons = pts.map((p) => p.longitude);
            const minLat = Math.min(...lats);
            const maxLat = Math.max(...lats);
            const minLon = Math.min(...lons);
            const maxLon = Math.max(...lons);
            setRegion({
              latitude: (minLat + maxLat) / 2,
              longitude: (minLon + maxLon) / 2,
              latitudeDelta: Math.max(0.006, (maxLat - minLat) * 1.8),
              longitudeDelta: Math.max(0.006, (maxLon - minLon) * 1.8),
            });
          }
        }
      } catch {
        // ignore — connector chooser is optional
      }
      return;
    }

    // Case B — fresh drawn trip (2 stops, full override). This always comes
    // from a main-screen drawing → default to WALKING and remember that the
    // trip was drawn from the main screen (enables the transit peek strip).
    const first = matched.coordinates[0];
    const last = matched.coordinates[matched.coordinates.length - 1];
    clearStops();
    setOriginToPlace({
      label: 'Начало маршрута',
      latitude: first.latitude,
      longitude: first.longitude,
    });
    addStop({
      label: 'Конец маршрута',
      latitude: last.latitude,
      longitude: last.longitude,
    });
    const newStops = useTripStore.getState().stops;
    if (newStops.length >= 2) {
      setDrawnRoutes([
        {
          fromStopId: newStops[0].id,
          toStopId: newStops[1].id,
          coordinates: matched.coordinates,
          distanceMeters: matched.distanceMeters,
          durationSeconds: matched.durationSeconds,
        },
      ]);
    }
    // Default to walking right after drawing from the main screen.
    useTripStore.getState().setMode('walking');
    setDrawnFromMainScreen(true);
    setDrawnStrokesAdapted(
      matched.snappedStrokes ?? [matched.coordinates],
    );
    setDrawing(false);
    setInitialStrokes(undefined);
    // Expanded so the route summary (total time + distance) is visible.
    setPlannerCollapsed(false);
  };

  const finalizeMatched = async (matched: MatchedRoute) => {
    await applyMatchedRoute(matched);
  };

  /** Run ambiguity detection on a matched route; if uncertain, open the
   *  learning prompt instead of finalizing. Otherwise finalize directly. */
  const maybePromptThenApply = async (
    matched: MatchedRoute,
    rawStrokes: { latitude: number; longitude: number }[][],
  ) => {
    try {
      const spot = await detectAmbiguousSpot(rawStrokes, matched.coordinates, mode);
      if (spot && spot.variants.length >= 2) {
        // Hold the matched route, zoom to the fork, show the prompt.
        setAmbiguity({ spot, matched, activeIndex: 0 });
        setRegion({
          latitude: spot.center.latitude,
          longitude: spot.center.longitude,
          latitudeDelta: spot.delta,
          longitudeDelta: spot.delta,
        });
        setDrawing(false);
        return;
      }
    } catch {
      // detection failure → just finalize
    }
    await finalizeMatched(matched);
  };

  const handleConfirmDrawing = async (
    coords: { latitude: number; longitude: number }[],
  ) => {
    setDrawProcessing(true);
    try {
      const matched = await matchDrawnRoute(coords, mode);
      await maybePromptThenApply(matched, [coords]);
    } catch {
      Alert.alert('Ошибка', 'Не удалось построить маршрут по рисунку');
    } finally {
      setDrawProcessing(false);
    }
  };

  const handleConfirmDrawingStrokes = async (
    strokes: { latitude: number; longitude: number }[][],
  ) => {
    setDrawProcessing(true);
    try {
      const matched = await matchDrawnStrokes(strokes, mode);
      await maybePromptThenApply(matched, strokes);
    } catch {
      Alert.alert('Ошибка', 'Не удалось построить маршрут по рисунку');
    } finally {
      setDrawProcessing(false);
    }
  };

  // ---- Ambiguity prompt handlers ----
  const handleAmbiguityPrev = () =>
    setAmbiguity((a) =>
      a
        ? {
            ...a,
            activeIndex:
              (a.activeIndex - 1 + a.spot.variants.length) %
              a.spot.variants.length,
          }
        : a,
    );
  const handleAmbiguityNext = () =>
    setAmbiguity((a) =>
      a
        ? {
            ...a,
            activeIndex: (a.activeIndex + 1) % a.spot.variants.length,
          }
        : a,
    );
  const handleAmbiguityChoose = async () => {
    if (!ambiguity) return;
    const finalCoords = applyAmbiguityChoice(
      ambiguity.matched.coordinates,
      ambiguity.spot,
      ambiguity.activeIndex,
    );
    const resolved: MatchedRoute = {
      ...ambiguity.matched,
      coordinates: finalCoords,
    };
    setAmbiguity(null);
    await finalizeMatched(resolved);
  };

  const handleDrawForStop = useCallback((stopId: string) => {
    setDrawTargetStopId(stopId);
    setInitialStrokes(undefined);
    setDrawing(true);
  }, []);

  /** Re-enter the draw canvas with the existing drawn route(s) preloaded so the
   *  user can erase / reorder / extend them. Uses the adapted strokes captured
   *  at draw time when available, falling back to the stored override coords. */
  const handleEditDrawnRoute = useCallback(() => {
    const adapted = useTripStore.getState().drawnStrokesAdapted;
    const routes = useTripStore.getState().drawnRoutes;
    const seed =
      adapted.length > 0
        ? adapted
        : routes.map((r) => r.coordinates).filter((c) => c.length >= 2);
    setInitialStrokes(seed.length ? seed : undefined);
    setDrawTargetStopId(null);
    setDrawing(true);
  }, []);

  /** Commit the chosen post-connector for a partial drawing, then close. */
  const handleChoosePostConnector = (choice: 'uturn' | 'forward') => {
    if (!postChooser) return;
    const variant = postChooser.variants[choice];
    const existing = useTripStore
      .getState()
      .drawnRoutes.find(
        (r) =>
          r.fromStopId === postChooser.fromStopId &&
          r.toStopId === postChooser.toStopId,
      );
    if (existing) {
      addDrawnRoute({
        ...existing,
        postConnector: {
          coordinates: variant.coordinates,
          distanceMeters: variant.distanceMeters,
        },
      });
    }
    setPostChooser(null);
  };

  const handleCancelDrawing = () => {
    setDrawing(false);
    setDrawTargetStopId(null);
    setInitialStrokes(undefined);
  };

  /** User erased all strokes while editing an existing drawn route → drop the
   *  whole drawn trip (overrides, adapted strokes, stops) and return to map. */
  const handleClearDrawnAll = () => {
    setDrawnRoutes([]);
    setDrawnStrokesAdapted([]);
    setDrawnFromMainScreen(false);
    clearStops();
    setSelectedTransitOption(null);
    setDrawTargetStopId(null);
    setInitialStrokes(undefined);
    setDrawing(false);
  };

  const handleSelectTransitOption = useCallback(
    (opt: TransitOption | null) => {
      setSelectedTransitOption(opt);
      if (!opt) return;
      const cur = useTripStore.getState().stops;
      if (cur.length < 2) return;
      const origin = { latitude: cur[0].latitude, longitude: cur[0].longitude };
      const dest = {
        latitude: cur[cur.length - 1].latitude,
        longitude: cur[cur.length - 1].longitude,
      };
      const reqId = ++routeReqRef.current;
      // Rebuild displayed legs around the option's real bus-stop coordinates so
      // walking connects to/from the actual stops (clean walk→bus→walk).
      buildTransitLegsFromStops(origin, dest, opt)
        .then((built) => {
          if (reqId !== routeReqRef.current) return;
          if (built && built.length > 0) setLegs(built);
        })
        .catch(() => {
          // keep existing legs on failure
        });
    },
    [setLegs],
  );

  /**
   * Zoom the map to a specific segment of the currently-selected transit
   * option. Since transit segments are synthesized from a single car-profile
   * polyline, we slice the overall route coordinates proportionally to the
   * cumulative distance share of each option segment up to `segmentIndex`.
   */
  const handleZoomToSegment = useCallback(
    (segmentIndex: number) => {
      const opt = selectedTransitOption;
      if (!opt) return;
      if (legs.length === 0) return;
      // Flatten all coords of the primary leg (transit has a single logical leg).
      const all: { latitude: number; longitude: number }[] = [];
      for (const l of legs) all.push(...l.coordinates);
      if (all.length < 2) return;
      // Cumulative arc length
      const cum: number[] = [0];
      for (let i = 1; i < all.length; i++) {
        const a = all[i - 1];
        const b = all[i];
        const dLat = b.latitude - a.latitude;
        const dLon = b.longitude - a.longitude;
        cum.push(cum[i - 1] + Math.sqrt(dLat * dLat + dLon * dLon));
      }
      const total = cum[cum.length - 1] || 1;
      // Ratio share per option.segment (by distanceMeters)
      const totalSegDist = opt.segments.reduce(
        (sum, s) => sum + Math.max(1, s.distanceMeters),
        0,
      );
      let startRatio = 0;
      for (let i = 0; i < segmentIndex; i++) {
        startRatio += Math.max(1, opt.segments[i].distanceMeters) / totalSegDist;
      }
      const endRatio =
        startRatio +
        Math.max(1, opt.segments[segmentIndex].distanceMeters) / totalSegDist;
      const startDist = total * startRatio;
      const endDist = total * endRatio;
      // Find coord range matching those cumulative distances
      let startIdx = 0;
      let endIdx = all.length - 1;
      for (let i = 0; i < cum.length; i++) {
        if (cum[i] >= startDist) {
          startIdx = Math.max(0, i - 1);
          break;
        }
      }
      for (let i = startIdx; i < cum.length; i++) {
        if (cum[i] >= endDist) {
          endIdx = i;
          break;
        }
      }
      const slice = all.slice(startIdx, Math.max(endIdx + 1, startIdx + 2));
      if (slice.length < 2) return;
      const lats = slice.map((c) => c.latitude);
      const lons = slice.map((c) => c.longitude);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLon = Math.min(...lons);
      const maxLon = Math.max(...lons);
      const latDelta = Math.max(0.006, (maxLat - minLat) * 1.8);
      const lonDelta = Math.max(0.006, (maxLon - minLon) * 1.8);
      setRegion({
        latitude: (minLat + maxLat) / 2,
        longitude: (minLon + maxLon) / 2,
        latitudeDelta: latDelta,
        longitudeDelta: lonDelta,
      });
    },
    [selectedTransitOption, legs],
  );

  const handleMarkerPress = useCallback((marker: MapMarker) => {
    const id = marker.id ?? '';
    if (id.startsWith('mall-')) {
      const mallId = id.slice('mall-'.length);
      const mall = MALLS.find((m) => m.id === mallId);
      if (mall) setActiveMall(mall);
    }
  }, []);

  const handleUserLocationUpdate = useCallback(
    (coord: { latitude: number; longitude: number }) => {
      setUserLocation(coord);
      if (navigating) {
        setRegion({
          latitude: coord.latitude,
          longitude: coord.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
      }
    },
    [navigating],
  );

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  // Hide top "Куда едем?" bar once user has picked at least one destination
  // (i.e. a trip is being planned).
  const showTopSearchBar = !drawing && !navigating && !ambiguity && !postChooser && stops.length === 0;
  // Brush is only available when no trip is being planned yet OR planner is expanded.
  const showBrush =
    !drawing && !navigating && !ambiguity && !postChooser && (stops.length === 0 || !plannerCollapsed);

  return (
    <View style={{ flex: 1 }} className="bg-background">
      <MapView
        style={{ flex: 1 }}
        region={region}
        onRegionChangeComplete={setRegion}
        markers={markers}
        polylines={polylines}
        onMarkerPress={handleMarkerPress}
        showsUserLocation
        mapType="standard"
      />

      {/* Top search bar — only when no trip is being planned */}
      {showTopSearchBar ? (
        <SafeAreaView edges={['top']} style={{ position: 'absolute', left: 0, right: 0, top: 0 }}>
          <View className="px-4 pt-2">
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={openDestinationSearch}
                className="flex-1 flex-row items-center gap-3 rounded-2xl bg-card px-4 py-3"
                style={{
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.12,
                  shadowRadius: 8,
                  elevation: 6,
                }}
              >
                <Search size={18} color="#666" />
                <Text className="flex-1 text-base text-muted-foreground">
                  Куда едем?
                </Text>
                <View className="rounded-full bg-primary/10 px-2 py-1">
                  <Text className="text-xs font-semibold text-primary">Rido</Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => setScheduleOpen(true)}
                className="h-[50px] w-[50px] items-center justify-center rounded-2xl bg-card"
                style={{
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.12,
                  shadowRadius: 8,
                  elevation: 6,
                }}
              >
                <CalendarClock size={22} color="#2563eb" />
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      ) : null}

      {/* Persistent top button — re-enter draw editor whenever a drawn route
          exists on the main screen (does not disappear when planner collapses). */}
      {drawnRoutes.length > 0 && !drawing && !navigating && !ambiguity ? (
        <SafeAreaView
          edges={['top']}
          pointerEvents="box-none"
          style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
        >
          <View className="px-4 pt-2" pointerEvents="box-none">
            <Pressable
              onPress={handleEditDrawnRoute}
              className="flex-row items-center gap-2 self-start rounded-full bg-card px-4 py-2.5"
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.16,
                shadowRadius: 8,
                elevation: 6,
              }}
            >
              <View className="h-6 w-6 items-center justify-center rounded-full bg-pink-500">
                <Brush size={13} color="#fff" />
              </View>
              <Text className="text-sm font-semibold text-foreground">
                Изменить нарисованный маршрут
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      ) : null}

      {/* Navigation bar (while in trip mode) */}
      {navigating ? (
        <NavigationBar
          onBack={handleStopTrip}
          onExit={handleExitTripAndReset}
          onUserLocation={handleUserLocationUpdate}
        />
      ) : null}

      {/* Floating controls (right side) */}
      {!drawing && !ambiguity && !postChooser ? (
        <SafeAreaView
          edges={['top']}
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            right: 0,
            left: 0,
            top: selectedTransitOption ? 0 : undefined,
            bottom: selectedTransitOption ? undefined : 0,
          }}
        >
          <View
            className="absolute right-4"
            style={{
              top: selectedTransitOption ? 8 : undefined,
              bottom: selectedTransitOption
                ? undefined
                : plannerVisible && !plannerCollapsed
                  ? 360
                  : plannerVisible && plannerCollapsed
                    ? 120
                    : 40,
            }}
            pointerEvents="box-none"
          >
            {showBrush && !selectedTransitOption ? (
              <Pressable
                onPress={() => setDrawing(true)}
                className="mb-3 h-12 w-12 items-center justify-center rounded-full bg-card"
                style={{
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.18,
                  shadowRadius: 6,
                  elevation: 6,
                }}
              >
                <Brush size={20} color="#2563eb" />
              </Pressable>
            ) : null}
            {/* Mall visibility toggle — always available while the map is shown */}
            {!navigating ? (
              <Pressable
                onPress={() => setMallsVisible((v) => !v)}
                className="mb-3 h-12 w-12 items-center justify-center rounded-full bg-card"
                style={{
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.18,
                  shadowRadius: 6,
                  elevation: 6,
                }}
              >
                {mallsVisible ? (
                  <Eye size={20} color="#2563eb" />
                ) : (
                  <EyeOff size={20} color="#6b7280" />
                )}
              </Pressable>
            ) : null}
            {!navigating ? (
              <Pressable
                onPress={locate}
                className="h-12 w-12 items-center justify-center rounded-full bg-card"
                style={{
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.18,
                  shadowRadius: 6,
                  elevation: 6,
                }}
              >
                {locating ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Locate size={22} color="#2563eb" />
                )}
              </Pressable>
            ) : null}
          </View>
        </SafeAreaView>
      ) : null}

      {/* Planner bottom sheet (non-transit modes) */}
      {plannerVisible && !navigating && !drawing && !ambiguity && !postChooser && mode !== 'transit' ? (
        <RoutePlanner
          collapsed={plannerCollapsed}
          onToggleCollapsed={() => setPlannerCollapsed((v) => !v)}
          onClose={handleClosePlanner}
          onStartTrip={handleStartTrip}
          onChangeOrigin={openOriginSearch}
          onAddStop={openStopSearch}
          onDrawForStop={handleDrawForStop}
          onEditStop={handleEditStop}
          onEditDrawnRoute={handleEditDrawnRoute}
        />
      ) : null}

      {/* Transit full-screen planner */}
      {plannerVisible && !navigating && !drawing && !ambiguity && !postChooser && mode === 'transit' ? (
        <TransitPlanner
          onClose={handleClosePlanner}
          onAddStop={openStopSearch}
          onChangeOrigin={openOriginSearch}
          onDrawForStop={handleDrawForStop}
          onSelectOption={handleSelectTransitOption}
          onZoomToSegment={handleZoomToSegment}
          onEditStop={handleEditStop}
          onPeekChange={setTransitPeeking}
        />
      ) : null}

      {/* Drawing canvas */}
      {drawing ? (
        <DrawCanvas
          region={region}
          onRegionChange={setRegion}
          onCancel={handleCancelDrawing}
          onConfirm={handleConfirmDrawing}
          onConfirmStrokes={handleConfirmDrawingStrokes}
          processing={drawProcessing}
          partial={drawTargetStopId !== null}
          initialStrokes={initialStrokes}
          onClearAll={handleClearDrawnAll}
        />
      ) : null}

      {/* Ambiguity learning prompt */}
      {ambiguity ? (
        <AmbiguityPrompt
          variantCount={ambiguity.spot.variants.length}
          activeIndex={ambiguity.activeIndex}
          onPrev={handleAmbiguityPrev}
          onNext={handleAmbiguityNext}
          onChoose={handleAmbiguityChoose}
        />
      ) : null}

      {/* Post-connector chooser — two ways to finish a partial drawing. */}
      {postChooser ? (
        <>
          {/* Top hint */}
          <SafeAreaView
            edges={['top']}
            pointerEvents="box-none"
            style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
          >
            <View className="px-4 pt-2">
              <View
                className="rounded-2xl bg-card px-4 py-3"
                style={{
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.14,
                  shadowRadius: 8,
                  elevation: 6,
                }}
              >
                <Text className="text-sm font-semibold text-foreground">
                  Как доехать до точки?
                </Text>
                <Text className="mt-0.5 text-[11px] text-muted-foreground">
                  Выберите, как достроить путь от конца линии до точки. Это
                  помогает строить маршрут точнее.
                </Text>
              </View>
            </View>
          </SafeAreaView>

          {/* Bottom variant cards */}
          <SafeAreaView
            edges={['bottom']}
            pointerEvents="box-none"
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
          >
            <View className="gap-2 px-4 pb-4">
              {(['uturn', 'forward'] as const).map((key) => {
                const v = postChooser.variants[key];
                const isPrimary = key === 'uturn';
                const selected = postChooser.choice === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => {
                      setPostChooser((p) => (p ? { ...p, choice: key } : p));
                      handleChoosePostConnector(key);
                    }}
                    className={`flex-row items-center justify-between rounded-2xl border-2 bg-card px-4 py-3 ${
                      selected ? 'border-primary' : 'border-border'
                    }`}
                    style={{
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.12,
                      shadowRadius: 8,
                      elevation: 5,
                    }}
                  >
                    <View className="flex-1 flex-row items-center gap-3">
                      <View
                        className="h-3 w-3 rounded-full"
                        style={{
                          backgroundColor: isPrimary ? '#2563eb' : '#9ca3af',
                        }}
                      />
                      <View className="flex-1">
                        <Text className="text-sm font-semibold text-foreground">
                          {isPrimary
                            ? 'Короткий (с разворотом)'
                            : 'Длиннее (без разворота)'}
                        </Text>
                        <Text className="text-[11px] text-muted-foreground">
                          {formatDuration(v.durationSeconds)} ·{' '}
                          {formatDistance(v.distanceMeters)}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-xs font-semibold text-primary">
                      Выбрать
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </SafeAreaView>
        </>
      ) : null}

      {/* Global search sheet */}
      {searchMode !== null ? (
        <View className="absolute inset-0 z-50">
          <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <SearchSheet
              placeholder={
                searchMode === 'origin'
                  ? 'Откуда'
                  : searchMode === 'stop'
                    ? 'Добавить остановку'
                    : 'Куда едем?'
              }
              onSelect={handleSearchSelect}
              onClose={closeSearch}
              onPickMyLocation={
                userLocation || searchMode !== 'origin' ? handlePickMyLocation : undefined
              }
              onPickDraw={handlePickDraw}
            />
          </SafeAreaView>
        </View>
      ) : null}

      {/* Mall POI sheet */}
      <MallSheet mall={activeMall} onClose={() => setActiveMall(null)} />

      {/* Transport schedule sheet (GTFS-backed Supabase data) */}
      <TransportScheduleSheet
        visible={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
      />
    </View>
  );
}
