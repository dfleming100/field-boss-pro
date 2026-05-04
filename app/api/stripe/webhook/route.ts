import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

type Sb = ReturnType<typeof supabaseAdmin>;

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || "darryl@flemingusa.com";

async function alertSuperAdmin(subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Field Boss Alerts <alerts@fieldbosspro.com>",
        to: SUPER_ADMIN_EMAIL,
        subject,
        html,
      }),
    });
  } catch (e) {
    console.error("[alert] failed to send super-admin email:", e);
  }
}

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
            const sub = await stripe.subscriptions.retrieve(String(session.subscription));
            await sb
              .from("tenants")
              .update({
                plan: "professional",
                stripe_subscription_id: String(session.subscription),
                stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
                subscription_status: sub.status,
                subscription_period_end: sub.current_period_end
                  ? new Date(sub.current_period_end * 1000).toISOString()
                  : null,
                payment_failed_at: null,
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
          .update({
            subscription_status: subscription.status,
            subscription_period_end: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000).toISOString()
              : null,
          })
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
          .select("id, name, contact_email, contact_phone")
          .eq("stripe_subscription_id", subscription.id);
        if (tenants && tenants.length > 0) {
          const tenant = tenants[0];
          await sb
            .from("tenants")
            .update({
              plan: "free",
              stripe_subscription_id: null,
              subscription_status: "canceled",
              subscription_period_end: subscription.current_period_end
                ? new Date(subscription.current_period_end * 1000).toISOString()
                : null,
            })
            .eq("id", tenant.id);

          await alertSuperAdmin(
            `🔴 Tenant cancelled: ${tenant.name}`,
            `<h2>Subscription cancelled</h2>
            <p><strong>${tenant.name}</strong> just cancelled their Field Boss Pro subscription.</p>
            <ul>
              <li>Tenant ID: ${tenant.id}</li>
              <li>Email: ${tenant.contact_email || "—"}</li>
              <li>Phone: ${tenant.contact_phone || "—"}</li>
              <li>Access continues until: ${subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toLocaleDateString() : "—"}</li>
            </ul>
            <p>Reach out before period end to win them back.</p>`
          );
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
        if (subId) {
          // Only stamp payment_failed_at if not already set (preserves first-failure timestamp for grace window)
          const { data: tenant } = await sb
            .from("tenants")
            .select("id, name, contact_email, contact_phone, payment_failed_at")
            .eq("stripe_subscription_id", subId)
            .single();
          const isFirstFailure = !tenant?.payment_failed_at;
          await sb
            .from("tenants")
            .update({
              subscription_status: "past_due",
              payment_failed_at: tenant?.payment_failed_at || new Date().toISOString(),
            })
            .eq("stripe_subscription_id", subId);

          // Only alert on the first failure (avoid spam from Stripe's retry attempts)
          if (isFirstFailure && tenant) {
            await alertSuperAdmin(
              `⚠️ Payment failed: ${tenant.name}`,
              `<h2>Subscription payment failed</h2>
              <p><strong>${tenant.name}</strong>'s subscription card was declined.</p>
              <ul>
                <li>Tenant ID: ${tenant.id}</li>
                <li>Email: ${tenant.contact_email || "—"}</li>
                <li>Phone: ${tenant.contact_phone || "—"}</li>
                <li>Amount: $${((invoice.amount_due || 0) / 100).toFixed(2)}</li>
              </ul>
              <p>They have 5 days from now to update their card before access is revoked. Stripe will keep retrying automatically.</p>`
            );
          }
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
        if (subId) {
          await sb
            .from("tenants")
            .update({
              subscription_status: "active",
              payment_failed_at: null,
            })
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

        // Auto-provision a Terminal Location once the connected account is fully active.
        // Required so techs can use Tap to Pay through this tenant's account.
        if (account.charges_enabled && account.details_submitted) {
          try {
            const existing = await stripe.terminal.locations.list(
              { limit: 1 },
              { stripeAccount: account.id }
            );
            if (existing.data.length === 0) {
              const addr = account.business_profile?.support_address || account.company?.address;
              const { data: tenantRow } = await sb
                .from("tenants")
                .select("name")
                .eq("stripe_connect_account_id", account.id)
                .single();
              const displayName = tenantRow?.name || account.business_profile?.name || "Field Service";
              await stripe.terminal.locations.create(
                {
                  display_name: displayName,
                  address: {
                    line1: addr?.line1 || "Address pending",
                    city: addr?.city || "Pending",
                    state: addr?.state || "TX",
                    postal_code: addr?.postal_code || "00000",
                    country: addr?.country || "US",
                  },
                },
                { stripeAccount: account.id }
              );
              console.log("[stripe webhook] auto-created Terminal Location for", account.id);
            }
          } catch (locErr) {
            console.warn("[stripe webhook] failed to auto-create Terminal Location:", (locErr as Error).message);
          }
        }
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
