import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import { Crosshair, Lock, LockOpen, LocateFixed, Minus, Move, Plus } from "lucide-react";
import type { Country } from "@arcanorum/shared";
import { Tooltip } from "./Tooltip";
import { useGameStore } from "../store/gameStore";

type Props = {
  apiBase: string;
  activeMode: string;
  onQueueBuildOrder: (provinceId: string) => void;
  onQueueColonizeOrder: (provinceId: string) => void;
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

export function MapView({ apiBase, activeMode, onQueueBuildOrder, onQueueColonizeOrder }: Props) {
  const mapRef = useRef<MapLibreMap | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hoverPopupRef = useRef<maplibregl.Popup | null>(null);
  const hoveredFeatureIdRef = useRef<string | null>(null);
  const selectedFeatureIdRef = useRef<string | null>(null);
  const prevOwnedProvinceIdsRef = useRef<Set<string>>(new Set());
  const prevColonizingProvinceIdsRef = useRef<Set<string>>(new Set());

  const [interactionLocked, setInteractionLocked] = useState(false);
  const [selectedProvinceName, setSelectedProvinceName] = useState<string | null>(null);
  const [view, setView] = useState({ zoom: DEFAULT_ZOOM, lng: DEFAULT_CENTER[0], lat: DEFAULT_CENTER[1] });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; provinceId: string; provinceName: string } | null>(null);
  const [countries, setCountries] = useState<Country[]>([]);

  const turnId = useGameStore((s) => s.turnId);
  const selectedProvinceId = useGameStore((s) => s.selectedProvinceId);
  const setSelectedProvince = useGameStore((s) => s.setSelectedProvince);
  const worldBase = useGameStore((s) => s.worldBase);
  const ordersByTurn = useGameStore((s) => s.ordersByTurn);

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
  const selectedColonyProgress = selectedProvinceId ? (worldBase?.colonyProgressByProvince?.[selectedProvinceId] ?? {}) : {};
  const selectedColonyProgressList = Object.entries(selectedColonyProgress).sort((a, b) => b[1] - a[1]);
  const selectedIsNeutral = selectedProvinceId ? !worldBase?.provinceOwner[selectedProvinceId] : false;

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
    const allTouchedIds = new Set<string>([
      ...prevOwnedProvinceIdsRef.current,
      ...prevColonizingProvinceIdsRef.current,
      ...nextOwnedIds,
      ...nextColonizingIds,
    ]);

    for (const provinceId of allTouchedIds) {
      const ownerId = ownerByProvince[provinceId];
      const ownerColor = ownerId ? (countryById.get(ownerId)?.color ?? "#9ca3af") : "#C0C0C0";

      let leadCountryId: string | null = null;
      let leadPoints = -1;
      if (!ownerId) {
        const progress = progressByProvince[provinceId] ?? {};
        for (const [countryId, points] of Object.entries(progress)) {
          if (points > leadPoints) {
            leadCountryId = countryId;
            leadPoints = points;
          }
        }
      }

      const colonizeLeadColor = leadCountryId ? (countryById.get(leadCountryId)?.color ?? "#9ca3af") : "#9ca3af";
      const isColonizing = !ownerId && Boolean(leadCountryId);

      map.setFeatureState(
        { source: "adm1", sourceLayer: "adm1", id: provinceId },
        {
          isOwned: Boolean(ownerId),
          ownerColor,
          isColonizing,
          colonizeLeadColor,
        },
      );
    }

    prevOwnedProvinceIdsRef.current = nextOwnedIds;
    prevColonizingProvinceIdsRef.current = nextColonizingIds;

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
        0.42,
        ["boolean", ["feature-state", "isColonizing"], false],
        0.36,
        0.84,
      ]);
      map.setPaintProperty("province-colonize-stripes", "fill-pattern", [
        "case",
        ["boolean", ["feature-state", "isColonizing"], false],
        COLONIZE_STRIPES_PATTERN,
        COLONIZE_EMPTY_PATTERN,
      ]);
      map.setPaintProperty("province-colonize-stripes", "fill-opacity", ["case", ["boolean", ["feature-state", "isColonizing"], false], 0.65, 0]);
      map.setPaintProperty("province-line", "line-color", [
        "case",
        ["boolean", ["feature-state", "isOwned"], false],
        ["coalesce", ["feature-state", "ownerColor"], "#9ca3af"],
        ["boolean", ["feature-state", "isColonizing"], false],
        ["coalesce", ["feature-state", "colonizeLeadColor"], "#9ca3af"],
        "#C0C0C0",
      ]);
      map.setPaintProperty("province-line", "line-width", 1.1);
      map.setPaintProperty("province-line", "line-opacity", 0.95);
      return;
    }

    const style = MODE_STYLES[activeMode] ?? MODE_STYLES["Политическая карта"];
    map.setPaintProperty("province-fill", "fill-color", style.fillColor);
    map.setPaintProperty("province-fill", "fill-opacity", style.fillOpacity);
    map.setPaintProperty("province-colonize-stripes", "fill-pattern", COLONIZE_EMPTY_PATTERN);
    map.setPaintProperty("province-colonize-stripes", "fill-opacity", 0);
    map.setPaintProperty("province-line", "line-color", "#C0C0C0");
    map.setPaintProperty("province-line", "line-width", 0.9);
    map.setPaintProperty("province-line", "line-opacity", 0.75);
  }, [activeMode, countryById, worldBase]);

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

      {contextMenu && (
        <div
          className="glass panel-border pointer-events-auto absolute z-40 min-w-[220px] rounded-lg p-2"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <div className="px-2 pb-2 text-xs text-slate-300">{contextMenu.provinceName}</div>
          <button
            onClick={() => {
              onQueueColonizeOrder(contextMenu.provinceId);
              setContextMenu(null);
            }}
            className="w-full rounded-md bg-emerald-500/80 px-2 py-2 text-xs font-semibold text-black transition hover:brightness-110"
          >
            Колонизировать
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
                <div>Приказы в очереди: {selectedProvinceOrdersCount}</div>
                <div>Колонизация в очереди: {selectedProvinceColonizeOrdersCount}</div>
              </div>

              {selectedColonyProgressList.length > 0 && (
                <div className="mt-2 rounded-md bg-black/25 p-2 text-xs text-slate-300">
                  <div className="mb-1 text-slate-400">Прогресс колонизации</div>
                  {selectedColonyProgressList.map(([countryId, points]) => (
                    <div key={countryId} className="flex items-center justify-between">
                      <span>{countryById.get(countryId)?.name ?? countryId}</span>
                      <span>{points.toFixed(1)}/100</span>
                    </div>
                  ))}
                </div>
              )}

              {selectedIsNeutral && (
                <button
                  onClick={() => onQueueColonizeOrder(selectedProvinceId)}
                  className="mt-3 w-full rounded-lg bg-emerald-500/80 px-3 py-2 text-xs font-semibold text-black transition hover:brightness-110"
                >
                  Колонизировать (COLONIZE)
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
    </>
  );
}
