// Which store's database this device uses. One installer and one update feed
// serve every client: each store has its own Supabase project, and a device
// is connected to one of them with a store code (made by
// scripts/store-code.mjs) or by entering the project URL and publishable key.
//
// The connection is saved on this device. A build that has
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY set uses
// them as the default store, and saves them on first run, so devices keep
// their store even after updating to a build without them.

export type StoreConnection = { name: string; url: string; key: string };

const STORAGE_KEY = "clover-pos-store";
const CODE_PREFIX = "CLOVER1-";

function builtInConnection(): StoreConnection | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { name: process.env.NEXT_PUBLIC_STORE_NAME ?? "", url, key } : null;
}

export function loadStoreConnection(): StoreConnection | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<StoreConnection> | null;
    if (saved && typeof saved.url === "string" && typeof saved.key === "string" && !connectionProblem({ url: saved.url, key: saved.key })) {
      return { name: typeof saved.name === "string" ? saved.name : "", url: saved.url, key: saved.key };
    }
  } catch {
    // Unreadable: fall back to the built-in store, if any.
  }
  const builtIn = builtInConnection();
  if (builtIn) saveStoreConnection(builtIn);
  return builtIn;
}

export function saveStoreConnection(connection: StoreConnection) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
  } catch {
    // Storage blocked: the connection lasts for this visit only.
  }
}

// e.g. "abcdefghijklmnop" for https://abcdefghijklmnop.supabase.co
export function projectRef(url: string) {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return "";
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Returns why a URL/key pair can't be used, or null if it looks right. Secret
// (service role) keys are refused: they bypass every security rule and must
// never be put on a till.
export function connectionProblem({ url, key }: { url: string; key: string }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "The store address isn’t a valid URL.";
  }
  if (parsed.protocol !== "https:") return "The store address must start with https://.";
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) return "Use the project URL only, e.g. https://abcdefghijklmnop.supabase.co.";
  const trimmed = key.trim();
  if (trimmed.startsWith("sb_secret_")) return "That’s a secret key. Use the project’s publishable key (it starts with sb_publishable_). Never enter a secret key on a till.";
  if (trimmed.startsWith("sb_publishable_")) return null;
  const payload = decodeJwtPayload(trimmed);
  if (payload?.role === "service_role") return "That’s the service role key. Use the anon / publishable key instead. Never enter a service role key on a till.";
  if (payload?.role === "anon") return null;
  return "The key should be the project’s publishable key (starts with sb_publishable_).";
}

// "CLOVER1-<base64url JSON>" — the format scripts/store-code.mjs produces.
export function parseStoreCode(code: string): StoreConnection {
  const trimmed = code.trim().replace(/\s+/g, "");
  if (!trimmed.toUpperCase().startsWith(CODE_PREFIX)) throw new Error("That isn’t a store code. Store codes start with CLOVER1-.");
  let data: { n?: unknown; u?: unknown; k?: unknown };
  try {
    const body = trimmed.slice(CODE_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
    data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.padEnd(Math.ceil(body.length / 4) * 4, "=")), (char) => char.charCodeAt(0))));
  } catch {
    throw new Error("The store code is incomplete or mistyped. Copy it again exactly.");
  }
  if (typeof data.u !== "string" || typeof data.k !== "string") throw new Error("The store code is missing its details.");
  const connection = { name: typeof data.n === "string" ? data.n.slice(0, 80) : "", url: data.u.replace(/\/+$/, ""), key: data.k };
  const problem = connectionProblem(connection);
  if (problem) throw new Error(problem);
  return connection;
}

// Checks the address and key with Supabase before saving them.
export async function testStoreConnection({ url, key }: StoreConnection) {
  let response: Response;
  try {
    response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
  } catch {
    throw new Error("Couldn’t reach the store’s server. Check the internet connection and the store address.");
  }
  if (response.status === 401 || response.status === 403) throw new Error("The server didn’t accept the key. Check that it’s this project’s publishable key.");
  if (!response.ok) throw new Error(`The store’s server answered with an error (${response.status}). Check the store address.`);
}
