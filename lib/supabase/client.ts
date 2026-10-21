import { createClient as createSupabaseClient, FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { loadStoreConnection } from "@/lib/store-connection";
import { isDemoMode } from "@/lib/demo";
import { createDemoClient } from "@/lib/supabase/demo-client";

// The app is a static export (no Next.js server), packaged for desktop, so
// the session lives in localStorage instead of cookies. One shared client
// keeps a single auth listener and token-refresh timer. It talks to the
// store this device is connected to (lib/store-connection.ts).
let client: SupabaseClient | null = null;
let demoClient: SupabaseClient | null = null;
export const AUTH_STORAGE_KEY = "clover-pos-auth";

export function createClient() {
  // Demo mode never talks to a real store (lib/demo.ts).
  if (isDemoMode()) return (demoClient ??= createDemoClient());
  if (!client) {
    const store = loadStoreConnection();
    if (!store) throw new Error("This device isn’t connected to a store yet. Open the app’s home page and enter your store code.");
    client = createSupabaseClient(store.url, store.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_STORAGE_KEY },
    });
  }
  return client;
}

type PosAdminAction =
  | { action: "setup-first-admin"; setupSecret: string; email: string; fullName: string; password: string }
  | { action: "create-employee"; email: string; fullName: string; password: string }
  | { action: "remove-employee"; id: string }
  | { action: "set-employee-password"; id: string; password: string };

// Calls the pos-admin Edge Function and turns its JSON error into a readable
// Error. The signed-in user's token is attached automatically.
export async function callPosAdmin<T = Record<string, unknown>>(body: PosAdminAction): Promise<T> {
  const { data, error } = await createClient().functions.invoke("pos-admin", { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const details = await error.context.json().catch(() => null);
      throw new Error(typeof details?.error === "string" ? details.error : "The server rejected the request.");
    }
    throw new Error(
      error.name === "FunctionsFetchError"
        ? "Couldn’t reach the server. Check the internet connection, and that the pos-admin function is deployed."
        : error.message,
    );
  }
  return data as T;
}
