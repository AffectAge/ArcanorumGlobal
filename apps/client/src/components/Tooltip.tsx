import { useState } from "react";
import { useFloating, offset, shift, flip, useHover, useInteractions, useRole, FloatingPortal } from "@floating-ui/react";

type TooltipProps = {
  content: string;
  children: React.ReactNode;
};

export function Tooltip({ content, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    middleware: [offset(10), flip(), shift({ padding: 8 })],
  });

  const hover = useHover(context, { move: false, delay: { open: 80, close: 40 } });
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, role]);

  return (
    <>
      <span ref={refs.setReference} {...getReferenceProps()} className="inline-flex">
        {children}
      </span>
      <FloatingPortal>
        {open && (
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="glass panel-border z-[200] max-w-56 rounded-lg px-3 py-2 text-xs text-arc-muted shadow-neon"
            {...getFloatingProps()}
          >
            {content}
          </div>
        )}
      </FloatingPortal>
    </>
  );
}
