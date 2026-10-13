// Saved (suspended) orders: the cashier puts an order on hold, serves the
// next customer, then recalls it. Kept on this computer in the offline store,
// so they survive closing the app and work offline. Stock isn't reserved
// while an order is on hold; it's checked again when the order is recalled.
import { readCache, writeCache } from "@/lib/offline-store";

export type SuspendedOrder = {
  id: string;
  savedAt: string; // ISO time
  savedBy: string;
  note: string; // e.g. the customer's name; may be empty
  cart: Record<string, number>; // cart line key -> quantity (see cartKey in app/page.tsx)
  customItems: { id: string; description: string; quantity: number; unitPrice: number }[];
  wholesaleMode: boolean;
  total: number; // at the time it was saved
  itemCount: number;
};

export const MAX_SUSPENDED_ORDERS = 20;
const KEY = "suspendedOrders";

export async function listSuspendedOrders(): Promise<SuspendedOrder[]> {
  const saved = await readCache<SuspendedOrder[]>(KEY);
  return Array.isArray(saved) ? saved : [];
}

export async function saveSuspendedOrders(orders: SuspendedOrder[]) {
  await writeCache(KEY, orders);
}
