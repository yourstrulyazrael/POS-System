import { createClient as createSupabaseClient, FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";

// The app is a static export (no Next.js server), packaged for desktop, so
// the session lives in localStorage instead of cookies. One shared client
// keeps a single auth listener and token-refresh timer.
let client: SupabaseClient | null = null;
export const AUTH_STORAGE_KEY = "clover-pos-auth";

export function createClient() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY before building the app.");
    }
    client = createSupabaseClient(url, key, {
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
