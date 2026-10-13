// Quantities: catalog products are sold in whole numbers; custom items (Quick
// add) can also be sold in hundredths, e.g. 0.25, 0.50 or 1.75 (a quarter
// kilo, one and a half meters). The database applies the same rules.

export const MAX_QUANTITY = 9999;

export const roundQuantity = (quantity: number) => Math.round(quantity * 100) / 100;

// Up to 2 decimal places, above 0 and at most 9,999.
export function isValidCustomQuantity(quantity: number) {
  return Number.isFinite(quantity) && quantity > 0 && quantity <= MAX_QUANTITY && Math.abs(quantity * 100 - Math.round(quantity * 100)) < 1e-6;
}

// "3", "0.25", "1.50".
export const formatQuantity = (quantity: number) => (Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2));

// A line's amount rounded to the centavo, exactly as the database rounds it
// (half away from zero). Done in whole centavos and hundredths so floating
// point can't tip a .5 the wrong way.
export function lineAmount(unitPrice: number, quantity: number) {
  const product = Math.round(unitPrice * 100) * Math.round(quantity * 100);
  return Math.sign(product) * Math.floor((Math.abs(product) + 50) / 100) / 100;
}

// For "N items" counts: a fractional quantity (0.25 kg of something) counts
// as one item.
export const itemCountOf = (quantity: number) => (Number.isInteger(quantity) ? quantity : 1);
