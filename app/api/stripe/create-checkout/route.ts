import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

/**
 * POST /api/stripe/create-checkout
 * Creates a Stripe Checkout session for a tenant to subscribe to Field Boss Pro.
 * Uses the tiered pricing: $99/mo base (3 techs) + $50/mo per additional tech.
 */
export async function POST(request: NextRequest) {
  try {
    const { tenantId, techCount, email } = await request.json();

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId required" }, { status: 400 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3002";

    // Calculate pricing
    const baseFee = 9900; // $99 in cents
    const additionalTechs = Math.max(0, (techCount || 0) - 3);
    const additionalFee = additionalTechs * 5000; // $50 per extra tech in cents
    const totalAmount = baseFee + additionalFee;

    // Create a Checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      metadata: { tenantId: String(tenantId) },
      line_items: [
        {
          price_data: {
            currency: "usd",
            recurring: { interval: "month" },
            product_data: {
              name: "Field Boss Pro",
              description: `Professional plan — ${techCount || 0} technician${(techCount || 0) !== 1 ? "s" : ""}`,
            },
            unit_amount: totalAmount,
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/dashboard/billing?subscription=success`,
      cancel_url: `${appUrl}/dashboard/billing?subscription=canceled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe Checkout error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
