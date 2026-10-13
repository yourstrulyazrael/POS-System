"use client";

// "Customize layout" for the POS screen: how much room the current order
// takes and which side it is on, list or tile view for products, tile size and text size, previewed
// live. Plus the drag handle on the divider between order and products.
import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { LayoutGrid, List, PanelLeft, PanelRight, RotateCcw, X } from "lucide-react";
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

export function PosLayoutPanel({ layout, onChange, onClose, swapHint }: { layout: PosLayout; onChange: (layout: PosLayout) => void; onClose: () => void; swapHint?: string }) {
  const update = (patch: Partial<PosLayout>) => onChange(normalizeLayout({ ...layout, ...patch }));
  const choice = (pressed: boolean, onClick: () => void, label: string, Icon: typeof List) => (
    <button
      type="button"
      key={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-semibold ${pressed ? "bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-blue-300" : "text-slate-500 hover:text-slate-700"}`}
    >
      <Icon size={13} />{label}
    </button>
  );
  const group = "mt-2 flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800";
  return (
    // Not a modal: the POS stays visible so changes can be seen as they happen.
    <section role="dialog" aria-label="Customize POS layout" className="fixed bottom-4 right-4 z-40 w-[min(320px,calc(100vw-32px))] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-4 flex items-start justify-between">
        <div><p className="flex items-center gap-1.5 text-sm font-semibold"><LayoutGrid size={15} className="text-blue-600" /> Customize layout</p><p className="mt-0.5 text-[11px] text-slate-500">Saved on this computer.</p></div>
        <button type="button" aria-label="Close (Esc)" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"><X size={16} /></button>
      </div>
      <div className="space-y-4">
        <Slider label="Current order size" value={layout.cartShare} display={`${layout.cartShare}% of the screen`} limits={layoutLimits.cartShare} onChange={(cartShare) => update({ cartShare })} minLabel="Smaller" maxLabel="Larger" />
        <div>
          <p className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">Current order on the{swapHint && <kbd className="rounded border border-slate-300 px-1 font-sans text-[9px] font-semibold text-slate-500 dark:border-slate-600">{swapHint}</kbd>}</p>
          <div className={group} role="group" aria-label="Current order side">
            {choice(layout.cartSide === "left", () => update({ cartSide: "left" }), "Left", PanelLeft)}
            {choice(layout.cartSide === "right", () => update({ cartSide: "right" }), "Right", PanelRight)}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Products</p>
          <div className={group} role="group" aria-label="Products view">
            {choice(layout.productView === "list", () => update({ productView: "list" }), "List", List)}
            {choice(layout.productView === "tiles", () => update({ productView: "tiles" }), "Tiles", LayoutGrid)}
          </div>
        </div>
        {layout.productView === "tiles" && (
          <Slider label="Product tiles" value={layout.tileSize} display={`${layout.tileSize}px`} limits={layoutLimits.tileSize} onChange={(tileSize) => update({ tileSize })} minLabel="Smaller · more per row" maxLabel="Larger" />
        )}
        <Slider label="Text size" value={layout.textScale} display={`${layout.textScale}%`} limits={layoutLimits.textScale} onChange={(textScale) => update({ textScale })} minLabel="Smaller" maxLabel="Larger" />
      </div>
      <p className="mt-3 text-[11px] leading-4 text-slate-400">Tip: you can also drag the divider between the order and the products.</p>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={() => onChange(defaultPosLayout)} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"><RotateCcw size={13} /> Reset</button>
        <button type="button" onClick={onClose} className="h-9 flex-1 rounded-lg bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700">Done</button>
      </div>
    </section>
  );
}

// Drag handle on the divider between the current order and the products,
// tablet and up, on whichever side of the order faces the products. Arrow
// keys resize it too, moving the divider the way the arrow points.
export function CartResizeHandle({ share, side, onResize, containerRef }: { share: number; side: "left" | "right"; onResize: (share: number) => void; containerRef: RefObject<HTMLElement | null> }) {
  const dragging = useRef(false);

  function shareAt(clientX: number) {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0) return share;
    return ((side === "left" ? clientX - bounds.left : bounds.right - clientX) / bounds.width) * 100;
  }
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragging.current) onResize(shareAt(event.clientX));
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = (event.shiftKey ? 5 : 2) * (side === "left" ? 1 : -1);
    if (event.key === "ArrowRight") onResize(share + step);
    else if (event.key === "ArrowLeft") onResize(share - step);
    else if (event.key === "Home") onResize(layoutLimits.cartShare.min);
    else if (event.key === "End") onResize(layoutLimits.cartShare.max);
    else return;
    event.preventDefault();
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the current order (drag, or use the arrow keys)"
      aria-valuemin={layoutLimits.cartShare.min}
      aria-valuemax={layoutLimits.cartShare.max}
      aria-valuenow={share}
      tabIndex={0}
      title="Drag to resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className={`group absolute ${side === "left" ? "-right-3" : "-left-3"} top-0 z-10 hidden h-full w-3 cursor-col-resize touch-none items-center justify-center outline-none md:flex`}
    >
      <span className="h-12 w-1 rounded-full bg-slate-300 opacity-0 transition group-hover:opacity-100 group-focus-visible:bg-blue-500 group-focus-visible:opacity-100 dark:bg-slate-600" />
    </div>
  );
}
