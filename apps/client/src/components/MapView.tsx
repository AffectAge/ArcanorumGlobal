import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import { Crosshair, Lock, LockOpen, LocateFixed, MapPinned, Minus, Move, Plus } from "lucide-react";
import { toast } from "sonner";
import type { Country } from "@arcanorum/shared";
import { Tooltip } from "./Tooltip";
import { ColonizationModal } from "./ColonizationModal";
import { cancelCountryColonization, startCountryColonization } from "../lib/api";
import { useGameStore } from "../store/gameStore";

type Props = {
  apiBase: string;
  activeMode: string;
  onQueueBuildOrder: (provinceId: string) => void;
  onQueueColonizeOrder: (provinceId: string) => void;
  onOpenAdminProvinceEditor?: (provinceId: string) => void;
};

type MapModeStyle = {
  fillColor: string;
  fillOpacity: number;
};

const MODE_STYLES: Record<string, MapModeStyle> = {
  "Политическая карта": { fillColor: "#ffffff", fillOpacity: 0.84 },
  "Торговля": { fillColor: "#d9f99d", fillOpacity: 0.78 },
  "Инфраструктура": { fillColor: "#bfdbfe", fillOpacity: 0.78 },
  "Население": { fillColor: "#fecaca", fillOpacity: 0.78 },
  "Постройки": { fillColor: "#e9d5ff", fillOpacity: 0.78 },
  "Дипломатия": { fillColor: "#fde68a", fillOpacity: 0.78 },
  "Колонизация": { fillColor: "#e2e8f0", fillOpacity: 0.85 },
};

const DEFAULT_CENTER: [number, number] = [0, 20];
const DEFAULT_ZOOM = 1.2;
const COLONIZE_EMPTY_PATTERN = "colonize-empty";
const COLONIZE_STRIPES_PATTERN = "colonize-stripes";

function setInteractions(map: MapLibreMap, enabled: boolean) {
  const action = enabled ? "enable" : "disable";
  map.dragPan[action]();
  map.scrollZoom[action]();
  map.boxZoom[action]();
  map.dragRotate[action]();
  map.keyboard[action]();
  map.doubleClickZoom[action]();
  map.touchZoomRotate[action]();
}

function readProvinceId(properties: Record<string, unknown> | undefined) {
  const raw = properties?.id ?? properties?.ID_1 ?? properties?.adm1_code ?? properties?.name;
  return raw == null ? "" : String(raw);
}

function readProvinceName(properties: Record<string, unknown> | undefined) {
  const raw = properties?.name ?? properties?.NAME_1 ?? properties?.gn_name ?? properties?.id;
  return raw == null ? "Провинция" : String(raw);
}

function resolveAssetUrl(apiBase: string, url?: string | null): string | null {
  if (!url) {
    return null;
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${apiBase}${url.startsWith("/") ? "" : "/"}${url}`;
}

function createPatternData(striped: boolean): { width: number; height: number; data: Uint8Array } {
  const width = 8;
  const height = 8;
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (striped && ((x + y) % 6 <= 1)) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 120;
      } else {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
      }
    }
  }

  return { width, height, data };
}

function darkenHexColor(hex: string, factor = 0.45): string {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) {
    return "#475569";
  }
  const raw = match[1];
  const to = (start: number) => Math.max(0, Math.min(255, Math.round(parseInt(raw.slice(start, start + 2), 16) * factor)));
  const r = to(0).toString(16).padStart(2, "0");
  const g = to(2).toString(16).padStart(2, "0");
  const b = to(4).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

export function MapView({ apiBase, activeMode, onQueueBuildOrder, onQueueColonizeOrder, onOpenAdminProvinceEditor }: Props) {
  const mapRef = useRef<MapLibreMap | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hoverPopupRef = useRef<maplibregl.Popup | null>(null);
  const hoveredFeatureIdRef = useRef<string | null>(null);
  const selectedFeatureIdRef = useRef<string | null>(null);
  const prevOwnedProvinceIdsRef = useRef<Set<string>>(new Set());
  const prevColonizingProvinceIdsRef = useRef<Set<string>>(new Set());
  const prevQueuedColonizeProvinceIdsRef = useRef<Set<string>>(new Set());
  const prevConfiguredColonizeProvinceIdsRef = useRef<Set<string>>(new Set());

  const [interactionLocked, setInteractionLocked] = useState(false);
  const [showProvinceBorders, setShowProvinceBorders] = useState(true);
  const [selectedProvinceName, setSelectedProvinceName] = useState<string | null>(null);
  const [view, setView] = useState({ zoom: DEFAULT_ZOOM, lng: DEFAULT_CENTER[0], lat: DEFAULT_CENTER[1] });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; provinceId: string; provinceName: string } | null>(null);
  const [countries, setCountries] = useState<Country[]>([]);
  const [colonizationModalOpen, setColonizationModalOpen] = useState(false);
  const [colonizationActionPending, setColonizationActionPending] = useState(false);

  const auth = useGameStore((s) => s.auth);
  const turnId = useGameStore((s) => s.turnId);
  const selectedProvinceId = useGameStore((s) => s.selectedProvinceId);
  const setSelectedProvince = useGameStore((s) => s.setSelectedProvince);
  const worldBase = useGameStore((s) => s.worldBase);
  const ordersByTurn = useGameStore((s) => s.ordersByTurn);
  const addEvent = useGameStore((s) => s.addEvent);

  const countryById = useMemo(() => {
    const m = new Map<string, Country>();
    for (const country of countries) {
      m.set(country.id, country);
    }
    return m;
  }, [countries]);

  const countryByIdRef = useRef(countryById);
  useEffect(() => {
    countryByIdRef.current = countryById;
  }, [countryById]);

  const worldBaseRef = useRef(worldBase);
  useEffect(() => {
    worldBaseRef.current = worldBase;
  }, [worldBase]);

  const ordersCountByProvince = useMemo(() => {
    const map = new Map<string, number>();
    const byPlayer = ordersByTurn.get(turnId);
    if (!byPlayer) {
      return map;
    }

    for (const list of byPlayer.values()) {
      for (const order of list) {
        map.set(order.provinceId, (map.get(order.provinceId) ?? 0) + 1);
      }
    }

    return map;
  }, [ordersByTurn, turnId]);

  const ordersCountRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    ordersCountRef.current = ordersCountByProvince;
  }, [ordersCountByProvince]);

  useEffect(() => {
    let cancelled = false;

    fetch(`${apiBase}/countries`)
      .then(async (res) => {
        if (!res.ok) {
          return [] as Country[];
        }
        return (await res.json()) as Country[];
      })
      .then((items) => {
        if (!cancelled) {
          setCountries(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCountries([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const selectedProvinceOrdersCount = selectedProvinceId ? (ordersCountByProvince.get(selectedProvinceId) ?? 0) : 0;
  const selectedOwnerId = selectedProvinceId ? (worldBase?.provinceOwner[selectedProvinceId] ?? null) : null;
  const selectedOwner = selectedOwnerId ? countryById.get(selectedOwnerId) : null;
  const selectedOwnerLabel = selectedOwnerId ? (selectedOwner?.name ?? selectedOwnerId) : "Нейтральная";
  const selectedOwnerFlagUrl = resolveAssetUrl(apiBase, selectedOwner?.flagUrl);

  const selectedProvinceColonizeOrdersCount = selectedProvinceId
    ? [...(ordersByTurn.get(turnId)?.values() ?? [])].flat().filter((o) => o.provinceId === selectedProvinceId && o.type === "COLONIZE").length
    : 0;
  const myQueuedColonizeProvinceIds = useMemo(() => {
    const ids = new Set<string>();
    if (!auth) {
      return ids;
    }
    const myOrders = ordersByTurn.get(turnId)?.get(auth.playerId) ?? [];
    for (const order of myOrders) {
      if (order.type === "COLONIZE") {
        ids.add(order.provinceId);
      }
    }
    return ids;
  }, [auth, ordersByTurn, turnId]);
  const selectedColonyProgress = selectedProvinceId ? (worldBase?.colonyProgressByProvince?.[selectedProvinceId] ?? {}) : {};
  const selectedColonyProgressList = Object.entries(selectedColonyProgress).sort((a, b) => b[1] - a[1]);
  const selectedIsNeutral = selectedProvinceId ? !worldBase?.provinceOwner[selectedProvinceId] : false;
  const selectedColonizationCfg = selectedProvinceId
    ? (worldBase?.provinceColonizationByProvince?.[selectedProvinceId] ?? { cost: 100, disabled: false })
    : { cost: 100, disabled: false };
  const selectedIsColonizationDisabled = Boolean(selectedColonizationCfg.disabled);
  const selectedColonizationCost = Math.max(1, Math.floor(selectedColonizationCfg.cost ?? 100));
  const selectedMyColonyProgress = auth?.countryId && selectedProvinceId ? (selectedColonyProgress[auth.countryId] ?? null) : null;
  const selectedCanCancelColonization = selectedProvinceId != null && selectedMyColonyProgress != null;
  const selectedCanStartColonization =
    Boolean(auth?.token) &&
    Boolean(selectedProvinceId) &&
    selectedIsNeutral &&
    !selectedIsColonizationDisabled &&
    selectedMyColonyProgress == null;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          adm1: {
            type: "vector",
            tiles: [`${apiBase}/tiles/adm1/{z}/{x}/{y}.mvt`],
            minzoom: 0,
            maxzoom: 7,
            promoteId: { adm1: "id" },
          },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#4FC1FF" } },
          {
            id: "province-fill",
            type: "fill",
            source: "adm1",
            "source-layer": "adm1",
            paint: {
              "fill-color": "#ffffff",
              "fill-opacity": 0.95,
            },
          },
          {
            id: "province-colonize-stripes",
            type: "fill",
            source: "adm1",
            "source-layer": "adm1",
            paint: {
              "fill-pattern": COLONIZE_EMPTY_PATTERN,
              "fill-opacity": 0,
            },
          },
          {
            id: "province-hover",
            type: "fill",
            source: "adm1",
            "source-layer": "adm1",
            paint: {
              "fill-color": "#000000",
              "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.4, 0],
            },
          },
          {
            id: "province-selected",
            type: "line",
            source: "adm1",
            "source-layer": "adm1",
            paint: {
              "line-color": "#000000",
              "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.5, 0],
            },
          },
          {
            id: "province-line",
            type: "line",
            source: "adm1",
            "source-layer": "adm1",
            paint: {
              "line-color": "#C0C0C0",
              "line-width": 0.9,
              "line-opacity": 0.75,
            },
          },
        ],
      },
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      maxZoom: 8,
      minZoom: 1,
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
      attributionControl: false,
    });

    const hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: "map-hover-popup" });
    hoverPopupRef.current = hoverPopup;

    map.on("load", () => {
      if (!map.hasImage(COLONIZE_EMPTY_PATTERN)) {
        map.addImage(COLONIZE_EMPTY_PATTERN, createPatternData(false));
      }
      if (!map.hasImage(COLONIZE_STRIPES_PATTERN)) {
        map.addImage(COLONIZE_STRIPES_PATTERN, createPatternData(true));
      }
      map.resize();
      const c = map.getCenter();
      setView({ zoom: map.getZoom(), lng: c.lng, lat: c.lat });
    });

    map.on("move", () => {
      const c = map.getCenter();
      setView({ zoom: map.getZoom(), lng: c.lng, lat: c.lat });
      setContextMenu(null);
    });

    map.on("mousemove", "province-fill", (e) => {
      const feature = e.features?.[0];
      if (!feature) {
        return;
      }

      const props = feature.properties as Record<string, unknown> | undefined;
      const id = readProvinceId(props);
      const name = readProvinceName(props);
      if (!id) {
        return;
      }

      const ownerId = worldBaseRef.current?.provinceOwner[id] ?? null;
      const ownerName = ownerId ? (countryByIdRef.current.get(ownerId)?.name ?? ownerId) : "Нейтральная";

      map.getCanvas().style.cursor = "pointer";

      if (hoveredFeatureIdRef.current && hoveredFeatureIdRef.current !== id) {
        map.setFeatureState({ source: "adm1", sourceLayer: "adm1", id: hoveredFeatureIdRef.current }, { hover: false });
      }

      if (hoveredFeatureIdRef.current !== id) {
        hoveredFeatureIdRef.current = id;
        map.setFeatureState({ source: "adm1", sourceLayer: "adm1", id }, { hover: true });
      }

      hoverPopup
        .setLngLat(e.lngLat)
        .setHTML(`<div class=\"text-xs\"><div class=\"font-semibold\">${name}</div><div>Владелец: ${ownerName}</div><div>В очереди: ${ordersCountRef.current.get(id) ?? 0}</div></div>`)
        .addTo(map);
    });

    map.on("mouseleave", "province-fill", () => {
      map.getCanvas().style.cursor = "";
      if (hoveredFeatureIdRef.current) {
        map.setFeatureState({ source: "adm1", sourceLayer: "adm1", id: hoveredFeatureIdRef.current }, { hover: false });
      }
      hoveredFeatureIdRef.current = null;
      hoverPopup.remove();
    });

    map.on("contextmenu", "province-fill", (e) => {
      const feature = e.features?.[0];
      if (!feature) {
        return;
      }

      const props = feature.properties as Record<string, unknown> | undefined;
      const id = readProvinceId(props);
      if (!id) {
        return;
      }

      const owner = useGameStore.getState().worldBase?.provinceOwner[id];
      if (owner) {
        setContextMenu(null);
        return;
      }

      e.preventDefault();
      setContextMenu({
        x: e.point.x + 12,
        y: e.point.y - 8,
        provinceId: id,
        provinceName: readProvinceName(props),
      });
    });

    map.on("click", "province-fill", (e) => {
      const feature = e.features?.[0];
      if (!feature) {
        return;
      }

      const props = feature.properties as Record<string, unknown> | undefined;
      const id = readProvinceId(props);
      if (!id) {
        return;
      }

      if (selectedFeatureIdRef.current && selectedFeatureIdRef.current !== id) {
        map.setFeatureState({ source: "adm1", sourceLayer: "adm1", id: selectedFeatureIdRef.current }, { selected: false });
      }

      selectedFeatureIdRef.current = id;
      map.setFeatureState({ source: "adm1", sourceLayer: "adm1", id }, { selected: true });

      setSelectedProvince(id);
      setSelectedProvinceName(readProvinceName(props));
      setContextMenu(null);
    });

    map.on("click", (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["province-fill"] });
      if (features.length > 0) {
        return;
      }

      if (selectedFeatureIdRef.current) {
        map.setFeatureState({ source: "adm1", sourceLayer: "adm1", id: selectedFeatureIdRef.current }, { selected: false });
      }
      selectedFeatureIdRef.current = null;
      setSelectedProvince(null);
      setSelectedProvinceName(null);
      setContextMenu(null);
    });

    map.on("dblclick", "province-fill", (e) => {
      map.easeTo({ center: e.lngLat, zoom: Math.max(map.getZoom(), 4.2), duration: 350 });
    });

    mapRef.current = map;

    return () => {
      hoverPopup.remove();
      hoverPopupRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [apiBase, setSelectedProvince]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("province-fill") || !map.getLayer("province-line") || !map.getLayer("province-colonize-stripes")) {
      return;
    }

    const ownerByProvince = worldBase?.provinceOwner ?? {};
    const progressByProvince = worldBase?.colonyProgressByProvince ?? {};

    const nextOwnedIds = new Set(Object.keys(ownerByProvince));
    const nextColonizingIds = new Set(Object.keys(progressByProvince));
    const nextQueuedIds = new Set(myQueuedColonizeProvinceIds);
    const nextConfiguredIds = new Set(Object.keys(worldBase?.provinceColonizationByProvince ?? {}));
    const allTouchedIds = new Set<string>([
      ...prevOwnedProvinceIdsRef.current,
      ...prevColonizingProvinceIdsRef.current,
      ...prevQueuedColonizeProvinceIdsRef.current,
      ...prevConfiguredColonizeProvinceIdsRef.current,
      ...nextOwnedIds,
      ...nextColonizingIds,
      ...nextQueuedIds,
      ...nextConfiguredIds,
    ]);

    for (const provinceId of allTouchedIds) {
      const ownerId = ownerByProvince[provinceId];
      const ownerColor = ownerId ? (countryById.get(ownerId)?.color ?? "#9ca3af") : "#C0C0C0";
      const ownerBorderColor = ownerId ? darkenHexColor(ownerColor, 0.42) : "#94a3b8";
      const cfg = worldBase?.provinceColonizationByProvince?.[provinceId] ?? { cost: 100, disabled: false };
      const hasQueuedOwnColonizeOrder = myQueuedColonizeProvinceIds.has(provinceId);

      let leadCountryId: string | null = null;
      let leadPoints = -1;
      let hasOwnColony = false;
      let hasForeignColony = false;
      if (!ownerId) {
        const progress = progressByProvince[provinceId] ?? {};
        for (const [countryId, points] of Object.entries(progress)) {
          if (auth?.countryId && countryId === auth.countryId) {
            hasOwnColony = true;
          } else {
            hasForeignColony = true;
          }
          if (points > leadPoints) {
            leadCountryId = countryId;
            leadPoints = points;
          }
        }
      }

      const colonizeLeadColor = leadCountryId ? (countryById.get(leadCountryId)?.color ?? "#9ca3af") : "#9ca3af";
      const colonizeLeadBorderColor = leadCountryId ? darkenHexColor(colonizeLeadColor, 0.5) : "#64748b";
      const isColonizing = !ownerId && Boolean(leadCountryId);

      map.setFeatureState(
        { source: "adm1", sourceLayer: "adm1", id: provinceId },
        {
          isOwned: Boolean(ownerId),
          isOwnedByCurrent: Boolean(ownerId && auth?.countryId && ownerId === auth.countryId),
          isNeutral: !ownerId,
          ownerColor,
          ownerBorderColor,
          isColonizing,
          hasOwnColony,
          hasForeignColony,
          hasQueuedOwnColonizeOrder,
          colonizeDisabled: Boolean(cfg.disabled),
          colonizeCost: Math.max(1, Math.floor(cfg.cost ?? 100)),
          colonizeLeadColor,
          colonizeLeadBorderColor,
        },
      );
    }

    prevOwnedProvinceIdsRef.current = nextOwnedIds;
    prevColonizingProvinceIdsRef.current = nextColonizingIds;
    prevQueuedColonizeProvinceIdsRef.current = nextQueuedIds;
    prevConfiguredColonizeProvinceIdsRef.current = nextConfiguredIds;

    if (activeMode === "Политическая карта") {
      map.setPaintProperty("province-fill", "fill-color", [
        "case",
        ["boolean", ["feature-state", "isOwned"], false],
        ["coalesce", ["feature-state", "ownerColor"], "#d1d5db"],
        ["boolean", ["feature-state", "isColonizing"], false],
        ["coalesce", ["feature-state", "colonizeLeadColor"], "#9ca3af"],
        "#ffffff",
      ]);
      map.setPaintProperty("province-fill", "fill-opacity", [
        "case",
        ["boolean", ["feature-state", "isOwned"], false],
        1,
        ["boolean", ["feature-state", "isColonizing"], false],
        1,
        1,
      ]);
      map.setPaintProperty("province-colonize-stripes", "fill-pattern", [
        "case",
        ["boolean", ["feature-state", "isColonizing"], false],
        COLONIZE_STRIPES_PATTERN,
        COLONIZE_EMPTY_PATTERN,
      ]);
      map.setPaintProperty("province-colonize-stripes", "fill-opacity", ["case", ["boolean", ["feature-state", "isColonizing"], false], 0.65, 0]);
      map.setPaintProperty("province-line", "line-color", "#9ca3af");
      map.setPaintProperty("province-line", "line-width", 1.1);
      map.setPaintProperty("province-line", "line-opacity", showProvinceBorders ? 0.95 : 0);
      return;
    }

    if (activeMode === "Колонизация") {
      map.setPaintProperty("province-fill", "fill-color", [
        "case",
        ["boolean", ["feature-state", "colonizeDisabled"], false],
        "#b91c1c",
        ["boolean", ["feature-state", "isOwnedByCurrent"], false],
        "#16a34a",
        ["boolean", ["feature-state", "isOwned"], false],
        "#64748b",
        ["boolean", ["feature-state", "hasOwnColony"], false],
        "#22c55e",
        ["boolean", ["feature-state", "hasForeignColony"], false],
        "#f59e0b",
        ["step", ["coalesce", ["feature-state", "colonizeCost"], 100], "#d1fae5", 50, "#86efac", 100, "#4ade80", 200, "#16a34a", 350, "#166534"],
      ]);
      map.setPaintProperty("province-fill", "fill-opacity", [
        "case",
        ["boolean", ["feature-state", "colonizeDisabled"], false],
        0.9,
        ["boolean", ["feature-state", "isOwned"], false],
        0.7,
        0.85,
      ]);
      map.setPaintProperty("province-colonize-stripes", "fill-pattern", [
        "case",
        ["boolean", ["feature-state", "hasOwnColony"], false],
        COLONIZE_STRIPES_PATTERN,
        ["boolean", ["feature-state", "hasForeignColony"], false],
        COLONIZE_STRIPES_PATTERN,
        COLONIZE_EMPTY_PATTERN,
      ]);
      map.setPaintProperty("province-colonize-stripes", "fill-opacity", [
        "case",
        ["boolean", ["feature-state", "hasOwnColony"], false],
        0.62,
        ["boolean", ["feature-state", "hasForeignColony"], false],
        0.45,
        0,
      ]);
      map.setPaintProperty("province-line", "line-color", [
        "case",
        ["boolean", ["feature-state", "hasQueuedOwnColonizeOrder"], false],
        "#22d3ee",
        ["boolean", ["feature-state", "hasOwnColony"], false],
        "#22c55e",
        ["boolean", ["feature-state", "hasForeignColony"], false],
        "#f59e0b",
        ["boolean", ["feature-state", "colonizeDisabled"], false],
        "#fca5a5",
        "#d1d5db",
      ]);
      map.setPaintProperty("province-line", "line-width", 1.2);
      map.setPaintProperty("province-line", "line-opacity", showProvinceBorders ? 0.95 : 0);
      map.setPaintProperty("province-colonize-stripes", "fill-opacity", [
        "case",
        ["boolean", ["feature-state", "hasQueuedOwnColonizeOrder"], false],
        0.72,
        ["boolean", ["feature-state", "hasOwnColony"], false],
        0.62,
        ["boolean", ["feature-state", "hasForeignColony"], false],
        0.45,
        0,
      ]);
      return;
    }

    const style = MODE_STYLES[activeMode] ?? MODE_STYLES["Политическая карта"];
    map.setPaintProperty("province-fill", "fill-color", style.fillColor);
    map.setPaintProperty("province-fill", "fill-opacity", style.fillOpacity);
    map.setPaintProperty("province-colonize-stripes", "fill-pattern", COLONIZE_EMPTY_PATTERN);
    map.setPaintProperty("province-colonize-stripes", "fill-opacity", 0);
    map.setPaintProperty("province-line", "line-color", "#C0C0C0");
    map.setPaintProperty("province-line", "line-width", 0.9);
    map.setPaintProperty("province-line", "line-opacity", showProvinceBorders ? 0.75 : 0);
  }, [activeMode, auth?.countryId, countryById, myQueuedColonizeProvinceIds, showProvinceBorders, worldBase]);

  const zoomIn = () => {
    mapRef.current?.zoomIn({ duration: 220 });
  };

  const zoomOut = () => {
    mapRef.current?.zoomOut({ duration: 220 });
  };

  const resetView = () => {
    mapRef.current?.easeTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, duration: 450 });
  };

  const toggleInteraction = () => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const nextState = !interactionLocked;
    setInteractions(map, !nextState);
    setInteractionLocked(nextState);
  };

  const handleStartColonization = async () => {
    if (!auth?.token || !selectedProvinceId) {
      return;
    }
    setColonizationActionPending(true);
    try {
      await startCountryColonization(auth.token, selectedProvinceId);
      toast.success("Колонизация начата");
      addEvent({
        category: "colonization",
        title: "Начало колонизации",
        message: `Вы начали колонизацию провинции ${selectedProvinceId}`,
        visibility: "private",
        countryId: auth.countryId,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "COLONIZATION_START_FAILED";
      if (code === "COLONIZE_LIMIT") {
        toast.error("Достигнут лимит активных колонизаций");
        addEvent({
          category: "colonization",
          title: "Лимит колонизаций",
          message: "Достигнут лимит активных колонизаций",
          priority: "medium",
          visibility: "private",
          countryId: auth.countryId,
        });
      } else if (code === "COLONIZATION_DISABLED") {
        toast.error("Колонизация этой провинции запрещена");
      } else {
        toast.error("Не удалось начать колонизацию");
      }
    } finally {
      setColonizationActionPending(false);
    }
  };

  const handleCancelColonization = async () => {
    if (!auth?.token || !selectedProvinceId) {
      return;
    }
    setColonizationActionPending(true);
    try {
      await cancelCountryColonization(auth.token, selectedProvinceId);
      toast.success("Колонизация отменена");
      addEvent({
        category: "colonization",
        title: "Отмена колонизации",
        message: `Вы отменили колонизацию провинции ${selectedProvinceId}`,
        visibility: "private",
        countryId: auth.countryId,
      });
    } catch {
      toast.error("Не удалось отменить колонизацию");
    } finally {
      setColonizationActionPending(false);
    }
  };

  return (
    <>
      <div
        ref={containerRef}
        className="map-surface"
        onContextMenu={(event) => {
          event.preventDefault();
        }}
      />
      <div className="vignette absolute inset-0 pointer-events-none" />

      <div className="glass panel-border pointer-events-auto absolute bottom-24 right-4 z-30 flex items-center gap-1 rounded-xl p-1">
        <Tooltip content="Приблизить карту">
          <button onClick={zoomIn} className="map-btn" aria-label="Zoom in">
            <Plus size={16} />
          </button>
        </Tooltip>
        <Tooltip content="Отдалить карту">
          <button onClick={zoomOut} className="map-btn" aria-label="Zoom out">
            <Minus size={16} />
          </button>
        </Tooltip>
        <Tooltip content="Сбросить центр и масштаб">
          <button onClick={resetView} className="map-btn" aria-label="Reset view">
            <LocateFixed size={16} />
          </button>
        </Tooltip>
        <Tooltip content={interactionLocked ? "Разблокировать pan/zoom" : "Заблокировать pan/zoom"}>
          <button onClick={toggleInteraction} className="map-btn" aria-label="Toggle interactions">
            {interactionLocked ? <Lock size={16} /> : <LockOpen size={16} />}
          </button>
        </Tooltip>
      </div>

      <div className="glass panel-border pointer-events-none absolute bottom-24 left-4 z-30 flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-slate-300">
        <Move size={14} className="text-arc-accent" />
        <span>Z {view.zoom.toFixed(2)}</span>
        <span>|</span>
        <span>
          {view.lng.toFixed(2)}, {view.lat.toFixed(2)}
        </span>
      </div>

      <div className="pointer-events-auto absolute bottom-20 left-4 z-30 md:bottom-4 md:left-1/2 md:-translate-x-1/2 md:-ml-[18.5rem]">
        <Tooltip content={showProvinceBorders ? "Скрыть границы провинций" : "Показать границы провинций"} placement="top">
          <button
            type="button"
            onClick={() => setShowProvinceBorders((v) => !v)}
            className={`group glass panel-border relative inline-flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl transition ${
              showProvinceBorders ? "text-arc-accent shadow-neon" : "text-slate-200"
            }`}
            aria-label={showProvinceBorders ? "Скрыть границы провинций" : "Показать границы провинций"}
          >
            <span
              className={`pointer-events-none absolute left-1/2 top-1/2 h-3 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-transparent via-arc-accent/70 to-transparent blur-[2px] transition-opacity ${
                showProvinceBorders ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
            />
            <MapPinned size={18} className="relative z-10" />
            <span
              className={`absolute bottom-2 right-2 h-2 w-2 rounded-full ${
                showProvinceBorders ? "bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.55)]" : "bg-white/35"
              }`}
            />
          </button>
        </Tooltip>
      </div>

      {contextMenu && (
        <div
          className="glass panel-border pointer-events-auto absolute z-40 min-w-[220px] rounded-lg p-2"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <div className="px-2 pb-2 text-xs text-slate-300">{contextMenu.provinceName}</div>
          <button
            onClick={() => {
              setSelectedProvince(contextMenu.provinceId);
              setSelectedProvinceName(contextMenu.provinceName);
              setColonizationModalOpen(true);
              setContextMenu(null);
            }}
            className="w-full rounded-md bg-emerald-500/80 px-2 py-2 text-xs font-semibold text-black transition hover:brightness-110"
          >
            Открыть колонизацию
          </button>
        </div>
      )}

      {selectedProvinceId && (
        <div className="absolute right-4 top-24 z-30 w-80">
          <Tooltip content="Данные провинции и pending-приказы">
            <div className="glass panel-border rounded-xl p-3 text-sm">
              <div className="mb-2 flex items-center gap-2 text-arc-accent">
                <Crosshair size={15} />
                <span className="font-semibold">{selectedProvinceName ?? selectedProvinceId}</span>
              </div>
              <div className="space-y-1 text-xs text-slate-300">
                <div>ID: {selectedProvinceId}</div>
                <div className="flex items-center gap-2">
                  <span>Владелец:</span>
                  {selectedOwnerFlagUrl && <img src={selectedOwnerFlagUrl} alt={selectedOwnerLabel} className="h-4 w-6 rounded-sm object-cover" />}
                  <span>{selectedOwnerLabel}</span>
                </div>
                <div>Стоимость колонизации: {selectedColonizationCost}</div>
                <div>
                  Статус колонизации: {selectedIsColonizationDisabled ? "Запрещена" : "Доступна"}
                </div>
                <div>Наших COLONIZE-приказов в очереди: {selectedProvinceColonizeOrdersCount}</div>
              </div>

              {selectedColonyProgressList.length > 0 && (
                <div className="mt-2 rounded-md bg-black/25 p-2 text-xs text-slate-300">
                  <div className="mb-1 text-slate-400">Прогресс колонизации</div>
                  {selectedColonyProgressList.map(([countryId, points]) => (
                    <div key={countryId} className="flex items-center justify-between">
                      <span>{countryById.get(countryId)?.name ?? countryId}</span>
                      <span>{points.toFixed(1)}/{selectedColonizationCost}</span>
                    </div>
                  ))}
                </div>
              )}

              {selectedIsNeutral && (
                <button
                  onClick={() => setColonizationModalOpen(true)}
                  className="mt-3 w-full rounded-lg bg-emerald-500/80 px-3 py-2 text-xs font-semibold text-black transition hover:brightness-110"
                >
                  Колонизация...
                </button>
              )}

              <button
                onClick={() => onQueueBuildOrder(selectedProvinceId)}
                className="mt-2 w-full rounded-lg bg-arc-accent/80 px-3 py-2 text-xs font-semibold text-black transition hover:brightness-110"
              >
                Построить фабрику (BUILD)
              </button>
            </div>
          </Tooltip>
        </div>
      )}

      {activeMode === "Колонизация" && (
        <div className="pointer-events-none absolute bottom-20 left-4 right-4 z-30 rounded-xl border border-white/10 bg-[#0b111b]/90 p-3 text-xs text-white/80 shadow-2xl backdrop-blur-xl md:left-1/2 md:right-auto md:bottom-4 md:ml-[13.6rem] md:w-72 md:translate-x-0">
          <div className="mb-2 font-semibold text-white">Легенда колонизации</div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-[#b91c1c]" /> Запрещено</div>
            <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-[#22d3ee]" /> Наш приказ в очереди</div>
            <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-[#16a34a]" /> Наши провинции</div>
            <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-[#64748b]" /> Чужие провинции</div>
            <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-[#22c55e]" /> Наша активная колония</div>
            <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-[#f59e0b]" /> Чужая активная колония</div>
            <div className="pt-1 text-white/60">Свободные провинции по стоимости: светлее = дешевле, темнее = дороже</div>
          </div>
        </div>
      )}

      {activeMode === "Политическая карта" && (
        <div className="pointer-events-none absolute bottom-20 left-4 right-4 z-30 rounded-xl border border-white/10 bg-[#0b111b]/90 p-3 text-xs text-white/80 shadow-2xl backdrop-blur-xl md:left-1/2 md:right-auto md:bottom-4 md:ml-[13.6rem] md:w-72 md:translate-x-0">
          <div className="mb-2 font-semibold text-white">Легенда политической карты</div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-white" /> Нейтральная провинция</div>
            <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-slate-400" /> Провинция страны (цвет страны)</div>
            <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-slate-300" /> Границы провинций</div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-slate-500/80" />
              Затемнение при наведении / выборе
            </div>
            <div className="pt-1 text-white/60">Заливка контролируемых провинций отображается цветом соответствующей страны.</div>
            {countries.length > 0 && (
              <div className="mt-2 border-t border-white/10 pt-2">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-white/45">Страны</div>
                <div className="space-y-1">
                  {countries.map((country) => (
                    <div key={country.id} className="flex items-center gap-2">
                      {country.flagUrl ? (
                        <img src={country.flagUrl} alt="" className="h-3 w-4 rounded-[2px] object-cover" />
                      ) : (
                        <span className="h-3 w-3 rounded-full border border-white/10" style={{ backgroundColor: country.color }} />
                      )}
                      <span className="h-3 w-3 rounded-sm border border-white/10" style={{ backgroundColor: country.color }} />
                      <span className="truncate">{country.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ColonizationModal
        open={colonizationModalOpen && Boolean(selectedProvinceId)}
        provinceId={selectedProvinceId}
        provinceName={selectedProvinceName}
        ownerCountryId={selectedOwnerId}
        colonizationCost={selectedColonizationCost}
        colonizationDisabled={selectedIsColonizationDisabled}
        progressByCountry={selectedColonyProgress}
        currentCountryId={auth?.countryId ?? null}
        countries={countries}
        canStart={selectedCanStartColonization}
        canCancel={selectedCanCancelColonization}
        pending={colonizationActionPending}
        onClose={() => setColonizationModalOpen(false)}
        onStart={handleStartColonization}
        onCancel={handleCancelColonization}
        canOpenAdminProvinceEditor={Boolean(auth?.isAdmin && selectedProvinceId)}
        onOpenAdminProvinceEditor={
          auth?.isAdmin && selectedProvinceId
            ? () => {
                setColonizationModalOpen(false);
                onOpenAdminProvinceEditor?.(selectedProvinceId);
              }
            : undefined
        }
      />
    </>
  );
}
