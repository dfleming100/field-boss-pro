import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-10-16" });

/**
 * POST /api/terminal/create-location
 * Creates a Terminal Location on the tenant's connected Stripe account.
 * Required for Tap to Pay. Body: { tenantId, displayName, line1, city, state, postal_code }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId, displayName, line1, city, state, postal_code } = body;

    if (!tenantId || !displayName || !line1 || !city || !state || !postal_code) {
      return NextResponse.json({ error: "All fields required" }, { status: 400 });
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

    const location = await stripe.terminal.locations.create(
      {
        display_name: displayName,
        address: { line1, city, state, postal_code, country: "US" },
      },
      { stripeAccount: connectAccountId }
    );

    return NextResponse.json({ success: true, location });
  } catch (error) {
    console.error("[terminal/create-location] error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
