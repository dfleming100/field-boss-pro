import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-10-16" });

/**
 * GET /api/terminal/location?tenantId=N
 * Returns the first Terminal Location on the tenant's connected account.
 * The mobile app uses this Location ID to connect tap-to-pay readers.
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId required" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const { data: tenant } = await sb
      .from("tenants")
      .select("stripe_connect_account_id")
      .eq("id", tenantId)
      .single();

    const connectAccountId = tenant?.stripe_connect_account_id;
    if (!connectAccountId) {
      return NextResponse.json({ error: "Tenant has no connected Stripe account" }, { status: 400 });
    }

    const locations = await stripe.terminal.locations.list(
      { limit: 1 },
      { stripeAccount: connectAccountId }
    );

    if (locations.data.length === 0) {
      return NextResponse.json({ error: "No Terminal Location on connected account" }, { status: 404 });
    }

    return NextResponse.json({
      location_id: locations.data[0].id,
      display_name: locations.data[0].display_name,
    });
  } catch (error) {
    console.error("[terminal/location] error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
