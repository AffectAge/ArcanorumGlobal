import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { Search } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const actions = ["Открыть политику", "Открыть бюджет", "К торговым маршрутам", "К выбору провинции", "Запросить резолв"];

export function CommandPalette({ open, onOpenChange }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="glass panel-border fixed left-1/2 top-1/4 z-50 w-[min(92vw,640px)] -translate-x-1/2 rounded-xl p-2">
          <Command className="w-full">
            <div className="flex items-center gap-2 border-b border-white/10 px-3">
              <Search size={14} className="text-arc-muted" />
              <Command.Input className="h-11 w-full bg-transparent text-sm text-white outline-none" placeholder="Команды и переходы..." />
            </div>
            <Command.List className="max-h-80 overflow-y-auto p-2">
              <Command.Empty className="px-2 py-3 text-sm text-arc-muted">Ничего не найдено</Command.Empty>
              <Command.Group heading="Действия">
                {actions.map((a) => (
                  <Command.Item key={a} className="cursor-pointer rounded-md px-2 py-2 text-sm text-slate-200 data-[selected=true]:bg-arc-accent/20">
                    {a}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
