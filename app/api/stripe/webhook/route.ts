import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

type Sb = ReturnType<typeof supabaseAdmin>;

async function markInvoicePaid(sb: Sb, match: { sessionId?: string; paymentIntentId?: string }, paidAmountCents: number, paidVia: string) {
  if (!match.sessionId && !match.paymentIntentId) return { updated: 0 };

  let q = sb.from("invoices").select("id, total, amount_paid, status").limit(1);
  if (match.sessionId) q = q.eq("stripe_checkout_session_id", match.sessionId);
  else if (match.paymentIntentId) q = q.eq("stripe_payment_intent_id", match.paymentIntentId);

  const { data: invoices } = await q;
  const invoice = invoices?.[0];
  if (!invoice) return { updated: 0 };

  const paid = paidAmountCents / 100;
  const total = Number(invoice.total) || 0;
  const newAmountPaid = Number(invoice.amount_paid || 0) + paid;
  const fullyPaid = newAmountPaid + 0.005 >= total;

  await sb
    .from("invoices")
    .update({
      amount_paid: newAmountPaid,
      paid_via: paidVia,
      status: fullyPaid ? "paid" : "partial",
      paid_at: fullyPaid ? new Date().toISOString() : null,
      stripe_payment_intent_id: match.paymentIntentId || undefined,
    })
    .eq("id", invoice.id);

  return { updated: 1, invoiceId: invoice.id, fullyPaid };
}

/**
 * POST /api/stripe/webhook
 * Handles:
 *  - checkout.session.completed  → invoice payment OR subscription activation
 *  - payment_intent.succeeded    → catches direct PI completions
 *  - payment_intent.payment_failed → logs failure
 *  - account.updated             → syncs Connect account state to tenant
 *  - customer.subscription.*     → tenant plan lifecycle
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");
    if (!signature) return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
    } catch (err) {
      console.error("[stripe webhook] signature verify failed:", err);
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        if (session.mode === "subscription" && session.subscription) {
          const tenantId = session.metadata?.tenantId || session.metadata?.tenant_id;
          if (tenantId) {
            await sb
              .from("tenants")
              .update({
                plan: "professional",
                stripe_subscription_id: String(session.subscription),
                stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
                subscription_status: "active",
              })
              .eq("id", tenantId);
          }
          break;
        }

        if (session.mode === "payment" && session.payment_status === "paid") {
          const paidCents = session.amount_total ?? 0;
          await markInvoicePaid(
            sb,
            {
              sessionId: session.id,
              paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : undefined,
            },
            paidCents,
            "card"
          );
        }
        break;
      }

      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        await markInvoicePaid(sb, { paymentIntentId: pi.id }, pi.amount_received ?? pi.amount ?? 0, "card");
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        console.warn("[stripe webhook] payment failed:", pi.id, pi.last_payment_error?.message);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await sb
          .from("tenants")
          .update({ subscription_status: subscription.status })
          .eq("stripe_subscription_id", subscription.id);
        if (subscription.status === "past_due" || subscription.status === "unpaid") {
          console.warn("[stripe webhook] subscription past due:", subscription.id);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const { data: tenants } = await sb
          .from("tenants")
          .select("id")
          .eq("stripe_subscription_id", subscription.id);
        if (tenants && tenants.length > 0) {
          await sb
            .from("tenants")
            .update({
              plan: "free",
              stripe_subscription_id: null,
              subscription_status: "canceled",
            })
            .eq("id", tenants[0].id);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
        if (subId) {
          await sb
            .from("tenants")
            .update({ subscription_status: "past_due" })
            .eq("stripe_subscription_id", subId);
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
        if (subId) {
          await sb
            .from("tenants")
            .update({ subscription_status: "active" })
            .eq("stripe_subscription_id", subId);
        }
        break;
      }

      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        const status = account.charges_enabled && account.payouts_enabled && account.details_submitted
          ? "active"
          : account.details_submitted
          ? "pending_review"
          : "incomplete";
        await sb
          .from("tenants")
          .update({
            stripe_connect_status: status,
            stripe_charges_enabled: account.charges_enabled || false,
            stripe_payouts_enabled: account.payouts_enabled || false,
            stripe_details_submitted: account.details_submitted || false,
          })
          .eq("stripe_connect_account_id", account.id);
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[stripe webhook] error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
