import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import { Crosshair, Lock, LockOpen, LocateFixed, Minus, Move, Plus } from "lucide-react";
import { Tooltip } from "./Tooltip";
import { useGameStore } from "../store/gameStore";

type Props = {
  apiBase: string;
  activeMode: string;
  onQueueBuildOrder: (provinceId: string) => void;
};

type MapModeStyle = {
  fillColor: string;
  fillOpacity: number;
};

type HoveredProvince = {
  id: string;
  name: string;
  x: number;
  y: number;
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

export function MapView({ apiBase, activeMode, onQueueBuildOrder }: Props) {
  const mapRef = useRef<MapLibreMap | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [interactionLocked, setInteractionLocked] = useState(false);
  const [hoveredProvince, setHoveredProvince] = useState<HoveredProvince | null>(null);
  const [selectedProvinceName, setSelectedProvinceName] = useState<string | null>(null);
  const [view, setView] = useState({ zoom: DEFAULT_ZOOM, lng: DEFAULT_CENTER[0], lat: DEFAULT_CENTER[1] });

  const selectedProvinceId = useGameStore((s) => s.selectedProvinceId);
  const setSelectedProvince = useGameStore((s) => s.setSelectedProvince);
  const turnId = useGameStore((s) => s.turnId);
  const worldBase = useGameStore((s) => s.worldBase);
  const ordersByTurn = useGameStore((s) => s.ordersByTurn);

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

  const selectedProvinceOrdersCount = selectedProvinceId ? (ordersCountByProvince.get(selectedProvinceId) ?? 0) : 0;
  const selectedOwnerId = selectedProvinceId ? (worldBase?.provinceOwner[selectedProvinceId] ?? "?") : "?";

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
          },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#5A9EAD" } },
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
            id: "province-hover",
            type: "fill",
            source: "adm1",
            "source-layer": "adm1",
            filter: ["==", ["get", "id"], ""],
            paint: {
              "fill-color": "#000000",
              "fill-opacity": 0.8,
            },
          },
          {
            id: "province-selected",
            type: "line",
            source: "adm1",
            "source-layer": "adm1",
            filter: ["==", ["get", "id"], ""],
            paint: {
              "line-color": "#22c55e",
              "line-width": 2.5,
            },
          },
          {
            id: "province-line",
            type: "line",
            source: "adm1",
            "source-layer": "adm1",
            paint: {
              "line-color": "#0a0a0a",
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
    });

    map.on("load", () => {
      map.resize();
      const c = map.getCenter();
      setView({ zoom: map.getZoom(), lng: c.lng, lat: c.lat });
    });

    map.on("move", () => {
      const c = map.getCenter();
      setView({ zoom: map.getZoom(), lng: c.lng, lat: c.lat });
    });

    map.on("mousemove", "province-fill", (e) => {
      const feature = e.features?.[0];
      const props = feature?.properties as Record<string, unknown> | undefined;
      const id = readProvinceId(props);
      if (id) {
        map.getCanvas().style.cursor = "pointer";
        map.setFilter("province-hover", ["==", ["get", "id"], id]);
        setHoveredProvince({
          id,
          name: readProvinceName(props),
          x: e.point.x,
          y: e.point.y,
        });
      }
    });

    map.on("mouseleave", "province-fill", () => {
      map.getCanvas().style.cursor = "";
      map.setFilter("province-hover", ["==", ["get", "id"], ""]);
      setHoveredProvince(null);
    });

    map.on("click", "province-fill", (e) => {
      const feature = e.features?.[0];
      const props = feature?.properties as Record<string, unknown> | undefined;
      const id = readProvinceId(props);
      if (!id) {
        return;
      }

      setSelectedProvince(id);
      setSelectedProvinceName(readProvinceName(props));
    });

    map.on("click", (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["province-fill"] });
      if (features.length === 0) {
        setSelectedProvince(null);
        setSelectedProvinceName(null);
      }
    });

    map.on("dblclick", "province-fill", (e) => {
      map.easeTo({ center: e.lngLat, zoom: Math.max(map.getZoom(), 4.2), duration: 350 });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [apiBase, setSelectedProvince]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("province-fill")) {
      return;
    }

    const style = MODE_STYLES[activeMode] ?? MODE_STYLES["Политическая карта"];
    map.setPaintProperty("province-fill", "fill-color", style.fillColor);
    map.setPaintProperty("province-fill", "fill-opacity", style.fillOpacity);
  }, [activeMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("province-selected")) {
      return;
    }

    map.setFilter("province-selected", ["==", ["get", "id"], selectedProvinceId ?? ""]);
  }, [selectedProvinceId]);

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
      <div ref={containerRef} className="map-surface" />
      <div className="vignette absolute inset-0 pointer-events-none" />

      {hoveredProvince && (
        <div
          className="pointer-events-none absolute z-30"
          style={{ left: hoveredProvince.x + 14, top: hoveredProvince.y + 14 }}
        >
          <div className="glass panel-border rounded-lg px-2 py-1 text-xs text-slate-100">
            <div className="font-semibold text-arc-accent">{hoveredProvince.name}</div>
            <div>ID: {hoveredProvince.id}</div>
            <div>В очереди: {ordersCountByProvince.get(hoveredProvince.id) ?? 0}</div>
          </div>
        </div>
      )}

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
        <span>{view.lng.toFixed(2)}, {view.lat.toFixed(2)}</span>
      </div>

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
                <div>Владелец: {selectedOwnerId}</div>
                <div>Приказы в очереди: {selectedProvinceOrdersCount}</div>
              </div>
              <button
                onClick={() => onQueueBuildOrder(selectedProvinceId)}
                className="mt-3 w-full rounded-lg bg-arc-accent/80 px-3 py-2 text-xs font-semibold text-black transition hover:brightness-110"
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


