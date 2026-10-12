// pos-admin: the store actions that need the Supabase service-role key, kept
// server-side so the desktop app only ships the public (publishable) key.
//
// Actions (POST JSON { action, ... }):
//   setup-first-admin   { setupSecret, email, fullName, password }   no sign-in
//   create-employee     { email, fullName, password }                admin
//   remove-employee     { id }                                       admin
//   set-employee-password { id, password }                           admin
//
// Deploy: supabase functions deploy pos-admin --no-verify-jwt
//         supabase secrets set POS_SETUP_SECRET=<long random value>
// JWT verification is done here (not by the gateway) because publishable keys
// are not JWTs and the setup action runs before anyone can sign in.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// Constant-time comparison so the setup key can't be guessed byte by byte.
function sameSecret(received: string, expected: string) {
  const a = new TextEncoder().encode(received);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

function readAccount(body: Record<string, unknown>) {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!emailPattern.test(email) || !fullName || fullName.length > 100 || password.length < 8 || password.length > 72) {
    throw new HttpError(400, "Enter a valid email, a name of up to 100 characters, and a password of 8–72 characters.");
  }
  return { email, fullName, password };
}

async function requireAdmin(request: Request, admin: SupabaseClient) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) throw new HttpError(401, "Sign in is required.");
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) throw new HttpError(401, "Your session has expired. Sign in again.");
  const { data: profile, error: profileError } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profileError || profile?.role !== "admin") throw new HttpError(403, "Admin access is required.");
  return user;
}

async function requireEmployee(admin: SupabaseClient, id: unknown, actingAdminId: string) {
  if (typeof id !== "string" || !uuidPattern.test(id)) throw new HttpError(400, "A valid employee ID is required.");
  if (id === actingAdminId) throw new HttpError(400, "You can’t change your own account here.");
  const { data: profile, error } = await admin.from("profiles").select("role").eq("id", id).single();
  if (error || profile?.role !== "employee") throw new HttpError(404, "Employee account was not found.");
  return id;
}

async function createAccount(admin: SupabaseClient, account: { email: string; fullName: string; password: string }) {
  const { data, error } = await admin.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: { full_name: account.fullName },
  });
  if (error || !data.user) throw new HttpError(400, error?.message ?? "Unable to create the account.");
  return data.user;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return json({ error: "The function is missing its Supabase configuration." }, 500);
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      throw new HttpError(400, "Request body must be valid JSON.");
    }

    switch (body.action) {
      case "setup-first-admin": {
        const setupSecret = Deno.env.get("POS_SETUP_SECRET");
        if (!setupSecret) throw new HttpError(503, "First-admin setup is not configured. Run: supabase secrets set POS_SETUP_SECRET=…");
        if (!sameSecret(typeof body.setupSecret === "string" ? body.setupSecret : "", setupSecret)) throw new HttpError(403, "The setup key is incorrect.");
        const account = readAccount(body);
        const { count, error: countError } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
        if (countError) throw new HttpError(500, "Unable to check the initial admin status.");
        if (count) throw new HttpError(409, "An admin account already exists.");
        const user = await createAccount(admin, account);
        const { data: bootstrapped, error } = await admin.rpc("bootstrap_first_admin", { p_user_id: user.id });
        if (error || !bootstrapped) {
          await admin.auth.admin.deleteUser(user.id);
          throw new HttpError(error ? 500 : 409, error ? "Unable to assign the admin role. Confirm the database migrations were applied." : "An admin account already exists.");
        }
        return json({ success: true }, 201);
      }

      case "create-employee": {
        await requireAdmin(request, admin);
        const account = readAccount(body);
        const user = await createAccount(admin, account);
        const { error } = await admin.from("profiles").upsert({ id: user.id, email: account.email, full_name: account.fullName, role: "employee" });
        if (error) {
          await admin.auth.admin.deleteUser(user.id);
          throw new HttpError(500, "The account was created but its staff profile could not be saved, so it was removed.");
        }
        return json({ employee: { id: user.id, email: account.email, full_name: account.fullName, role: "employee" } }, 201);
      }

      case "remove-employee": {
        const actingAdmin = await requireAdmin(request, admin);
        const id = await requireEmployee(admin, body.id, actingAdmin.id);
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) throw new HttpError(500, "Unable to remove the employee account.");
        return json({ success: true });
      }

      case "set-employee-password": {
        const actingAdmin = await requireAdmin(request, admin);
        const id = await requireEmployee(admin, body.id, actingAdmin.id);
        const password = typeof body.password === "string" ? body.password : "";
        if (password.length < 8 || password.length > 72) throw new HttpError(400, "Choose a password of 8–72 characters.");
        const { error } = await admin.auth.admin.updateUserById(id, { password });
        if (error) throw new HttpError(500, "Unable to update the employee’s password.");
        return json({ success: true });
      }

      default:
        throw new HttpError(400, "Unknown action.");
    }
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("pos-admin failed:", error);
    return json({ error: "Something went wrong on the server." }, 500);
  }
});
