import { Tooltip } from "./Tooltip";
import { Palette } from "lucide-react";

const modes = ["Политическая карта", "Торговля", "Инфраструктура", "Население", "Постройки", "Дипломатия"];

type Props = {
  activeMode: string;
  onModeChange: (mode: string) => void;
};

export function MapModePanel({ activeMode, onModeChange }: Props) {
  return (
    <div className="glass panel-border pointer-events-auto absolute bottom-4 left-1/2 z-40 w-[min(94vw,720px)] -translate-x-1/2 rounded-2xl p-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        {modes.map((mode) => (
          <button
            key={mode}
            className={`rounded-lg px-3 py-2 text-xs transition ${activeMode === mode ? "bg-arc-accent/20 text-arc-accent" : "bg-white/5 text-slate-300 hover:text-arc-accent"}`}
            onClick={() => onModeChange(mode)}
          >
            {mode}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-lg bg-black/30 px-3 py-2 text-xs text-arc-muted">
        <Palette size={14} />
        Точные настройки слоя: фильтр стран и степень детализации для режима {activeMode}.
      </div>
    </div>
  );
}


