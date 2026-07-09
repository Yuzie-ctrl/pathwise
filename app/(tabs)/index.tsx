import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import {
  Brush,
  CalendarClock,
  Eye,
  EyeOff,
  Locate,
  Search,
} from 'lucide-react-native';

import MapView, {
  type MapMarker,
  type MapPolyline,
  type MapRegion,
} from '@/components/MapView';
import { DrawCanvas } from '@/components/DrawCanvas';
import { AmbiguityPrompt } from '@/components/AmbiguityPrompt';
import { DestinationPreviewBar } from '@/components/DestinationPreviewBar';
import { MallSheet } from '@/components/MallSheet';
import { NavigationBar } from '@/components/NavigationBar';
import { RoutePlanner, type SheetStage } from '@/components/RoutePlanner';
import { SavedPlaceEditor } from '@/components/SavedPlaceEditor';
import { SavedPlacesRow } from '@/components/SavedPlacesRow';
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
  type TransitSegment,
} from '@/lib/routing';
import { MALLS, type Mall } from '@/lib/malls';
import { useTripStore, type TransportMode } from '@/lib/stores/tripStore';
import {
  isPlaceSet,
  useSavedPlaces,
  type SavedPlace,
  type SavedPlaceIcon,
} from '@/lib/stores/savedPlacesStore';

const STOP_COLORS: ('green' | 'red' | 'orange' | 'purple' | 'cyan' | 'blue')[] =
  ['green', 'red', 'orange', 'purple', 'cyan', 'blue'];

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
  const [plannerStage, setPlannerStage] = useState<SheetStage>('half');
  const [searchMode, setSearchMode] = useState<
    null | 'destination' | 'origin' | 'stop'
  >(null);
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
  /** When set, the transport-schedule sheet opens directly to this view. */
  const [scheduleInitialView, setScheduleInitialView] = useState<
    | {
        kind: 'stopDetail';
        stopId: string;
        routeId?: string;
        tripId?: string;
        serviceDay: 'weekday' | 'saturday' | 'sunday';
      }
    | undefined
  >(undefined);
  /** Stop id the user is actively editing via search-sheet replace flow. */
  const [editingStopId, setEditingStopId] = useState<string | null>(null);
  /**
   * A place chosen from the main search (or a set favorite) that is being
   * previewed on the map with a labeled marker + "В путь!" bar, before the
   * point selection opens.
   */
  const [pendingDestination, setPendingDestination] =
    useState<GeocodeResult | null>(null);
  /**
   * Saved-place editor session. `place` is the slot being edited (null for a
   * brand-new custom favorite); `creating` requires name + icon input.
   */
  const [placeEditor, setPlaceEditor] = useState<{
    place: SavedPlace | null;
    creating: boolean;
  } | null>(null);
  /** Live marker for the address currently previewed inside the editor. */
  const [editorPreview, setEditorPreview] = useState<GeocodeResult | null>(
    null,
  );

  const setPlaceLocation = useSavedPlaces((s) => s.setPlaceLocation);
  const addCustomPlace = useSavedPlaces((s) => s.addCustomPlace);
  const updatePlace = useSavedPlaces((s) => s.updatePlace);
  const removePlace = useSavedPlaces((s) => s.removePlace);
  const recordRecent = useSavedPlaces((s) => s.recordRecent);

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
  /** When set, skip the next fit-to-stops auto-camera (used right after we
   *  explicitly zoom to the first stop on search-select). */
  const suppressFitRef = useRef(false);

  const plannerVisible = stops.length >= 2;

  // ---------------------------------------------------------------------
  // Geolocation
  // ---------------------------------------------------------------------
  const locate = useCallback(async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Нет доступа',
          'Разрешите доступ к геолокации в настройках',
        );
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
    // Skip once when we just explicitly zoomed to the first stop.
    if (suppressFitRef.current) {
      suppressFitRef.current = false;
      return;
    }
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
  }, [
    legs,
    stops,
    style,
    mode,
    drawing,
    ambiguity,
    postChooser,
    transitPeeking,
    drawnStrokesAdapted,
  ]);

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
    // Hidden while drawing/editing so the overall-route number circle does
    // not linger over the canvas.
    if (!drawing) {
      const segments = new Map<
        number,
        {
          coords: { latitude: number; longitude: number }[];
          drawnCoords: { latitude: number; longitude: number }[] | null;
        }
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
    }

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
    // Previewed destination (from search or a set favorite) — a labeled pin.
    if (pendingDestination && !navigating) {
      const labelBadge = `<div style="pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:2px">
  <div style="max-width:180px;padding:4px 10px;border-radius:14px;background:#2563eb;color:#fff;font-size:12px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.35);border:2px solid #fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${pendingDestination.shortName.replace(/</g, '&lt;')}</div>
  <div style="width:14px;height:14px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35)"></div>
</div>`;
      out.push({
        id: 'pending-destination',
        coordinate: {
          latitude: pendingDestination.latitude,
          longitude: pendingDestination.longitude,
        },
        badgeHtml: labelBadge,
      });
    }
    // Editor preview — a labeled pin for the address being picked in the
    // saved-place editor (so the chosen spot is visibly marked on the map).
    if (editorPreview) {
      const previewBadge = `<div style="pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:2px">
  <div style="max-width:180px;padding:4px 10px;border-radius:14px;background:#2563eb;color:#fff;font-size:12px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.35);border:2px solid #fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${editorPreview.shortName.replace(/</g, '&lt;')}</div>
  <div style="width:14px;height:14px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35)"></div>
</div>`;
      out.push({
        id: 'editor-preview',
        coordinate: {
          latitude: editorPreview.latitude,
          longitude: editorPreview.longitude,
        },
        badgeHtml: previewBadge,
      });
    }
    return out;
  }, [
    stops,
    legs,
    userLocation,
    style,
    heading,
    drawing,
    drawTargetStopId,
    navigating,
    mallsVisible,
    pendingDestination,
    editorPreview,
  ]);

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
    // Destination flow from the main screen: instead of jumping straight into
    // point selection, show the place on the map with a labeled marker and a
    // "В путь!" bar. Committing (В путь!) opens the point selection.
    setPendingDestination(r);
    setSearchMode(null);
    centerOnPlace(r.latitude, r.longitude);
  };

  /** Commit the previewed destination → build the trip and open the planner. */
  const commitDestination = (r: GeocodeResult) => {
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
    recordRecent({
      displayName: r.displayName,
      shortName: r.shortName,
      latitude: r.latitude,
      longitude: r.longitude,
    });
    setPendingDestination(null);
    setPlannerStage('half');
    // Zoom the map in on the first (start) point of the route.
    zoomToFirstStop();
  };

  // ---------------------------------------------------------------------
  // Saved places
  // ---------------------------------------------------------------------
  /** Tap a saved-place chip. If it has an address → preview it on the map with
   *  a "В путь!" bar. If unset → open the editor so the user can assign one. */
  const handleSavedPlacePress = (place: SavedPlace) => {
    if (isPlaceSet(place)) {
      const r: GeocodeResult = {
        displayName: place.displayName || place.name,
        shortName: place.name,
        latitude: place.latitude as number,
        longitude: place.longitude as number,
      };
      setPendingDestination(r);
      centerOnPlace(r.latitude, r.longitude);
    } else {
      setEditorPreview(null);
      setPlaceEditor({ place, creating: false });
    }
  };

  /** Long-press a saved-place chip → open the editor (change address/name/icon). */
  const handleSavedPlaceEdit = (place: SavedPlace) => {
    setEditorPreview(
      isPlaceSet(place)
        ? {
            displayName: place.displayName || place.name,
            shortName: place.name,
            latitude: place.latitude as number,
            longitude: place.longitude as number,
          }
        : null,
    );
    setPlaceEditor({ place, creating: false });
  };

  /** Tap the "+ Любимые" chip → create a new custom favorite. */
  const handleAddSavedPlace = () => {
    setEditorPreview(null);
    setPlaceEditor({ place: null, creating: true });
  };

  /** Live preview inside the editor — pan/zoom the (dimmed) map to the pick
   *  and drop a marker so the chosen spot is visible behind the scrim. */
  const handleEditorPreview = (r: GeocodeResult) => {
    setEditorPreview(r);
    centerOnPlace(r.latitude, r.longitude);
  };

  /** Commit changes from the editor. */
  const handleEditorSave = (data: {
    name: string;
    icon: SavedPlaceIcon;
    iconColor: string;
    location: GeocodeResult;
  }) => {
    if (!placeEditor) return;
    if (placeEditor.creating || !placeEditor.place) {
      addCustomPlace({
        name: data.name,
        icon: data.icon,
        iconColor: data.iconColor,
        displayName: data.location.displayName,
        latitude: data.location.latitude,
        longitude: data.location.longitude,
      });
    } else {
      const p = placeEditor.place;
      if (p.kind === 'custom') {
        updatePlace(p.id, {
          name: data.name,
          icon: data.icon,
          iconColor: data.iconColor,
        });
      }
      setPlaceLocation(p.id, {
        displayName: data.location.displayName,
        latitude: data.location.latitude,
        longitude: data.location.longitude,
      });
    }
    recordRecent({
      displayName: data.location.displayName,
      shortName: data.location.shortName,
      latitude: data.location.latitude,
      longitude: data.location.longitude,
    });
    // Close the editor (removes the dimming scrim) and clear the preview
    // marker so the map is fully interactive again after "Выбрать".
    setEditorPreview(null);
    setPlaceEditor(null);
  };

  /** Remove the place being edited. */
  const handleEditorRemove = () => {
    if (!placeEditor?.place) {
      setPlaceEditor(null);
      return;
    }
    removePlace(placeEditor.place.id);
    setEditorPreview(null);
    setPlaceEditor(null);
  };

  /** Animate the camera so the ENTIRE route is visible within the TOP HALF of
   *  the screen (with a small margin). We fit all valid stops, then push the
   *  region center downward (south) by ~a quarter of the latitude span so the
   *  route sits in the upper portion of the map rather than dead-center. */
  const zoomToFirstStop = useCallback(() => {
    const cur = useTripStore.getState().stops;
    const valid = cur.filter((s) => s.latitude !== 0 || s.longitude !== 0);
    if (valid.length === 0) return;
    suppressFitRef.current = true;

    if (valid.length === 1) {
      const only = valid[0];
      const latDelta = 0.02;
      setRegion({
        // Push the single point up into the top half: shift center south.
        latitude: only.latitude - latDelta * 0.25,
        longitude: only.longitude,
        latitudeDelta: latDelta,
        longitudeDelta: latDelta,
      });
      return;
    }

    const lats = valid.map((s) => s.latitude);
    const lons = valid.map((s) => s.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    // The route must occupy roughly the top half, so the visible latitude span
    // needs to be ~2x the route span (route in top half + margin below). Add a
    // small extra margin factor so it isn't flush against the edges.
    const rawLatSpan = maxLat - minLat;
    const rawLonSpan = maxLon - minLon;
    const latDelta = Math.max(0.01, rawLatSpan * 2.3 + 0.004);
    const lonDelta = Math.max(0.01, rawLonSpan * 1.4 + 0.004);
    const routeCenterLat = (minLat + maxLat) / 2;
    // Shift the map center south so the route's center lands in the middle of
    // the TOP half of the viewport (i.e. ~a quarter of the viewport above the
    // real vertical center).
    setRegion({
      latitude: routeCenterLat - latDelta * 0.25,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: latDelta,
      longitudeDelta: lonDelta,
    });
  }, []);

  /** Fit the camera so an explicit set of coordinates (e.g. a drawn route)
   *  fits within the TOP HALF of the screen with a small margin. */
  const zoomToCoords = useCallback(
    (coords: { latitude: number; longitude: number }[]) => {
      const valid = coords.filter((c) => c.latitude !== 0 || c.longitude !== 0);
      if (valid.length < 2) {
        zoomToFirstStop();
        return;
      }
      suppressFitRef.current = true;
      const lats = valid.map((c) => c.latitude);
      const lons = valid.map((c) => c.longitude);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLon = Math.min(...lons);
      const maxLon = Math.max(...lons);
      const latDelta = Math.max(0.01, (maxLat - minLat) * 2.3 + 0.004);
      const lonDelta = Math.max(0.01, (maxLon - minLon) * 1.4 + 0.004);
      setRegion({
        latitude: (minLat + maxLat) / 2 - latDelta * 0.25,
        longitude: (minLon + maxLon) / 2,
        latitudeDelta: latDelta,
        longitudeDelta: lonDelta,
      });
    },
    [zoomToFirstStop],
  );

  /** Center the map on a point with a medium (close) zoom, point dead-center. */
  const centerOnPlace = useCallback((lat: number, lon: number) => {
    suppressFitRef.current = true;
    setRegion({
      latitude: lat,
      longitude: lon,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    });
  }, []);

  /** Open search in "stop" mode pre-loaded with the given stop id so the
   *  user can replace it with a new location. */
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
    setPlannerStage('half');
    setSelectedTransitOption(null);
  };

  const handleStartTrip = () => {
    if (stops.length < 2) return;
    if (stops[0].latitude === 0 && stops[0].longitude === 0) {
      if (userLocation) {
        setOriginToMyLocation(userLocation);
      } else {
        Alert.alert(
          'Нет точки отправления',
          'Включите геолокацию или выберите точку вручную',
        );
        return;
      }
    }
    setNavigating(true);
    setPlannerStage('collapsed');
  };

  const handleStopTrip = () => {
    // Stop trip only — keep stops so user can resume from planner.
    setNavigating(false);
    setPlannerStage('half');
  };

  const handleExitTripAndReset = () => {
    setNavigating(false);
    clearStops();
    setPlannerStage('half');
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
      // Half-open the planner so both the map and the point list are visible.
      setPlannerStage('half');
      // Fit the drawn route within the top half of the screen.
      zoomToCoords(matched.coordinates);

      // Offer two ways to finish the connector from the drawing end to the
      // destination: a possibly-U-turning shortest route vs a straight-ahead
      // longer one. Only prompt when they meaningfully differ.
      const drawEnd = matched.coordinates[matched.coordinates.length - 1];
      const destPt = { latitude: toStop.latitude, longitude: toStop.longitude };
      try {
        const variants = await computePostConnectorVariants(
          drawEnd,
          destPt,
          mode,
        );
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
          snappedStrokes: matched.snappedStrokes,
        },
      ]);
    }
    // Default to walking right after drawing from the main screen.
    useTripStore.getState().setMode('walking');
    setDrawnFromMainScreen(true);
    setDrawnStrokesAdapted(matched.snappedStrokes ?? [matched.coordinates]);
    setDrawing(false);
    setInitialStrokes(undefined);
    // Half-open the planner so both the map and the point list are visible.
    setPlannerStage('half');
    // Fit the whole drawn route within the top half of the screen.
    zoomToCoords(matched.coordinates);
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
      const spot = await detectAmbiguousSpot(
        rawStrokes,
        matched.coordinates,
        mode,
      );
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

  /** Open the transport-schedule sheet directly at a specific bus's schedule
   *  for a specific boarding stop (from the transit detail timeline). */
  const handleOpenBusSchedule = useCallback((seg: TransitSegment) => {
    if (!seg.fromStopId) return;
    const d = new Date().getDay();
    const serviceDay: 'weekday' | 'saturday' | 'sunday' =
      d === 0 ? 'sunday' : d === 6 ? 'saturday' : 'weekday';
    setScheduleInitialView({
      kind: 'stopDetail',
      stopId: seg.fromStopId,
      routeId: seg.routeId,
      tripId: seg.tripId,
      serviceDay,
    });
    setScheduleOpen(true);
  }, []);

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
        startRatio +=
          Math.max(1, opt.segments[i].distanceMeters) / totalSegDist;
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
  const showTopSearchBar =
    !drawing &&
    !navigating &&
    !ambiguity &&
    !postChooser &&
    !pendingDestination &&
    !placeEditor &&
    stops.length === 0;
  // Brush is only available when no trip is being planned yet OR planner isn't collapsed.
  const showBrush =
    !drawing &&
    !navigating &&
    !ambiguity &&
    !postChooser &&
    !pendingDestination &&
    (stops.length === 0 || plannerStage !== 'collapsed');
  /** True while the map controls should render as a top-right column: either on
   *  the fresh main screen or while picking points (planner/transit open). */
  const showMapControls =
    !drawing && !ambiguity && !postChooser && !navigating && !placeEditor;

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
        <SafeAreaView
          edges={['top']}
          style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
        >
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
                  <Text className="text-xs font-semibold text-primary">
                    Rido
                  </Text>
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
          {/* Saved places row (Дом, Работа, любимые, +) */}
          <View className="pt-2">
            <SavedPlacesRow
              onPressPlace={handleSavedPlacePress}
              onEditPlace={handleSavedPlaceEdit}
              onAddPlace={handleAddSavedPlace}
            />
          </View>
        </SafeAreaView>
      ) : null}

      {/* Persistent top button — re-enter draw editor. Shown centered at the
          top whenever the user is in point selection (a drawn override
          exists and we're not drawing / navigating). */}
      {drawnRoutes.length > 0 && !drawing && !navigating && !ambiguity ? (
        <SafeAreaView
          edges={['top']}
          pointerEvents="box-none"
          style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
        >
          <View className="items-center px-4 pt-2" pointerEvents="box-none">
            <Pressable
              onPress={handleEditDrawnRoute}
              className="flex-row items-center gap-2 self-center rounded-full bg-card px-4 py-2.5"
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

      {/* Floating map controls — always a top-right column. On the main screen
          they sit below the search bar + saved-places row; while picking points
          they sit at the very top-right. Order: гео, видимость ТЦ, нарисовать. */}
      {showMapControls ? (
        <SafeAreaView
          edges={['top']}
          pointerEvents="box-none"
          style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
        >
          <View
            className="absolute right-4"
            style={{ top: showTopSearchBar ? 132 : 8 }}
            pointerEvents="box-none"
          >
            <Pressable
              onPress={locate}
              className="mb-3 h-12 w-12 items-center justify-center rounded-full bg-card"
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
            {showBrush ? (
              <Pressable
                onPress={() => setDrawing(true)}
                className="h-12 w-12 items-center justify-center rounded-full bg-card"
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
          </View>
        </SafeAreaView>
      ) : null}

      {/* Planner bottom sheet (non-transit modes) */}
      {plannerVisible &&
      !navigating &&
      !drawing &&
      !ambiguity &&
      !postChooser &&
      mode !== 'transit' ? (
        <RoutePlanner
          stage={plannerStage}
          onStageChange={setPlannerStage}
          onClose={handleClosePlanner}
          onStartTrip={handleStartTrip}
          onChangeOrigin={openOriginSearch}
          onAddStop={openStopSearch}
          onDrawForStop={handleDrawForStop}
          onEditStop={handleEditStop}
        />
      ) : null}

      {/* Transit full-screen planner */}
      {plannerVisible &&
      !navigating &&
      !drawing &&
      !ambiguity &&
      !postChooser &&
      mode === 'transit' ? (
        <TransitPlanner
          onClose={handleClosePlanner}
          onAddStop={openStopSearch}
          onChangeOrigin={openOriginSearch}
          onDrawForStop={handleDrawForStop}
          onSelectOption={handleSelectTransitOption}
          onZoomToSegment={handleZoomToSegment}
          onOpenBusSchedule={handleOpenBusSchedule}
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

      {/* Destination preview — labeled marker + "В путь!" (from search or a set
          favorite). Committing opens the point selection. */}
      {pendingDestination &&
      !navigating &&
      !drawing &&
      !ambiguity &&
      !postChooser &&
      !placeEditor ? (
        <DestinationPreviewBar
          label={pendingDestination.shortName}
          detail={
            pendingDestination.displayName !== pendingDestination.shortName
              ? pendingDestination.displayName
              : undefined
          }
          onGo={() => commitDestination(pendingDestination)}
          onCancel={() => setPendingDestination(null)}
        />
      ) : null}

      {/* Saved-place editor (assign / edit address, name, icon) */}
      {placeEditor ? (
        <SavedPlaceEditor
          place={placeEditor.place}
          creating={placeEditor.creating}
          onPreviewLocation={handleEditorPreview}
          onSave={handleEditorSave}
          onRemove={handleEditorRemove}
          onClose={() => {
            setEditorPreview(null);
            setPlaceEditor(null);
          }}
        />
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
                userLocation || searchMode !== 'origin'
                  ? handlePickMyLocation
                  : undefined
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
        initialView={scheduleInitialView}
        onClose={() => {
          setScheduleOpen(false);
          setScheduleInitialView(undefined);
        }}
      />
    </View>
  );
}
