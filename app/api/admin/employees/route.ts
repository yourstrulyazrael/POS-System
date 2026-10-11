import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

async function getAdmin() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "Sign in is required." }, { status: 401 }) };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profileError || profile?.role !== "admin") {
    return { response: NextResponse.json({ error: "Admin access is required." }, { status: 403 }) };
  }
  return { user };
}

function configurationError() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return NextResponse.json({
    error: "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
  }, { status: 503 });
}

export async function GET() {
  const access = await getAdmin();
  if ("response" in access) return access.response;
  const configError = configurationError();
  if (configError) return configError;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, full_name, role, created_at")
    .eq("role", "employee")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Unable to load employee accounts:", error.message);
    return NextResponse.json({ error: "Unable to load employee accounts." }, { status: 500 });
  }
  return NextResponse.json({ employees: data });
}

export async function POST(request: Request) {
  const access = await getAdmin();
  if ("response" in access) return access.response;
  const configError = configurationError();
  if (configError) return configError;

  let body: { email?: unknown; fullName?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || fullName.length > 100 || password.length < 8) {
    return NextResponse.json({ error: "Enter a valid email, a name, and a password of at least 8 characters." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) {
    console.error("Unable to create employee account:", error?.message ?? "Supabase returned no user.");
    return NextResponse.json({ error: error?.message ?? "Unable to create employee account." }, { status: 400 });
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: data.user.id,
    email,
    full_name: fullName,
    role: "employee",
  });
  if (profileError) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(data.user.id);
    if (cleanupError) console.error("Unable to clean up employee after profile creation failed:", cleanupError.message);
    console.error("Unable to create employee profile:", profileError.message);
    return NextResponse.json({ error: "Account was created but its staff profile could not be saved." }, { status: 500 });
  }

  return NextResponse.json({
    employee: { id: data.user.id, email, full_name: fullName, role: "employee" },
  }, { status: 201 });
}

export async function DELETE(request: Request) {
  const access = await getAdmin();
  if ("response" in access) return access.response;
  const configError = configurationError();
  if (configError) return configError;

  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "A valid employee ID is required." }, { status: 400 });
  }
  if (id === access.user.id) {
    return NextResponse.json({ error: "You cannot remove your own account." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: profile, error: lookupError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", id)
    .single();
  if (lookupError || profile?.role !== "employee") {
    return NextResponse.json({ error: "Employee account was not found." }, { status: 404 });
  }

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    console.error("Unable to remove employee account:", error.message);
    return NextResponse.json({ error: "Unable to remove employee account." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
