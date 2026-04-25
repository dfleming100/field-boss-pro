import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

/**
 * POST /api/stripe/sync-tenant   { tenantId }
 * Backfills stripe_customer_id / stripe_subscription_id / subscription_status
 * from Stripe (find customer by tenant admin email, take latest active sub).
 * Use when a webhook event is missed.
 */
export async function POST(request: NextRequest) {
  try {
    const { tenantId } = await request.json();
    if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

    const sb = supabaseAdmin();

    const { data: admin } = await sb
      .from("tenant_users")
      .select("user_email")
      .eq("tenant_id", tenantId)
      .eq("role", "admin")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!admin?.user_email) {
      return NextResponse.json({ error: "No admin user found for tenant" }, { status: 404 });
    }

    const customers = await stripe.customers.list({ email: admin.user_email, limit: 10 });
    if (customers.data.length === 0) {
      return NextResponse.json({ error: `No Stripe customer found for ${admin.user_email}` }, { status: 404 });
    }

    let chosenCustomer: Stripe.Customer | null = null;
    let chosenSub: Stripe.Subscription | null = null;
    for (const c of customers.data) {
      const subs = await stripe.subscriptions.list({ customer: c.id, status: "all", limit: 5 });
      const active = subs.data.find((s) => ["active", "trialing", "past_due"].includes(s.status));
      if (active) {
        chosenCustomer = c;
        chosenSub = active;
        break;
      }
      if (!chosenCustomer) chosenCustomer = c;
    }

    const update: Record<string, unknown> = {
      stripe_customer_id: chosenCustomer?.id ?? null,
    };
    if (chosenSub) {
      update.stripe_subscription_id = chosenSub.id;
      update.subscription_status = chosenSub.status;
      update.plan = "professional";
    }

    await sb.from("tenants").update(update).eq("id", tenantId);

    return NextResponse.json({
      ok: true,
      customerId: chosenCustomer?.id,
      subscriptionId: chosenSub?.id,
      status: chosenSub?.status,
    });
  } catch (error) {
    console.error("Stripe sync-tenant error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
