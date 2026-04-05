import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-10-16" });

/**
 * POST /api/invoices/pay
 * Creates a Stripe Checkout session for an invoice.
 * Customer clicks "Pay" on the public invoice → redirects to Stripe → pays → back to invoice.
 */
export async function POST(request: NextRequest) {
  try {
    const { invoice_id } = await request.json();
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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://field-boss-pro.vercel.app";
    const totalCents = Math.round(Number(invoice.total) * 100);
    const customerEmail = invoice.customer?.email || undefined;
    const tenantName = invoice.tenant?.name || "Field Boss Pro";
    const connectAccountId = invoice.tenant?.stripe_connect_account_id;

    // Build checkout session params
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      customer_email: customerEmail,
      metadata: { invoice_id: String(invoice_id), tenant_id: String(invoice.tenant_id) },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Invoice ${invoice.invoice_number}`,
              description: `${tenantName} — Service Invoice`,
            },
            unit_amount: totalCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/invoice/${invoice_id}?paid=true`,
      cancel_url: `${appUrl}/invoice/${invoice_id}`,
    };

    // If tenant has Stripe Connect, route payment to their account
    let session: Stripe.Checkout.Session;
    if (connectAccountId) {
      session = await stripe.checkout.sessions.create(sessionParams, {
        stripeAccount: connectAccountId,
      });
    } else {
      session = await stripe.checkout.sessions.create(sessionParams);
    }

    // Mark invoice as sent if it was draft
    if (invoice.status === "draft") {
      await sb.from("invoices").update({ status: "sent" }).eq("id", invoice_id);
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Invoice pay error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
