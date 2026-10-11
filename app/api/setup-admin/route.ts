import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

function sameSecret(received: string, expected: string) {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Server-side Supabase configuration is missing." }, { status: 503 });
  }
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");
  if (error) {
    console.error("Unable to check initial admin status:", error.message);
    return NextResponse.json({ error: "Unable to check initial admin status." }, { status: 500 });
  }
  return NextResponse.json({ available: count === 0 });
}

export async function POST(request: Request) {
  const setupSecret = process.env.POS_SETUP_SECRET;
  if (!setupSecret || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and POS_SETUP_SECRET in .env.local." }, { status: 503 });
  }

  let body: { email?: unknown; fullName?: unknown; password?: unknown; setupSecret?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const receivedSecret = typeof body.setupSecret === "string" ? body.setupSecret : "";
  if (!sameSecret(receivedSecret, setupSecret)) {
    return NextResponse.json({ error: "The setup key is incorrect." }, { status: 403 });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || fullName.length > 100 || password.length < 8) {
    return NextResponse.json({ error: "Enter a valid email, a name, and a password of at least 8 characters." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (userError || !userData.user) {
    console.error("Unable to create initial admin account:", userError?.message ?? "Supabase returned no user.");
    return NextResponse.json({ error: userError?.message ?? "Unable to create the admin account." }, { status: 400 });
  }

  const { data: bootstrapped, error: bootstrapError } = await admin.rpc("bootstrap_first_admin", {
    p_user_id: userData.user.id,
  });
  if (bootstrapError || !bootstrapped) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(userData.user.id);
    if (cleanupError) console.error("Unable to clean up unassigned initial admin:", cleanupError.message);
    if (bootstrapError) console.error("Unable to assign initial admin role:", bootstrapError.message);
    return NextResponse.json({
      error: bootstrapError ? "Unable to assign the initial admin role. Confirm the database migration was applied." : "An admin account already exists.",
    }, { status: bootstrapError ? 500 : 409 });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
