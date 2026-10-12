"use client";

// "Customize layout" for the POS screen: product tile size, current-order
// width and text size, previewed live. Plus the drag handle on the order
// panel's edge.
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { LayoutGrid, RotateCcw, X } from "lucide-react";
import { defaultPosLayout, layoutLimits, normalizeLayout, type PosLayout } from "@/lib/pos-layout";

function Slider({ label, value, display, limits, onChange, minLabel, maxLabel }: {
  label: string;
  value: number;
  display: string;
  limits: { min: number; max: number; step: number };
  onChange: (value: number) => void;
  minLabel: string;
  maxLabel: string;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">{label}<span className="font-mono text-[11px] font-medium text-slate-500">{display}</span></span>
      <input
        type="range"
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="mt-2 w-full accent-blue-600"
      />
      <span className="mt-0.5 flex justify-between text-[10px] text-slate-400"><span>{minLabel}</span><span>{maxLabel}</span></span>
    </label>
  );
}

export function PosLayoutPanel({ layout, onChange, onClose }: { layout: PosLayout; onChange: (layout: PosLayout) => void; onClose: () => void }) {
  const update = (patch: Partial<PosLayout>) => onChange(normalizeLayout({ ...layout, ...patch }));
  return (
    // Not a modal: the POS stays visible so changes can be seen as they happen.
    <section role="dialog" aria-label="Customize POS layout" className="fixed bottom-4 left-4 z-40 w-[min(320px,calc(100vw-32px))] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-4 flex items-start justify-between">
        <div><p className="flex items-center gap-1.5 text-sm font-semibold"><LayoutGrid size={15} className="text-blue-600" /> Customize layout</p><p className="mt-0.5 text-[11px] text-slate-500">Saved on this computer.</p></div>
        <button type="button" aria-label="Close (Esc)" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"><X size={16} /></button>
      </div>
      <div className="space-y-4">
        <Slider label="Product tiles" value={layout.tileSize} display={`${layout.tileSize}px`} limits={layoutLimits.tileSize} onChange={(tileSize) => update({ tileSize })} minLabel="Smaller · more per row" maxLabel="Larger" />
        <Slider label="Current order width" value={layout.cartWidth} display={`${layout.cartWidth}px`} limits={layoutLimits.cartWidth} onChange={(cartWidth) => update({ cartWidth })} minLabel="Narrower" maxLabel="Wider" />
        <Slider label="Text size" value={layout.textScale} display={`${layout.textScale}%`} limits={layoutLimits.textScale} onChange={(textScale) => update({ textScale })} minLabel="Smaller" maxLabel="Larger" />
      </div>
      <p className="mt-3 text-[11px] leading-4 text-slate-400">Tip: you can also drag the left edge of the current order to resize it.</p>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={() => onChange(defaultPosLayout)} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"><RotateCcw size={13} /> Reset</button>
        <button type="button" onClick={onClose} className="h-9 flex-1 rounded-lg bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700">Done</button>
      </div>
    </section>
  );
}

// Vertical drag handle on the left edge of the current order (tablet and up).
// Arrow keys resize it too, so it works without a mouse.
export function CartResizeHandle({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    drag.current = { startX: event.clientX, startWidth: width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    // Dragging left widens the order panel.
    onResize(drag.current.startWidth - (event.clientX - drag.current.startX));
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 50 : layoutLimits.cartWidth.step;
    if (event.key === "ArrowLeft") onResize(width + step);
    else if (event.key === "ArrowRight") onResize(width - step);
    else if (event.key === "Home") onResize(layoutLimits.cartWidth.max);
    else if (event.key === "End") onResize(layoutLimits.cartWidth.min);
    else return;
    event.preventDefault();
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the current order (drag, or use the arrow keys)"
      aria-valuemin={layoutLimits.cartWidth.min}
      aria-valuemax={layoutLimits.cartWidth.max}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className="group absolute -left-3 top-0 z-10 hidden h-full w-3 cursor-col-resize touch-none items-center justify-center outline-none md:flex"
    >
      <span className="h-12 w-1 rounded-full bg-slate-300 opacity-0 transition group-hover:opacity-100 group-focus-visible:bg-blue-500 group-focus-visible:opacity-100 dark:bg-slate-600" />
    </div>
  );
}
