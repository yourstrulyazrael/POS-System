// POS screen layout chosen on each till (product tile size, current-order
// width, text size). Saved per computer, since each till has its own screen.

export type PosLayout = {
  tileSize: number; // minimum product tile width, px
  cartWidth: number; // current order panel width, px (tablet and up)
  textScale: number; // text/control size, percent
};

export const layoutLimits = {
  tileSize: { min: 120, max: 320, step: 10 },
  cartWidth: { min: 260, max: 600, step: 10 },
  textScale: { min: 80, max: 140, step: 5 },
} as const;

// Matches the previous fixed layout closely.
export const defaultPosLayout: PosLayout = { tileSize: 190, cartWidth: 340, textScale: 100 };

const STORAGE_KEY = "clover-pos-layout";
const clamp = (value: unknown, { min, max }: { min: number; max: number }, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

export function normalizeLayout(layout: Partial<PosLayout>): PosLayout {
  return {
    tileSize: clamp(layout.tileSize, layoutLimits.tileSize, defaultPosLayout.tileSize),
    cartWidth: clamp(layout.cartWidth, layoutLimits.cartWidth, defaultPosLayout.cartWidth),
    textScale: clamp(layout.textScale, layoutLimits.textScale, defaultPosLayout.textScale),
  };
}

export function loadPosLayout(): PosLayout {
  try {
    return normalizeLayout(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}"));
  } catch {
    return defaultPosLayout;
  }
}

export function savePosLayout(layout: PosLayout) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Not critical: the layout applies for this visit.
  }
}
