import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-10-16" });

/**
 * POST /api/terminal/connection-token
 * Returns a short-lived connection token for the mobile Stripe Terminal SDK.
 * Token is scoped to the tenant's Connect account so charges go to them.
 * Body: { tenantId }
 */
export async function POST(request: NextRequest) {
  try {
    const { tenantId } = await request.json();
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
      return NextResponse.json(
        { error: "Tenant has not connected Stripe yet." },
        { status: 400 }
      );
    }

    const token = await stripe.terminal.connectionTokens.create(
      {},
      { stripeAccount: connectAccountId }
    );

    return NextResponse.json({ secret: token.secret });
  } catch (error) {
    console.error("[terminal/connection-token] error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
