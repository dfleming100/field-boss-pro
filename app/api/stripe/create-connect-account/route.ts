import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

/**
 * POST /api/stripe/create-connect-account
 * Creates a Stripe Connect Standard account for a tenant
 * so they can collect payments from their customers.
 */
export async function POST(request: NextRequest) {
  try {
    const { tenantId } = await request.json();

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId required" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // Get tenant
    const { data: tenant, error: tenantError } = await sb
      .from("tenants")
      .select("*")
      .eq("id", tenantId)
      .single();

    if (tenantError || !tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    let accountId = tenant.stripe_connect_account_id;

    // Create a new Connect account if one doesn't exist
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "standard",
        business_profile: {
          name: tenant.name,
        },
      });
      accountId = account.id;

      // Save to tenant record
      await sb
        .from("tenants")
        .update({ stripe_connect_account_id: accountId })
        .eq("id", tenantId);
    }

    // Create an account link for onboarding/dashboard
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3002";
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: `${appUrl}/dashboard/billing?connect=refresh`,
      return_url: `${appUrl}/dashboard/billing?connect=success`,
    });

    return NextResponse.json({
      accountId,
      authorizationUrl: accountLink.url,
    });
  } catch (error) {
    console.error("Stripe Connect error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
