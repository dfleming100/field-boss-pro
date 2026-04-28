import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-10-16" });

/**
 * POST /api/invoices/charge-card/confirm
 * Called by the frontend after Stripe Elements confirms a PaymentIntent.
 * Verifies the PI succeeded on the connected account and marks the invoice paid.
 * (Connect destination PIs don't fire events on the platform webhook by default.)
 */
export async function POST(request: NextRequest) {
  try {
    const { invoice_id, payment_intent_id } = await request.json();
    if (!invoice_id || !payment_intent_id) {
      return NextResponse.json({ error: "invoice_id and payment_intent_id required" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const { data: invoice } = await sb
      .from("invoices")
      .select("id, total, amount_paid, tenant_id, tenant:tenants(stripe_connect_account_id)")
      .eq("id", invoice_id)
      .single();

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const connectAccountId = (invoice.tenant as any)?.stripe_connect_account_id;
    if (!connectAccountId) {
      return NextResponse.json({ error: "No Connect account on tenant" }, { status: 400 });
    }

    const pi = await stripe.paymentIntents.retrieve(payment_intent_id, {
      stripeAccount: connectAccountId,
    });

    if (pi.status !== "succeeded") {
      return NextResponse.json({ error: `Payment not succeeded (status: ${pi.status})` }, { status: 400 });
    }

    const paid = (pi.amount_received ?? pi.amount) / 100;
    const total = Number(invoice.total) || 0;
    const newAmountPaid = Number(invoice.amount_paid || 0) + paid;
    const fullyPaid = newAmountPaid + 0.005 >= total;

    await sb
      .from("invoices")
      .update({
        amount_paid: newAmountPaid,
        paid_via: "card",
        status: fullyPaid ? "paid" : "partial",
        paid_at: fullyPaid ? new Date().toISOString() : null,
        stripe_payment_intent_id: pi.id,
      })
      .eq("id", invoice_id);

    return NextResponse.json({ success: true, fullyPaid, amountPaid: newAmountPaid });
  } catch (error) {
    console.error("[charge-card/confirm] error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
