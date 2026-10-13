// POS screen layout chosen on each till: how much of the screen the current
// order takes and which side it is on, list or tile view for products, tile size, and text size.
// Saved per computer, since each till has its own screen.

export type ProductView = "list" | "tiles";
export type CartSide = "left" | "right";

export type PosLayout = {
  cartShare: number; // % of the width for the current order (tablet and up)
  cartSide: CartSide; // which side the current order is on (tablet and up)
  productView: ProductView;
  tileSize: number; // minimum product tile width, px (tiles view)
  textScale: number; // text/control size, percent
};

export const layoutLimits = {
  cartShare: { min: 40, max: 70, step: 1 },
  tileSize: { min: 120, max: 320, step: 10 },
  textScale: { min: 80, max: 140, step: 5 },
} as const;

// The current order is the larger side by default, like a classic POS screen.
export const defaultPosLayout: PosLayout = { cartShare: 55, cartSide: "left", productView: "list", tileSize: 190, textScale: 100 };

const STORAGE_KEY = "clover-pos-layout";
const clamp = (value: unknown, { min, max }: { min: number; max: number }, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

export function normalizeLayout(layout: Partial<PosLayout>): PosLayout {
  return {
    cartShare: clamp(layout.cartShare, layoutLimits.cartShare, defaultPosLayout.cartShare),
    cartSide: layout.cartSide === "right" ? "right" : "left",
    productView: layout.productView === "tiles" ? "tiles" : "list",
    tileSize: clamp(layout.tileSize, layoutLimits.tileSize, defaultPosLayout.tileSize),
    textScale: clamp(layout.textScale, layoutLimits.textScale, defaultPosLayout.textScale),
  };
}

export function loadPosLayout(): PosLayout {
  try {
    // Layouts saved before the order moved to the left stored a pixel width
    // (cartWidth); those start from the new default share instead.
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
