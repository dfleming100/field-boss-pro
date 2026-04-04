import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

/**
 * POST /api/stripe/webhook
 * Handles Stripe webhook events for subscriptions and Connect accounts.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");

    if (!signature) {
      return NextResponse.json(
        { error: "Missing stripe-signature header" },
        { status: 400 }
      );
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET!
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.metadata?.tenantId;
        if (tenantId && session.subscription) {
          await sb
            .from("tenants")
            .update({
              plan: "professional",
              stripe_subscription_id: session.subscription as string,
            })
            .eq("id", tenantId);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        // Update tenant subscription status based on subscription state
        const status = subscription.status;
        if (status === "active" || status === "trialing") {
          // Subscription is active
        } else if (status === "past_due" || status === "unpaid") {
          // Flag for follow-up
          console.warn("Subscription past due:", subscription.id);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        // Find tenant by subscription ID and downgrade
        const { data: tenants } = await sb
          .from("tenants")
          .select("id")
          .eq("stripe_subscription_id", subscription.id);

        if (tenants && tenants.length > 0) {
          await sb
            .from("tenants")
            .update({ plan: "free", stripe_subscription_id: null })
            .eq("id", tenants[0].id);
        }
        break;
      }

      case "account.updated": {
        // Stripe Connect account update
        const account = event.data.object as Stripe.Account;
        // Update tenant's connect status
        if (account.charges_enabled) {
          await sb
            .from("tenants")
            .update({ stripe_connect_status: "active" })
            .eq("stripe_connect_account_id", account.id);
        }
        break;
      }

      default:
        // Unhandled event type
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
