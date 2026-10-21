// Stand-in for the Supabase client in demo mode. It never makes a network
// request: reads come back empty, and anything that would change data (insert,
// update, upsert, delete, database functions, sign-in changes, file uploads,
// the admin function) is refused with a clear message. Even a code path the
// demo doesn't handle on purpose can't reach a real store.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMO_NOT_AVAILABLE } from "@/lib/demo";

const refused = { data: null, error: { message: DEMO_NOT_AVAILABLE, code: "DEMO", details: "", hint: "" }, count: null, status: 403, statusText: "Demo" };
const emptyRows = { data: [], error: null, count: 0, status: 200, statusText: "OK" };
const emptyRow = { data: null, error: null, count: 0, status: 200, statusText: "OK" };

const WRITES = new Set(["insert", "update", "upsert", "delete"]);

// A query builder that accepts any chain (.select().eq().order()…) and
// resolves to an empty result, or to a refusal once a write is part of it.
function query(write: boolean, single = false): unknown {
  return new Proxy(() => undefined, {
    get(_target, property) {
      if (property === "then") {
        const result = write ? refused : single ? emptyRow : emptyRows;
        return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
      }
      if (typeof property !== "string") return undefined;
      if (WRITES.has(property)) return () => query(true, single);
      if (property === "single" || property === "maybeSingle") return () => query(write, true);
      return () => query(write, single);
    },
  });
}

const refuse = async () => refused;

export function createDemoClient(): SupabaseClient {
  const client = {
    from: () => query(false),
    rpc: () => query(true),
    schema: () => client,
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: refuse,
      signOut: async () => ({ error: null }),
      updateUser: refuse,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
    functions: { invoke: refuse },
    storage: {
      from: () => ({
        upload: refuse,
        remove: refuse,
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
      }),
    },
    channel: () => ({ on: () => ({ subscribe: () => undefined }), subscribe: () => undefined, unsubscribe: async () => "ok" }),
    removeChannel: async () => "ok",
  };
  return client as unknown as SupabaseClient;
}
