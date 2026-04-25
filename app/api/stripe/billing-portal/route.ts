import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

/**
 * POST /api/stripe/billing-portal
 * Returns a Stripe Customer Portal URL where the tenant can:
 *   - Update their card on file
 *   - View invoices and receipts
 *   - Cancel or change their subscription
 */
export async function POST(request: NextRequest) {
  try {
    const { tenantId } = await request.json();
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId required" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const { data: tenant, error } = await sb
      .from("tenants")
      .select("stripe_customer_id, stripe_subscription_id")
      .eq("id", tenantId)
      .single();

    if (error || !tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    let customerId = tenant.stripe_customer_id as string | null;

    // Backfill stripe_customer_id from the subscription if missing
    if (!customerId && tenant.stripe_subscription_id) {
      const sub = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
      customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
      if (customerId) {
        await sb.from("tenants").update({ stripe_customer_id: customerId }).eq("id", tenantId);
      }
    }

    if (!customerId) {
      return NextResponse.json(
        { error: "No active subscription. Subscribe first before opening the billing portal." },
        { status: 400 }
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3002";
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/dashboard/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe billing portal error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
