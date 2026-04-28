import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-10-16" });

/**
 * POST /api/invoices/charge-card
 * Creates a PaymentIntent for the invoice on the tenant's Connect account.
 * Returns { client_secret, publishable_key, connect_account_id } for the frontend
 * to confirm with Stripe Elements.
 */
export async function POST(request: NextRequest) {
  try {
    const { invoice_id } = await request.json();
    if (!invoice_id) {
      return NextResponse.json({ error: "invoice_id required" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const { data: invoice } = await sb
      .from("invoices")
      .select(`
        *,
        customer:customers(customer_name, email),
        tenant:tenants(name, stripe_connect_account_id)
      `)
      .eq("id", invoice_id)
      .single();

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (invoice.status === "paid") {
      return NextResponse.json({ error: "Invoice already paid" }, { status: 400 });
    }

    const totalCents = Math.round(Number(invoice.total) * 100);
    const connectAccountId = invoice.tenant?.stripe_connect_account_id;

    if (!connectAccountId) {
      return NextResponse.json(
        { error: "Tenant has not connected Stripe yet. Complete Stripe Connect onboarding first." },
        { status: 400 }
      );
    }

    const piParams: Stripe.PaymentIntentCreateParams = {
      amount: totalCents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      receipt_email: invoice.customer?.email || undefined,
      description: `Invoice ${invoice.invoice_number} — ${invoice.tenant?.name || ""}`,
      metadata: {
        invoice_id: String(invoice_id),
        tenant_id: String(invoice.tenant_id),
      },
    };

    const intent = await stripe.paymentIntents.create(piParams, {
      stripeAccount: connectAccountId,
    });

    await sb
      .from("invoices")
      .update({ stripe_payment_intent_id: intent.id })
      .eq("id", invoice_id);

    return NextResponse.json({
      client_secret: intent.client_secret,
      publishable_key: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      connect_account_id: connectAccountId,
      amount_cents: totalCents,
    });
  } catch (error) {
    console.error("[charge-card] error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
