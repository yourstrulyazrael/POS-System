import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profileError || profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin access is required." }, { status: 403 });
  }

  let body: { confirmation?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (body.confirmation !== "RESET SALES HISTORY") {
    return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 400 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({
      error: "Sales history reset is not configured. Set the server-only Supabase service role key.",
    }, { status: 503 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reset_sales_history_admin");
  if (error) {
    console.error("Unable to reset sales history:", error.message);
    if (error.code === "PGRST202" || error.code === "42883") {
      return NextResponse.json({
        error: "The sales-history reset database function is missing. Apply migration 202610120003_reset_history_and_account_name.sql, then retry.",
      }, { status: 503 });
    }
    return NextResponse.json({ error: `Unable to reset sales history: ${error.message}` }, { status: 500 });
  }

  const deletedOrders = Number(data);
  if (!Number.isSafeInteger(deletedOrders) || deletedOrders < 0) {
    console.error("Sales history reset returned an invalid order count.");
    return NextResponse.json({ error: "The database returned an invalid reset result." }, { status: 500 });
  }
  return NextResponse.json({ deletedOrders });
}
