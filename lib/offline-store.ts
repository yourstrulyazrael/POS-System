// On-device storage for offline mode (IndexedDB, no dependencies).
//
// - "pendingOrders": sales made while offline (or whose upload failed), kept
//   until Supabase confirms them. Writes use "strict" durability, so a sale is
//   on disk before the cashier is told it was saved.
// - "cache": the last workspace loaded online (products, recent orders,
//   stats) and signed-in profiles, so the POS can open and sell offline.

export type PendingOrderItem =
  | { kind: "product"; productId: string; name: string; quantity: number; unitPrice: number; wholesale?: boolean }
  | { kind: "custom"; description: string; quantity: number; unitPrice: number };

export type PendingOrder = {
  clientOrderId: string;
  employeeId: string;
  employeeName: string;
  createdAt: string; // ISO time of the sale at the till
  items: PendingOrderItem[];
  paymentMethod: "cash" | "e_wallet" | "card";
  paymentReferenceLast4: string | null;
  cashReceived: number | null;
  wholesale: boolean;
  total: number;
  cashSessionId?: string | null; // drawer session the sale happened in
  attempts: number;
  lastError: string | null;
  // A permanent rejection (the server refused the data). Kept, never deleted,
  // until someone retries or deals with it.
  failed: boolean;
};

const DB_NAME = "clover-pos-offline";
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("This device can’t store offline sales (IndexedDB is unavailable)."));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("pendingOrders")) db.createObjectStore("pendingOrders", { keyPath: "clientOrderId" });
        if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Couldn’t open offline storage."));
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

async function run<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode, mode === "readwrite" ? { durability: "strict" } : undefined);
    const request = action(transaction.objectStore(storeName));
    // Resolve only once the transaction has committed to disk.
    transaction.oncomplete = () => resolve(request ? request.result : undefined);
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline storage failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Offline storage was interrupted."));
  });
}

// Deletes everything this device stored offline for its store (cached
// catalog and orders, offline sign-in data, saved orders, drawer sessions).
// Used when the device is connected to a different store; the caller checks
// first that nothing is still waiting to sync.
export async function eraseOfflineData() {
  if (dbPromise) {
    const db = await dbPromise.catch(() => null);
    db?.close();
    dbPromise = null;
  }
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Couldn’t clear this computer’s offline data."));
    request.onblocked = () => reject(new Error("Close other windows of the POS on this computer, then try again."));
  });
}

export async function savePendingOrder(order: PendingOrder) {
  await run("pendingOrders", "readwrite", (store) => store.put(order));
}

export async function listPendingOrders(): Promise<PendingOrder[]> {
  const orders = (await run<PendingOrder[]>("pendingOrders", "readonly", (store) => store.getAll() as IDBRequest<PendingOrder[]>)) ?? [];
  return orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function deletePendingOrder(clientOrderId: string) {
  await run("pendingOrders", "readwrite", (store) => store.delete(clientOrderId));
}

export async function readCache<T>(key: string): Promise<T | undefined> {
  return run<T>("cache", "readonly", (store) => store.get(key) as IDBRequest<T>);
}

export async function writeCache(key: string, value: unknown) {
  await run("cache", "readwrite", (store) => store.put(value, key));
}

// Offline-capable sign-in: the Supabase session is persisted by supabase-js
// under this storage key. Reading it directly (without a network round trip)
// tells us who was signed in on this device.
export function storedSessionUserId(storageKey: string): string | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: { id?: unknown } };
    return typeof parsed.user?.id === "string" ? parsed.user.id : null;
  } catch {
    return null;
  }
}

// A request that failed because the device couldn't reach Supabase (as
// opposed to Supabase refusing it). Only these are safe to queue and retry.
export function isNetworkError(error: unknown) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error ?? "");
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|timeout|timed out/i.test(message);
}
