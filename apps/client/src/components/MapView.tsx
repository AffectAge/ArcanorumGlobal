import { Dialog, Listbox } from "@headlessui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Coins, Crosshair, Edit3, Grid3X3, Lock, LockOpen, LocateFixed, Minus, Move, Plus, Search, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import type { Country } from "@arcanorum/shared";
import { Tooltip } from "./Tooltip";
import { ColonizationModal } from "./ColonizationModal";
import { ProvinceHoverTooltip } from "./ProvinceHoverTooltip";
import { cancelCountryColonization, fetchProvinceIndex, renameOwnedProvince, startCountryColonization } from "../lib/api";
import { useGameStore } from "../store/gameStore";

type Props = {
  apiBase: string;
  activeMode: string;
  onQueueBuildOrder: (provinceId: string) => void;
  onQueueColonizeOrder: (provinceId: string) => void;
  onOpenAdminProvinceEditor?: (provinceId: string) => void;
  onOpenProvinceKnowledge?: (provinceId: string, provinceName: string) => void;
  onCreateProvinceKnowledge?: (provinceId: string, provinceName: string) => void;
  onProvinceRenameCharged?: (chargedDucats: number) => void;
  colonizationIconUrl?: string | null;
  ducatsIconUrl?: string | null;
  maxActiveColonizations?: number;
  colonizationCostPer1000Km2?: { points: number; ducats: number };
  provinceRenameDucatsCost?: number;
  showMapControls?: boolean;
  showAntarctica?: boolean;
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
      if (striped) {
        // Two-tone overlay: both bands are tinted, one is stronger to create visible alternation.
        const isLightBand = (x + y) % 6 <= 2;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = isLightBand ? 150 : 45;
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

function applyAntarcticaVisibilityFilter(map: MapLibreMap, showAntarctica: boolean): void {
  const filter = showAntarctica
    ? null
    : ([
        "all",
        ["!=", ["coalesce", ["get", "admin"], ""], "Antarctica"],
        ["!=", ["coalesce", ["get", "adm0_a3"], ""], "ATA"],
      ] as unknown as maplibregl.FilterSpecification);

  const layerIds = ["province-fill", "province-colonize-stripes", "province-hover", "province-selected", "province-colonize-ring", "province-line"] as const;
  for (const layerId of layerIds) {
    if (map.getLayer(layerId)) {
      map.setFilter(layerId, filter);
    }
  }
}

function lightenHexColor(hex: string, amount = 0.28): string {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) {
    return "#cbd5e1";
  }
  const raw = match[1];
  const to = (start: number) => {
    const base = parseInt(raw.slice(start, start + 2), 16);
    return Math.max(0, Math.min(255, Math.round(base + (255 - base) * amount)));
  };
  const r = to(0).toString(16).padStart(2, "0");
  const g = to(2).toString(16).padStart(2, "0");
  const b = to(4).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function formatCompact(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const units = [
    { n: 1_000_000_000_000, s: "T" },
    { n: 1_000_000_000, s: "B" },
    { n: 1_000_000, s: "M" },
    { n: 1_000, s: "K" },
  ] as const;

  for (const unit of units) {
    if (abs >= unit.n) {
      const scaled = abs / unit.n;
      const text =
        scaled >= 100 ? Math.floor(scaled).toString() : scaled >= 10 ? scaled.toFixed(1).replace(/\.0$/, "") : scaled.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
      return `${sign}${text}${unit.s}`;
    }
  }

  return `${sign}${Math.floor(abs)}`;
}

export function MapView({
  apiBase,
  activeMode,
  onQueueBuildOrder,
  onQueueColonizeOrder,
  onOpenAdminProvinceEditor,
  onOpenProvinceKnowledge,
  onCreateProvinceKnowledge,
  onProvinceRenameCharged,
  colonizationIconUrl,
  ducatsIconUrl,
  maxActiveColonizations,
  colonizationCostPer1000Km2,
  provinceRenameDucatsCost = 25,
  showMapControls = false,
  showAntarctica = false,
}: Props) {
  const mapRef = useRef<MapLibreMap | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hoveredFeatureIdRef = useRef<string | null>(null);
  const selectedFeatureIdRef = useRef<string | null>(null);
  const prevOwnedProvinceIdsRef = useRef<Set<string>>(new Set());
  const prevColonizingProvinceIdsRef = useRef<Set<string>>(new Set());
  const prevQueuedColonizeProvinceIdsRef = useRef<Set<string>>(new Set());
  const prevConfiguredColonizeProvinceIdsRef = useRef<Set<string>>(new Set());
  const provinceNamesByIdRef = useRef<Map<string, string>>(new Map());
  const provinceMetaByIdRef = useRef<Map<string, { name: string; areaKm2: number }>>(new Map());
  const showMapControlsRef = useRef(showMapControls);
  const viewRafRef = useRef<number | null>(null);
  const hoverTooltipRafRef = useRef<number | null>(null);
  const queuedColonizeCountriesByProvinceRef = useRef<Map<string, string[]>>(new Map());
  const lastHoverTooltipProvinceIdRef = useRef<string | null>(null);

  const [interactionLocked, setInteractionLocked] = useState(() => {
    try {
      return localStorage.getItem("arc.ui.map.interactionLocked") === "1";
    } catch {
      return false;
    }
  });
  const [showProvinceBorders, setShowProvinceBorders] = useState(() => {
    try {
      const raw = localStorage.getItem("arc.ui.map.showProvinceBorders");
      return raw == null ? true : raw === "1";
    } catch {
      return true;
    }
  });
  const [selectedProvinceName, setSelectedProvinceName] = useState<string | null>(null);
  const [view, setView] = useState({ zoom: DEFAULT_ZOOM, lng: DEFAULT_CENTER[0], lat: DEFAULT_CENTER[1] });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; provinceId: string; provinceName: string } | null>(null);
  const [hoverTooltip, setHoverTooltip] = useState<{
    x: number;
    y: number;
    provinceName: string;
    areaKm2: number | null;
    ownerName: string;
    colonizers: Array<{ countryId: string; countryName: string; countryColor: string; percent: number; hasQueuedOrder: boolean }>;
  } | null>(null);
  const [countries, setCountries] = useState<Country[]>([]);
  const [colonizationModalOpen, setColonizationModalOpen] = useState(false);
  const [provinceRenameModalOpen, setProvinceRenameModalOpen] = useState(false);
  const [provinceRenameInput, setProvinceRenameInput] = useState("");
  const [provinceRenamePending, setProvinceRenamePending] = useState(false);
  const [colonizationActionPending, setColonizationActionPending] = useState(false);
  const [politicalCountryFilter, setPoliticalCountryFilter] = useState<string>(() => {
    try {
      return localStorage.getItem("arc.ui.map.politicalCountryFilter") || "all";
    } catch {
      return "all";
    }
  });
  const [politicalLegendPinnedOpen, setPoliticalLegendPinnedOpen] = useState(false);
  const [politicalLegendHovered, setPoliticalLegendHovered] = useState(false);
  const [colonizationLegendPinnedOpen, setColonizationLegendPinnedOpen] = useState(false);
  const [colonizationLegendHovered, setColonizationLegendHovered] = useState(false);
  const [politicalLegendDelayShrink, setPoliticalLegendDelayShrink] = useState(false);
  const [colonizationLegendDelayShrink, setColonizationLegendDelayShrink] = useState(false);
  const [politicalLegendCountrySearch, setPoliticalLegendCountrySearch] = useState("");
  const [mapModeFadePulse, setMapModeFadePulse] = useState(0);

  const auth = useGameStore((s) => s.auth);
  const turnId = useGameStore((s) => s.turnId);
  const selectedProvinceId = useGameStore((s) => s.selectedProvinceId);
  const setSelectedProvince = useGameStore((s) => s.setSelectedProvince);
  const worldBase = useGameStore((s) => s.worldBase);
  const ordersByTurn = useGameStore((s) => s.ordersByTurn);
  const addEvent = useGameStore((s) => s.addEvent);
  const updateCountryResources = useGameStore((s) => s.updateCountryResources);

  useEffect(() => {
    showMapControlsRef.current = showMapControls;
  }, [showMapControls]);

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

  useEffect(() => {
    const scope = auth?.countryId ?? "guest";
    try {
      const rawLocked = localStorage.getItem(`arc.ui.${scope}.map.interactionLocked`);
      const rawBorders = localStorage.getItem(`arc.ui.${scope}.map.showProvinceBorders`);
      const rawFilter = localStorage.getItem(`arc.ui.${scope}.map.politicalCountryFilter`);
      setInteractionLocked(rawLocked === "1");
      setShowProvinceBorders(rawBorders == null ? true : rawBorders === "1");
      setPoliticalCountryFilter(rawFilter || "all");
    } catch {
      // ignore
    }
  }, [auth?.countryId]);

  useEffect(() => {
    try {
      localStorage.setItem(`arc.ui.${auth?.countryId ?? "guest"}.map.interactionLocked`, interactionLocked ? "1" : "0");
    } catch {
      // ignore
    }
  }, [auth?.countryId, interactionLocked]);

  useEffect(() => {
    try {
      localStorage.setItem(`arc.ui.${auth?.countryId ?? "guest"}.map.showProvinceBorders`, showProvinceBorders ? "1" : "0");
    } catch {
      // ignore
    }
  }, [auth?.countryId, showProvinceBorders]);

  useEffect(() => {
    try {
      localStorage.setItem(`arc.ui.${auth?.countryId ?? "guest"}.map.politicalCountryFilter`, politicalCountryFilter);
    } catch {
      // ignore
    }
  }, [auth?.countryId, politicalCountryFilter]);

  useEffect(() => {
    setMapModeFadePulse((v) => v + 1);
  }, [activeMode]);

  const isPoliticalLegendExpanded = activeMode === "Политическая карта" && politicalLegendPinnedOpen;
  const isColonizationLegendExpanded = activeMode === "Колонизация" && colonizationLegendPinnedOpen;
  const filteredLegendCountries = useMemo(() => {
    const q = politicalLegendCountrySearch.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  }, [countries, politicalLegendCountrySearch]);

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

  const getDerivedProvinceCosts = (provinceId: string) => {
    const areaKm2 = Math.max(1, provinceMetaByIdRef.current.get(provinceId)?.areaKm2 ?? 1000);
    const factor = Math.max(0.001, areaKm2 / 1000);
    return {
      points: Math.max(1, Math.round((colonizationCostPer1000Km2?.points ?? 5) * factor)),
      ducats: Math.max(0, Math.round((colonizationCostPer1000Km2?.ducats ?? 5) * factor)),
    };
  };
  const getEffectiveProvinceColonizationConfig = (
    provinceId: string,
    base: { provinceColonizationByProvince?: Record<string, { cost: number; disabled: boolean }> } | null | undefined,
  ) => {
    const override = base?.provinceColonizationByProvince?.[provinceId];
    const derived = getDerivedProvinceCosts(provinceId);
    if (!override) {
      return { cost: derived.points, disabled: false };
    }
    const normalizedCost = Math.max(1, Math.floor(Number(override.cost ?? derived.points)));
    const isLegacyDefault = !override.disabled && normalizedCost === 100;
    return {
      cost: isLegacyDefault ? derived.points : normalizedCost,
      disabled: Boolean(override.disabled),
    };
  };
  const getProvinceDisplayName = (
    provinceId: string,
    fallbackName?: string | null,
    fallbackProps?: Record<string, unknown> | undefined,
  ) => {
    const override = worldBaseRef.current?.provinceNameById?.[provinceId] ?? worldBase?.provinceNameById?.[provinceId];
    if (override && override.trim()) {
      return override;
    }
    if (fallbackName && fallbackName.trim()) {
      return fallbackName;
    }
    return provinceNamesByIdRef.current.get(provinceId) ?? readProvinceName(fallbackProps);
  };

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
          setCountries(
            items.map((country) => ({
              ...country,
              flagUrl: resolveAssetUrl(apiBase, country.flagUrl),
              crestUrl: resolveAssetUrl(apiBase, country.crestUrl),
            })),
          );
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

  useEffect(() => {
    let cancelled = false;
    fetchProvinceIndex()
      .then((items) => {
        if (cancelled) return;
        const next = new Map<string, { name: string; areaKm2: number }>();
        for (const item of items) {
          next.set(item.id, { name: item.name, areaKm2: item.areaKm2 });
          provinceNamesByIdRef.current.set(item.id, item.name);
        }
        provinceMetaByIdRef.current = next;
      })
      .catch(() => {
        if (!cancelled) {
          provinceMetaByIdRef.current = new Map();
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedProvinceOrdersCount = selectedProvinceId ? (ordersCountByProvince.get(selectedProvinceId) ?? 0) : 0;
  const selectedOwnerId = selectedProvinceId ? (worldBase?.provinceOwner[selectedProvinceId] ?? null) : null;
  const selectedProvinceDisplayName = selectedProvinceId
    ? getProvinceDisplayName(selectedProvinceId, selectedProvinceName)
    : null;
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
  const queuedColonizeCountriesByProvince = useMemo(() => {
    const map = new Map<string, string[]>();
    const byPlayer = ordersByTurn.get(turnId);
    if (!byPlayer) {
      return map;
    }
    for (const orders of byPlayer.values()) {
      for (const order of orders) {
        if (order.type !== "COLONIZE") continue;
        const list = map.get(order.provinceId) ?? [];
        if (!list.includes(order.countryId)) {
          list.push(order.countryId);
          map.set(order.provinceId, list);
        }
      }
    }
    return map;
  }, [ordersByTurn, turnId]);
  useEffect(() => {
    queuedColonizeCountriesByProvinceRef.current = queuedColonizeCountriesByProvince;
  }, [queuedColonizeCountriesByProvince]);
  const selectedColonyProgress = selectedProvinceId ? (worldBase?.colonyProgressByProvince?.[selectedProvinceId] ?? {}) : {};
  const selectedColonyProgressList = Object.entries(selectedColonyProgress).sort((a, b) => b[1] - a[1]);
  const selectedProvinceAreaKm2 = selectedProvinceId ? (provinceMetaByIdRef.current.get(selectedProvinceId)?.areaKm2 ?? null) : null;
  const selectedIsNeutral = selectedProvinceId ? !worldBase?.provinceOwner[selectedProvinceId] : false;
  const selectedColonizationCfg = selectedProvinceId
    ? getEffectiveProvinceColonizationConfig(selectedProvinceId, worldBase)
    : { cost: 100, disabled: false };
  const selectedIsColonizationDisabled = Boolean(selectedColonizationCfg.disabled);
  const selectedColonizationCost = Math.max(1, Math.floor(selectedColonizationCfg.cost ?? 100));
  const selectedColonizationDucatsCost = selectedProvinceId ? getDerivedProvinceCosts(selectedProvinceId).ducats : 0;
  const selectedMyColonyProgress = auth?.countryId && selectedProvinceId ? (selectedColonyProgress[auth.countryId] ?? null) : null;
  const selectedCanCancelColonization = selectedProvinceId != null && selectedMyColonyProgress != null;
  const selectedCanStartColonization =
    Boolean(auth?.token) &&
    Boolean(selectedProvinceId) &&
    selectedIsNeutral &&
    !selectedIsColonizationDisabled &&
    selectedMyColonyProgress == null;
  const selectedCanRenameProvince = Boolean(
    auth?.token &&
      auth?.countryId &&
      selectedProvinceId &&
      selectedOwnerId &&
      selectedOwnerId === auth.countryId,
  );
  const selectedProvinceRenameCost = Math.max(0, Math.floor(provinceRenameDucatsCost || 0));
  const effectivePoliticalFilterCountryId =
    politicalCountryFilter === "all"
      ? null
      : politicalCountryFilter === "own"
        ? (auth?.countryId ?? null)
        : politicalCountryFilter;
  const currentCountryActiveColonizationTargets = useMemo(() => {
    if (!auth?.countryId) {
      return new Set<string>();
    }
    const ids = new Set<string>();
    const ownerByProvince = worldBase?.provinceOwner ?? {};
    const cfgByProvince = worldBase?.provinceColonizationByProvince ?? {};
    const progressByProvince = worldBase?.colonyProgressByProvince ?? {};
    for (const [provinceId, byCountry] of Object.entries(progressByProvince)) {
      if (ownerByProvince[provinceId]) continue;
      if (cfgByProvince[provinceId]?.disabled) continue;
      if (byCountry[auth.countryId] != null) {
        ids.add(provinceId);
      }
    }
    const myOrders = ordersByTurn.get(turnId)?.get(auth.playerId) ?? [];
    for (const order of myOrders) {
      if (order.type !== "COLONIZE") continue;
      if (ownerByProvince[order.provinceId]) continue;
      if (cfgByProvince[order.provinceId]?.disabled) continue;
      ids.add(order.provinceId);
    }
    return ids;
  }, [auth, ordersByTurn, turnId, worldBase]);
  const colonizedProvinceOptions = useMemo(() => {
    return [...currentCountryActiveColonizationTargets]
      .sort((a, b) => a.localeCompare(b))
      .map((id) => ({
        id,
        name: getProvinceDisplayName(id),
      }));
  }, [currentCountryActiveColonizationTargets, worldBase?.provinceNameById]);

  useEffect(() => {
    if (!selectedProvinceId) return;
    const nextName = getProvinceDisplayName(selectedProvinceId, selectedProvinceName);
    if (nextName !== selectedProvinceName) {
      setSelectedProvinceName(nextName);
    }
  }, [selectedProvinceId, selectedProvinceName, worldBase?.provinceNameById]);

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
            id: "province-colonize-ring",
            type: "line",
            source: "adm1",
            "source-layer": "adm1",
            paint: {
              "line-color": ["coalesce", ["feature-state", "colonizeLeadColor"], "#93c5fd"],
              "line-width": 0,
              "line-opacity": 0,
              "line-blur": 0.5,
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

    map.on("load", () => {
      if (!map.hasImage(COLONIZE_EMPTY_PATTERN)) {
        map.addImage(COLONIZE_EMPTY_PATTERN, createPatternData(false));
      }
      if (!map.hasImage(COLONIZE_STRIPES_PATTERN)) {
        map.addImage(COLONIZE_STRIPES_PATTERN, createPatternData(true));
      }
      for (const [layerId, prop] of [
        ["province-fill", "fill-color"],
        ["province-fill", "fill-opacity"],
        ["province-colonize-stripes", "fill-opacity"],
        ["province-colonize-ring", "line-opacity"],
        ["province-colonize-ring", "line-width"],
        ["province-line", "line-color"],
        ["province-line", "line-opacity"],
        ["province-hover", "fill-opacity"],
        ["province-selected", "line-opacity"],
        ["province-selected", "line-width"],
      ] as const) {
        map.setPaintProperty(layerId, `${prop}-transition`, { duration: 160, delay: 0 });
      }
      applyAntarcticaVisibilityFilter(map, showAntarctica);
      map.resize();
      const c = map.getCenter();
      setView({ zoom: map.getZoom(), lng: c.lng, lat: c.lat });
    });

    map.on("move", () => {
      if (showMapControlsRef.current) {
        if (viewRafRef.current != null) {
          cancelAnimationFrame(viewRafRef.current);
        }
        viewRafRef.current = requestAnimationFrame(() => {
          const c = map.getCenter();
          setView({ zoom: map.getZoom(), lng: c.lng, lat: c.lat });
          viewRafRef.current = null;
        });
      }
      setContextMenu(null);
      setHoverTooltip(null);
    });

    map.on("mousemove", "province-fill", (e) => {
      const feature = e.features?.[0];
      if (!feature) {
        return;
      }

      const props = feature.properties as Record<string, unknown> | undefined;
      const id = readProvinceId(props);
      const rawName = readProvinceName(props);
      if (id && rawName) {
        provinceNamesByIdRef.current.set(id, rawName);
      }
      if (!id) {
        return;
      }
      const name = getProvinceDisplayName(id, rawName, props);

      const ownerId = worldBaseRef.current?.provinceOwner[id] ?? null;
      const ownerName = ownerId ? (countryByIdRef.current.get(ownerId)?.name ?? ownerId) : "Нейтральная";
      const progressByCountry = worldBaseRef.current?.colonyProgressByProvince?.[id] ?? {};
      const effectiveProvinceCfg = getEffectiveProvinceColonizationConfig(id, worldBaseRef.current);
      const provinceColonizationCost = Math.max(
        1,
        Math.floor(effectiveProvinceCfg.cost),
      );
      const queuedCountryIds = new Set<string>(queuedColonizeCountriesByProvinceRef.current.get(id) ?? []);
      const colonizerIds = [...new Set<string>([...Object.keys(progressByCountry), ...queuedCountryIds])];
      const colonizers = colonizerIds
        .sort((a, b) => (progressByCountry[b] ?? 0) - (progressByCountry[a] ?? 0) || a.localeCompare(b))
        .slice(0, 6)
        .map((countryId) => {
          const country = countryByIdRef.current.get(countryId);
          const progress = progressByCountry[countryId] ?? 0;
          const percent = Math.max(0, Math.min(100, (progress / provinceColonizationCost) * 100));
          return {
            countryId,
            countryName: country?.name ?? countryId,
            countryColor: country?.color ?? "#94a3b8",
            percent,
            hasQueuedOrder: queuedCountryIds.has(countryId),
          };
        });

      map.getCanvas().style.cursor = "pointer";

      if (hoveredFeatureIdRef.current && hoveredFeatureIdRef.current !== id) {
        map.setFeatureState({ source: "adm1", sourceLayer: "adm1", id: hoveredFeatureIdRef.current }, { hover: false });
      }

      if (hoveredFeatureIdRef.current !== id) {
        hoveredFeatureIdRef.current = id;
        map.setFeatureState({ source: "adm1", sourceLayer: "adm1", id }, { hover: true });
      }

      const nextHoverTooltip = {
        x: e.point.x,
        y: e.point.y,
        provinceName: name,
        areaKm2: provinceMetaByIdRef.current.get(id)?.areaKm2 ?? null,
        ownerName,
        colonizers,
      };
      const sameProvince = lastHoverTooltipProvinceIdRef.current === id;
      if (hoverTooltipRafRef.current != null) {
        cancelAnimationFrame(hoverTooltipRafRef.current);
      }
      hoverTooltipRafRef.current = requestAnimationFrame(() => {
        setHoverTooltip((prev) => {
          if (
            sameProvince &&
            prev &&
            Math.abs(prev.x - nextHoverTooltip.x) < 2 &&
            Math.abs(prev.y - nextHoverTooltip.y) < 2 &&
            prev.provinceName === nextHoverTooltip.provinceName &&
            prev.ownerName === nextHoverTooltip.ownerName &&
            prev.colonizers.length === nextHoverTooltip.colonizers.length
          ) {
            return prev;
          }
          return nextHoverTooltip;
        });
        hoverTooltipRafRef.current = null;
        lastHoverTooltipProvinceIdRef.current = id;
      });
    });

    map.on("mouseleave", "province-fill", () => {
      map.getCanvas().style.cursor = "";
      if (hoveredFeatureIdRef.current) {
        map.setFeatureState({ source: "adm1", sourceLayer: "adm1", id: hoveredFeatureIdRef.current }, { hover: false });
      }
      hoveredFeatureIdRef.current = null;
      lastHoverTooltipProvinceIdRef.current = null;
      if (hoverTooltipRafRef.current != null) {
        cancelAnimationFrame(hoverTooltipRafRef.current);
        hoverTooltipRafRef.current = null;
      }
      setHoverTooltip(null);
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
      provinceNamesByIdRef.current.set(id, readProvinceName(props));
      const provinceName = getProvinceDisplayName(id, undefined, props);

      e.preventDefault();
      setContextMenu({
        x: e.point.x + 12,
        y: e.point.y - 8,
        provinceId: id,
        provinceName,
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
      const rawName = readProvinceName(props);
      provinceNamesByIdRef.current.set(id, rawName);

      if (selectedFeatureIdRef.current && selectedFeatureIdRef.current !== id) {
        map.setFeatureState({ source: "adm1", sourceLayer: "adm1", id: selectedFeatureIdRef.current }, { selected: false });
      }

      selectedFeatureIdRef.current = id;
      map.setFeatureState({ source: "adm1", sourceLayer: "adm1", id }, { selected: true });

      setSelectedProvince(id);
      setSelectedProvinceName(getProvinceDisplayName(id, rawName, props));
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
      if (hoverTooltipRafRef.current != null) {
        cancelAnimationFrame(hoverTooltipRafRef.current);
        hoverTooltipRafRef.current = null;
      }
      if (viewRafRef.current != null) {
        cancelAnimationFrame(viewRafRef.current);
        viewRafRef.current = null;
      }
      setHoverTooltip(null);
      map.remove();
      mapRef.current = null;
    };
  }, [apiBase, setSelectedProvince]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    applyAntarcticaVisibilityFilter(map, showAntarctica);
  }, [showAntarctica]);

  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      !map.getLayer("province-fill") ||
      !map.getLayer("province-line") ||
      !map.getLayer("province-colonize-stripes") ||
      !map.getLayer("province-colonize-ring")
    ) {
      return;
    }

    const ownerByProvince = worldBase?.provinceOwner ?? {};
    const progressByProvince = worldBase?.colonyProgressByProvince ?? {};

    const nextOwnedIds = new Set(Object.keys(ownerByProvince));
    const nextColonizingIds = new Set(Object.keys(progressByProvince));
    const nextQueuedIds = new Set(queuedColonizeCountriesByProvince.keys());
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

      const queuedCountries = queuedColonizeCountriesByProvince.get(provinceId) ?? [];
      const queuedLeadCountryId =
        !ownerId && !leadCountryId && queuedCountries.length > 0
          ? [...queuedCountries].sort((a, b) => a.localeCompare(b))[0]
          : null;
      const effectiveLeadCountryId = leadCountryId ?? queuedLeadCountryId;
      const selectedFilterCountryColonizes =
        effectivePoliticalFilterCountryId != null &&
        !ownerId &&
        ((progressByProvince[provinceId] ?? {})[effectivePoliticalFilterCountryId] != null ||
          queuedCountries.includes(effectivePoliticalFilterCountryId));
      const colonizeLeadColor = effectiveLeadCountryId ? (countryById.get(effectiveLeadCountryId)?.color ?? "#9ca3af") : "#9ca3af";
      const colonizeLeadLightColor = effectiveLeadCountryId ? lightenHexColor(colonizeLeadColor, 0.16) : "#cbd5e1";
      const isColonizing = !ownerId && Boolean(effectiveLeadCountryId);

      map.setFeatureState(
        { source: "adm1", sourceLayer: "adm1", id: provinceId },
        {
          isOwned: Boolean(ownerId),
          isOwnedByCurrent: Boolean(ownerId && auth?.countryId && ownerId === auth.countryId),
          isOwnedByPoliticalFilter: Boolean(ownerId && effectivePoliticalFilterCountryId && ownerId === effectivePoliticalFilterCountryId),
          hasPoliticalCountryFilter: Boolean(effectivePoliticalFilterCountryId),
          isColonizedByPoliticalFilter: Boolean(selectedFilterCountryColonizes),
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
          colonizeLeadLightColor,
          colonizeLeadBorderColor: effectiveLeadCountryId ? darkenHexColor(colonizeLeadColor, 0.5) : "#64748b",
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
        [
          "all",
          ["boolean", ["feature-state", "hasPoliticalCountryFilter"], false],
          [
            "any",
            ["all", ["boolean", ["feature-state", "isOwned"], false], ["!", ["boolean", ["feature-state", "isOwnedByPoliticalFilter"], false]]],
            ["all", ["boolean", ["feature-state", "isColonizing"], false], ["!", ["boolean", ["feature-state", "isColonizedByPoliticalFilter"], false]]],
          ],
        ],
        "#ffffff",
        ["boolean", ["feature-state", "isOwned"], false],
        ["coalesce", ["feature-state", "ownerColor"], "#d1d5db"],
        ["boolean", ["feature-state", "isColonizing"], false],
        ["coalesce", ["feature-state", "colonizeLeadLightColor"], "#cbd5e1"],
        "#ffffff",
      ]);
      map.setPaintProperty("province-fill", "fill-opacity", [
        "case",
        [
          "all",
          ["boolean", ["feature-state", "hasPoliticalCountryFilter"], false],
          [
            "any",
            ["all", ["boolean", ["feature-state", "isOwned"], false], ["!", ["boolean", ["feature-state", "isOwnedByPoliticalFilter"], false]]],
            ["all", ["boolean", ["feature-state", "isColonizing"], false], ["!", ["boolean", ["feature-state", "isColonizedByPoliticalFilter"], false]]],
          ],
        ],
        1,
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
      map.setPaintProperty("province-colonize-stripes", "fill-opacity", 0);
      map.setPaintProperty("province-colonize-ring", "line-color", ["coalesce", ["feature-state", "colonizeLeadColor"], "#93c5fd"]);
      map.setPaintProperty("province-colonize-ring", "line-width", [
        "case",
        ["boolean", ["feature-state", "isColonizing"], false],
        2.1,
        0,
      ]);
      map.setPaintProperty("province-colonize-ring", "line-opacity", [
        "case",
        ["boolean", ["feature-state", "isColonizing"], false],
        0.32,
        0,
      ]);
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
      map.setPaintProperty("province-colonize-ring", "line-width", 0);
      map.setPaintProperty("province-colonize-ring", "line-opacity", 0);
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
    map.setPaintProperty("province-colonize-ring", "line-width", 0);
    map.setPaintProperty("province-colonize-ring", "line-opacity", 0);
    map.setPaintProperty("province-line", "line-color", "#C0C0C0");
    map.setPaintProperty("province-line", "line-width", 0.9);
    map.setPaintProperty("province-line", "line-opacity", showProvinceBorders ? 0.75 : 0);
  }, [activeMode, auth?.countryId, countryById, effectivePoliticalFilterCountryId, myQueuedColonizeProvinceIds, queuedColonizeCountriesByProvince, showProvinceBorders, worldBase]);

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

  const handleRenameOwnedProvince = async () => {
    if (!auth?.token || !auth.countryId || !selectedProvinceId || !selectedCanRenameProvince) {
      return;
    }
    const nextName = provinceRenameInput.trim();
    const currentName = getProvinceDisplayName(selectedProvinceId, selectedProvinceName);
    if (!nextName) {
      toast.error("Название не может быть пустым");
      return;
    }
    if (nextName.length > 64) {
      toast.error("Максимум 64 символа");
      return;
    }
    if (nextName === currentName) {
      return;
    }

    setProvinceRenamePending(true);
    try {
      const result = await renameOwnedProvince(auth.token, { provinceId: selectedProvinceId, provinceName: nextName });
      provinceNamesByIdRef.current.set(result.provinceId, result.provinceName);
      setSelectedProvinceName(result.provinceName);
      setProvinceRenameModalOpen(false);
      updateCountryResources(auth.countryId, { ducats: result.resources.ducats });
      onProvinceRenameCharged?.(result.chargedDucats);
      toast.success(`Провинция переименована (-${result.chargedDucats} дукатов)`);
      addEvent({
        category: "politics",
        title: "Переименование провинции",
        message: `Вы переименовали провинцию в "${result.provinceName}"`,
        visibility: "private",
        countryId: auth.countryId,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "PROVINCE_RENAME_FAILED";
      if (code === "NOT_PROVINCE_OWNER") {
        toast.error("Можно переименовывать только свои провинции");
      } else if (code === "INSUFFICIENT_DUCATS") {
        toast.error("Недостаточно дукатов");
      } else if (code === "PROVINCE_NOT_FOUND") {
        toast.error("Провинция не найдена");
      } else if (code === "INVALID_PAYLOAD") {
        toast.error("Некорректное название провинции");
      } else {
        toast.error("Не удалось переименовать провинцию");
      }
    } finally {
      setProvinceRenamePending(false);
    }
  };

  const legendPanelBaseClass =
    "pointer-events-auto absolute z-30 rounded-xl border border-white/10 bg-[#0b111b] text-xs text-white/80 shadow-2xl backdrop-blur-xl";
  const legendCompactClass = "px-2 py-2";
  const legendExpandedClass = "w-72 p-3";
  const mapControlsRhythmClass = "h-11 rounded-xl";

  return (
    <>
      <div
        ref={containerRef}
        className="map-surface"
        onContextMenu={(event) => {
          event.preventDefault();
        }}
      />
      <ProvinceHoverTooltip
        open={Boolean(hoverTooltip)}
        x={hoverTooltip?.x ?? 0}
        y={hoverTooltip?.y ?? 0}
        provinceName={hoverTooltip?.provinceName ?? ""}
        areaKm2={hoverTooltip?.areaKm2 ?? null}
        ownerName={hoverTooltip?.ownerName ?? ""}
        colonizers={hoverTooltip?.colonizers ?? []}
      />
      <div className="vignette absolute inset-0 pointer-events-none" />
      <AnimatePresence mode="wait">
        <motion.div
          key={`mode-fade-${activeMode}-${mapModeFadePulse}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.15, 0] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="pointer-events-none absolute inset-0 z-[8] bg-[#03101a]"
        />
      </AnimatePresence>

      {showMapControls && (
        <div className="glass panel-border pointer-events-auto absolute bottom-4 right-4 z-30 flex flex-col gap-1 rounded-xl p-1.5">
          <div className="flex items-center justify-center gap-1">
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
          <div className="pointer-events-none flex items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-2.5 py-1.5 text-xs text-slate-300">
            <Move size={14} className="text-arc-accent" />
            <span>Z {view.zoom.toFixed(2)}</span>
            <span>|</span>
            <span>
              {view.lng.toFixed(2)}, {view.lat.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      <div className="pointer-events-auto absolute bottom-20 left-4 z-30 md:bottom-5 md:left-1/2 md:-translate-x-full md:-ml-[12.3rem]">
        <Tooltip content={showProvinceBorders ? "Скрыть границы провинций" : "Показать границы провинций"} placement="top">
          <button
            type="button"
            onClick={() => setShowProvinceBorders((v) => !v)}
            className={`group glass panel-border relative flex ${mapControlsRhythmClass} w-11 items-center justify-center overflow-hidden bg-[#0b111b]/86 text-slate-100 transition-colors duration-100 hover:text-arc-accent ${
              showProvinceBorders ? "border-[#6ee7b7]/50 text-emerald-300 hover:text-emerald-300" : ""
            }`}
            aria-label={showProvinceBorders ? "Скрыть границы провинций" : "Показать границы провинций"}
          >
            <Grid3X3
              size={18}
              className={`relative z-10 transition-colors ${
                showProvinceBorders ? "text-emerald-300" : ""
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
          {onOpenProvinceKnowledge && (
            <button
              onClick={() => {
                onOpenProvinceKnowledge(contextMenu.provinceId, contextMenu.provinceName);
                setContextMenu(null);
              }}
              className="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-2 py-2 text-xs font-semibold text-white/85 transition hover:border-arc-accent/30 hover:text-arc-accent"
            >
              Статья о провинции
            </button>
          )}
          {auth?.isAdmin && onCreateProvinceKnowledge && (
            <button
              onClick={() => {
                onCreateProvinceKnowledge(contextMenu.provinceId, contextMenu.provinceName);
                setContextMenu(null);
              }}
              className="mt-2 w-full rounded-md border border-rose-400/30 bg-rose-500/10 px-2 py-2 text-xs font-semibold text-rose-200 transition hover:border-rose-300/50 hover:bg-rose-400/15"
            >
              Создать статью о провинции
            </button>
          )}
          {auth?.isAdmin && onOpenAdminProvinceEditor && (
            <button
              onClick={() => {
                setSelectedProvince(contextMenu.provinceId);
                setSelectedProvinceName(contextMenu.provinceName);
                onOpenAdminProvinceEditor(contextMenu.provinceId);
                setContextMenu(null);
              }}
              className="mt-2 w-full rounded-md border border-rose-400/30 bg-rose-500/10 px-2 py-2 text-xs font-semibold text-rose-200 transition hover:border-rose-300/50 hover:bg-rose-400/15"
            >
              Управление провинцией
            </button>
          )}
        </div>
      )}

      {selectedProvinceId && (
        <div className="absolute right-4 top-24 z-30 w-80">
          <Tooltip content="Данные провинции и pending-приказы">
            <div className="glass panel-border rounded-xl p-3 text-sm">
              <div className="mb-2 flex items-center gap-2 text-arc-accent">
                <Crosshair size={15} />
                <span className="font-semibold">{selectedProvinceDisplayName ?? selectedProvinceId}</span>
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
                {selectedCanRenameProvince && (
                  <div className="pt-1">
                    <button
                      onClick={() => {
                        setProvinceRenameInput((getProvinceDisplayName(selectedProvinceId, selectedProvinceDisplayName) ?? "").slice(0, 64));
                        setProvinceRenameModalOpen(true);
                      }}
                      className="w-full rounded-lg border border-emerald-400/35 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-300/55 hover:bg-emerald-400/15"
                    >
                      Переименовать провинцию
                    </button>
                  </div>
                )}
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

            </div>
          </Tooltip>
        </div>
      )}

      {activeMode === "Колонизация" && (
        <motion.div
          className={`${legendPanelBaseClass} bottom-20 left-4 right-4 transition-[width,padding] duration-200 md:bottom-4 md:left-1/2 md:right-auto md:ml-[12.3rem] ${
            isColonizationLegendExpanded || colonizationLegendDelayShrink ? "md:w-72" : "md:w-[176px]"
          } ${
            isColonizationLegendExpanded ? legendExpandedClass : legendCompactClass
          }`}
        >
          <button
            type="button"
            onClick={() =>
              setColonizationLegendPinnedOpen((v) => {
                const next = !v;
                if (next) {
                  setColonizationLegendDelayShrink(false);
                } else {
                  setColonizationLegendDelayShrink(true);
                  window.setTimeout(() => setColonizationLegendDelayShrink(false), 220);
                }
                return next;
              })
            }
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-left"
          >
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-emerald-300" />
              <span className="font-semibold text-white">Колонизация</span>
            </div>
            <div className="flex items-center gap-1">
              <ChevronDown size={14} className={`transition ${isColonizationLegendExpanded ? "rotate-180 text-white" : "text-white/60"}`} />
            </div>
          </button>
          <AnimatePresence initial={false}>
            {isColonizationLegendExpanded && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -4, marginTop: 0, clipPath: "inset(0 0 100% 0 round 10px)" }}
                animate={{ opacity: 1, height: "auto", y: 0, marginTop: 8, clipPath: "inset(0 0 0% 0 round 10px)" }}
                exit={{ opacity: 0, height: 0, y: -2, marginTop: 0, clipPath: "inset(0 0 100% 0 round 10px)" }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-1.5 overflow-hidden"
              >
                <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-[#b91c1c]" /> Запрещено</div>
                <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-[#22d3ee]" /> Наш приказ в очереди</div>
                <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-[#16a34a]" /> Наши провинции</div>
                <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-[#64748b]" /> Чужие провинции</div>
                <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-[#22c55e]" /> Наша активная колония</div>
                <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-[#f59e0b]" /> Чужая активная колония</div>
                <div className="pt-1 text-white/60">Свободные провинции по стоимости: светлее = дешевле, темнее = дороже</div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {activeMode === "Политическая карта" && (
        <motion.div
          className={`${legendPanelBaseClass} bottom-20 left-4 right-4 transition-[width,padding] duration-200 md:bottom-4 md:left-1/2 md:right-auto md:ml-[12.3rem] ${
            isPoliticalLegendExpanded || politicalLegendDelayShrink ? "md:w-72" : "md:w-[210px]"
          } ${
            isPoliticalLegendExpanded ? legendExpandedClass : legendCompactClass
          }`}
        >
          <button
            type="button"
            onClick={() =>
              setPoliticalLegendPinnedOpen((v) => {
                const next = !v;
                if (next) {
                  setPoliticalLegendDelayShrink(false);
                } else {
                  setPoliticalLegendDelayShrink(true);
                  window.setTimeout(() => setPoliticalLegendDelayShrink(false), 220);
                }
                return next;
              })
            }
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-left"
          >
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded bg-white shadow-[0_0_8px_rgba(255,255,255,0.15)]" />
              <span className="font-semibold text-white">Политическая карта</span>
            </div>
            <div className="flex items-center gap-1">
              <ChevronDown size={14} className={`transition ${isPoliticalLegendExpanded ? "rotate-180 text-white" : "text-white/60"}`} />
            </div>
          </button>

          <AnimatePresence initial={false}>
            {isPoliticalLegendExpanded && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -4, marginTop: 0, clipPath: "inset(0 0 100% 0 round 10px)" }}
                animate={{ opacity: 1, height: "auto", y: 0, marginTop: 8, clipPath: "inset(0 0 0% 0 round 10px)" }}
                exit={{ opacity: 0, height: 0, y: -2, marginTop: 0, clipPath: "inset(0 0 100% 0 round 10px)" }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="mb-2 rounded-lg border border-white/10 bg-black/25 p-2">
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-white/45">Показать страну</div>
                  <Listbox value={politicalCountryFilter} onChange={setPoliticalCountryFilter}>
                    <div className="relative">
                      <Listbox.Button className="h-11 w-full rounded-lg border border-white/10 bg-black/35 px-3 pr-10 text-left text-xs text-slate-100">
                        {politicalCountryFilter === "all"
                          ? "Все страны"
                          : politicalCountryFilter === "own"
                            ? "Наша страна"
                            : (countries.find((c) => c.id === politicalCountryFilter)?.name ?? politicalCountryFilter)}
                        <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      </Listbox.Button>
                      <Listbox.Options className="arc-scrollbar panel-border absolute z-30 mt-2 max-h-64 w-full overflow-auto rounded-lg bg-arc-panel/95 p-1 text-xs shadow-2xl outline-none">
                        {[
                          { id: "all", label: "Все страны" },
                          { id: "own", label: "Наша страна" },
                        ].map((option) => (
                          <Listbox.Option
                            key={option.id}
                            value={option.id}
                            className={({ active }) => `relative cursor-pointer rounded-md px-3 py-2 pr-8 transition ${active ? "bg-arc-accent/15 text-arc-accent" : "text-slate-300"}`}
                          >
                            {({ selected }) => (
                              <>
                                <span className={selected ? "text-arc-accent" : ""}>{option.label}</span>
                                {selected && <Check size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-arc-accent" />}
                              </>
                            )}
                          </Listbox.Option>
                        ))}
                        {(politicalLegendCountrySearch.trim() ? filteredLegendCountries : countries).map((country) => (
                          <Listbox.Option
                            key={country.id}
                            value={country.id}
                            className={({ active }) => `relative cursor-pointer rounded-md px-3 py-2 pr-8 transition ${active ? "bg-arc-accent/15 text-arc-accent" : "text-slate-300"}`}
                          >
                            {({ selected }) => (
                              <>
                                <div className="flex items-center gap-2">
                                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: country.color }} />
                                  <span className={selected ? "text-arc-accent" : ""}>{country.name}</span>
                                </div>
                                {selected && <Check size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-arc-accent" />}
                              </>
                            )}
                          </Listbox.Option>
                        ))}
                      </Listbox.Options>
                    </div>
                  </Listbox>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-white" /> Нейтральная провинция</div>
                  <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-slate-400" /> Провинция страны (цвет страны)</div>
                  <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-slate-300" /> Границы провинций</div>
                  <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-sky-300/70" /> Контур/подсветка наведения</div>
                  <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-sky-400/50" /> Внешнее кольцо колонизации</div>
                  <div className="pt-1 text-white/60">Заливка контролируемых провинций отображается цветом соответствующей страны.</div>
                </div>

                {countries.length > 0 && (
                  <div className="mt-2 rounded-lg border border-white/10 bg-black/25 p-2">
                    <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-white/45">
                      <Search size={12} />
                      Страны
                    </div>
                    <div className="relative mb-2">
                      <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-white/35" />
                      <input
                        value={politicalLegendCountrySearch}
                        onChange={(e) => setPoliticalLegendCountrySearch(e.target.value)}
                        placeholder="Поиск страны..."
                        className="h-9 w-full rounded-lg border border-white/10 bg-black/35 px-7 pr-8 text-xs text-slate-100 outline-none transition focus:border-arc-accent/40"
                      />
                      {politicalLegendCountrySearch && (
                        <button
                          type="button"
                          onClick={() => setPoliticalLegendCountrySearch("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80"
                          aria-label="Очистить поиск"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    <div className="arc-scrollbar max-h-40 space-y-1 overflow-auto pr-1">
                      {filteredLegendCountries.map((country) => (
                        <div key={country.id} className="flex items-center gap-2 rounded-md border border-white/5 bg-white/0 px-2 py-1">
                          {country.flagUrl ? (
                            <img src={country.flagUrl} alt="" className="h-3 w-4 rounded-[2px] object-cover" />
                          ) : (
                            <span className="h-3 w-3 rounded-full border border-white/10" style={{ backgroundColor: country.color }} />
                          )}
                          <span className="h-3 w-3 rounded-sm border border-white/10" style={{ backgroundColor: country.color }} />
                          <span className="truncate">{country.name}</span>
                        </div>
                      ))}
                      {filteredLegendCountries.length === 0 && (
                        <div className="px-1 py-1 text-[11px] text-white/45">Ничего не найдено</div>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      <AnimatePresence>
        {provinceRenameModalOpen && selectedProvinceId && (
          <Dialog
            open={provinceRenameModalOpen}
            onClose={() => !provinceRenamePending && setProvinceRenameModalOpen(false)}
            className="relative z-[122]"
          >
            <motion.div
              aria-hidden="true"
              className="fixed inset-0 bg-black/55 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
            />
            <div className="fixed inset-0 flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.985 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="w-full max-w-lg"
              >
                <Dialog.Panel className="glass panel-border rounded-2xl bg-[#0b111b] p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-arc-accent">
                      <Edit3 size={16} />
                      <Dialog.Title className="font-semibold">Переименование провинции</Dialog.Title>
                    </div>
                    <button
                      type="button"
                      onClick={() => setProvinceRenameModalOpen(false)}
                      className="panel-border inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:text-arc-accent"
                      aria-label="Закрыть"
                      disabled={provinceRenamePending}
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
                      <div className="mb-1 text-white/90">
                        Текущее название: <span className="font-semibold">{selectedProvinceDisplayName ?? selectedProvinceId}</span>
                      </div>
                      <div className="inline-flex items-center gap-1 text-white/60">
                        <span>Стоимость переименования:</span>
                        {ducatsIconUrl ? (
                          <img src={ducatsIconUrl} alt="" className="h-[14px] w-[14px] rounded-sm object-contain" />
                        ) : (
                          <Coins size={13} className="text-amber-300" />
                        )}
                        <span>{formatCompact(selectedProvinceRenameCost)}</span>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs text-slate-300">Новое название (до 64 символов)</label>
                      <input
                        autoFocus
                        value={provinceRenameInput}
                        maxLength={64}
                        onChange={(e) => setProvinceRenameInput(e.target.value.slice(0, 64))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !provinceRenamePending) {
                            e.preventDefault();
                            void handleRenameOwnedProvince();
                          }
                        }}
                        className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none transition focus:border-arc-accent/40"
                        placeholder="Введите название провинции"
                      />
                      <div className="mt-1 flex items-center justify-between text-[11px]">
                        <span className="text-white/45">Только владельцы провинции могут менять название</span>
                        <span className={provinceRenameInput.trim().length >= 64 ? "text-amber-300" : "text-white/45"}>
                          {provinceRenameInput.length}/64
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setProvinceRenameModalOpen(false)}
                        disabled={provinceRenamePending}
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/85 transition hover:border-white/20 hover:bg-white/10 disabled:opacity-60"
                      >
                        Отмена
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRenameOwnedProvince()}
                        disabled={provinceRenamePending || !provinceRenameInput.trim()}
                        className="rounded-lg border border-emerald-400/35 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-300/55 hover:bg-emerald-400/20 disabled:opacity-60"
                      >
                        {provinceRenamePending ? "Сохранение..." : "Сохранить"}
                      </button>
                    </div>
                  </div>
                </Dialog.Panel>
              </motion.div>
            </div>
          </Dialog>
        )}
      </AnimatePresence>

      <ColonizationModal
        open={colonizationModalOpen && Boolean(selectedProvinceId)}
        provinceId={selectedProvinceId}
        provinceName={selectedProvinceDisplayName}
        provinceAreaKm2={selectedProvinceAreaKm2}
        ownerCountryId={selectedOwnerId}
        colonizationCost={selectedColonizationCost}
        colonizationDucatsCost={selectedColonizationDucatsCost}
        colonizationDisabled={selectedIsColonizationDisabled}
        progressByCountry={selectedColonyProgress}
        currentCountryId={auth?.countryId ?? null}
        countries={countries}
        colonizationIconUrl={colonizationIconUrl}
        ducatsIconUrl={ducatsIconUrl}
        colonizationLimit={
          auth?.countryId && typeof maxActiveColonizations === "number"
            ? { active: currentCountryActiveColonizationTargets.size, max: Math.max(1, maxActiveColonizations) }
            : null
        }
        colonizedProvinceOptions={colonizedProvinceOptions}
        selectedColonizedProvinceId={selectedProvinceId}
        onSelectColonizedProvince={(provinceId) => {
          setSelectedProvince(provinceId);
          setSelectedProvinceName(getProvinceDisplayName(provinceId));
        }}
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
