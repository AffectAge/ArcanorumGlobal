import { useState } from "react";
import { useFloating, offset, shift, flip, useHover, useInteractions, useRole, FloatingPortal, type Placement } from "@floating-ui/react";

type TooltipProps = {
  content: string;
  children: React.ReactNode;
  placement?: Placement;
};

export function Tooltip({ content, children, placement = "right" }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
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
            className="panel-border z-[320] max-w-56 rounded-md bg-arc-panel/95 px-3 py-1 text-xs text-arc-accent"
            {...getFloatingProps()}
          >
            {content}
          </div>
        )}
      </FloatingPortal>
    </>
  );
}
