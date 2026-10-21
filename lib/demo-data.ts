// Sample store for demo mode: a small sari-sari store with a morning of
// sales. Built fresh each time the demo starts.

export type DemoProductRow = { name: string; category: string; price: number; wholesalePrice: number; costPrice: number; stock: number; barcode: string | null; imageIcon?: string };

export const demoStoreName = "Demo Sari-Sari Store";

export const demoProducts: DemoProductRow[] = [
  { name: "Sinandomeng Rice (1 kg)", category: "Rice & Grains", price: 52, wholesalePrice: 48, costPrice: 44, stock: 120, barcode: "4800016000011" },
  { name: "Dinorado Rice (1 kg)", category: "Rice & Grains", price: 64, wholesalePrice: 59, costPrice: 54, stock: 80, barcode: "4800016000028" },
  { name: "Corned Beef 150g", category: "Canned Goods", price: 42, wholesalePrice: 39, costPrice: 34, stock: 36, barcode: "4800024000035" },
  { name: "Sardines in Tomato Sauce 155g", category: "Canned Goods", price: 24, wholesalePrice: 22, costPrice: 19, stock: 64, barcode: "4800024000042" },
  { name: "Tuna Flakes 155g", category: "Canned Goods", price: 38, wholesalePrice: 35, costPrice: 31, stock: 4, barcode: "4800024000059" },
  { name: "Pancit Canton", category: "Instant Noodles", price: 16, wholesalePrice: 14.5, costPrice: 12.5, stock: 150, barcode: "4800016644290" },
  { name: "Cup Noodles", category: "Instant Noodles", price: 28, wholesalePrice: 26, costPrice: 22, stock: 40, barcode: "4800016000066" },
  { name: "Potato Chips", category: "Snacks", price: 25, wholesalePrice: 0, costPrice: 19, stock: 3, barcode: "4800194000073" },
  { name: "SkyFlakes Crackers", category: "Snacks", price: 9, wholesalePrice: 8, costPrice: 6.5, stock: 200, barcode: "4800092000080" },
  { name: "Chocolate Wafer", category: "Snacks", price: 10, wholesalePrice: 0, costPrice: 7, stock: 0, barcode: "4800092000097" },
  { name: "Fresh Eggs (piece)", category: "Eggs & Dairy", price: 9, wholesalePrice: 8.25, costPrice: 7, stock: 90, barcode: null },
  { name: "Evaporated Milk 370ml", category: "Eggs & Dairy", price: 36, wholesalePrice: 33, costPrice: 29, stock: 28, barcode: "4800361000103" },
  { name: "Bottled Water", category: "Beverages", price: 15, wholesalePrice: 13, costPrice: 10, stock: 72, barcode: "4800049000110" },
  { name: "Cola (Small Bottle)", category: "Beverages", price: 20, wholesalePrice: 18, costPrice: 15, stock: 48, barcode: "4801981000127" },
  { name: "Cola 1.5L", category: "Beverages", price: 75, wholesalePrice: 70, costPrice: 62, stock: 18, barcode: "4801981000134" },
  { name: "3-in-1 Coffee Sachet", category: "Coffee & Drinks", price: 12, wholesalePrice: 10.5, costPrice: 8.5, stock: 240, barcode: "4800488000141" },
  { name: "Powdered Juice Sachet", category: "Coffee & Drinks", price: 15, wholesalePrice: 13.5, costPrice: 11, stock: 5, barcode: "4800488000158" },
  { name: "Soy Sauce 385ml", category: "Condiments", price: 22, wholesalePrice: 20, costPrice: 17, stock: 30, barcode: "4800575000165" },
  { name: "Vinegar 385ml", category: "Condiments", price: 20, wholesalePrice: 18, costPrice: 15, stock: 30, barcode: "4800575000172" },
  { name: "Iodized Salt 250g", category: "Condiments", price: 14, wholesalePrice: 0, costPrice: 10, stock: 25, barcode: "4800575000189" },
  { name: "Shampoo Sachet", category: "Personal Care", price: 8, wholesalePrice: 0, costPrice: 5.5, stock: 300, barcode: "4800888141125" },
  { name: "Bath Soap", category: "Personal Care", price: 32, wholesalePrice: 29, costPrice: 25, stock: 44, barcode: "4800888000196" },
  { name: "Toothpaste 50ml", category: "Personal Care", price: 45, wholesalePrice: 41, costPrice: 36, stock: 20, barcode: "4800888000202" },
  { name: "Laundry Detergent Sachet", category: "Household", price: 9, wholesalePrice: 8, costPrice: 6, stock: 180, barcode: "4800888000219" },
  { name: "Dishwashing Liquid 250ml", category: "Household", price: 38, wholesalePrice: 35, costPrice: 30, stock: 22, barcode: "4800888000226" },
];

// [hour (Manila), payment method, [product index, quantity][]]
export const demoSales: [number, "cash" | "e_wallet" | "card", [number, number][]][] = [
  [7, "cash", [[0, 2], [10, 6], [15, 4]]],
  [7, "cash", [[5, 5], [12, 2]]],
  [8, "e_wallet", [[2, 2], [3, 3], [17, 1]]],
  [8, "cash", [[20, 4], [21, 1], [23, 3]]],
  [9, "cash", [[13, 6], [8, 4]]],
  [9, "card", [[1, 5], [11, 2], [24, 1]]],
  [10, "cash", [[5, 10], [6, 2], [10, 12]]],
  [10, "e_wallet", [[14, 2], [7, 2]]],
  [11, "cash", [[15, 10], [16, 3], [8, 2]]],
  [11, "cash", [[0, 1], [3, 2], [18, 1], [19, 1]]],
];
