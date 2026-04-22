import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2023-10-16" });

/**
 * GET /api/stripe/connect-status?tenantId=...
 * Fetches live account state from Stripe, syncs it onto tenants, and returns it.
 * Used by the billing page to show accurate Connect status + offer a resume-onboarding link if incomplete.
 */
export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get("tenantId");
  if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

  const sb = supabaseAdmin();
  const { data: tenant } = await sb
    .from("tenants")
    .select("id, stripe_connect_account_id")
    .eq("id", tenantId)
    .maybeSingle();

  if (!tenant?.stripe_connect_account_id) {
    return NextResponse.json({ status: "not_connected" });
  }

  try {
    const account = await stripe.accounts.retrieve(tenant.stripe_connect_account_id);
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
      .eq("id", tenantId);

    let resumeUrl: string | null = null;
    if (status !== "active") {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://field-boss-pro.vercel.app";
      const link = await stripe.accountLinks.create({
        account: account.id,
        type: "account_onboarding",
        refresh_url: `${appUrl}/dashboard/billing?connect=refresh`,
        return_url: `${appUrl}/dashboard/billing?connect=success`,
      });
      resumeUrl = link.url;
    }

    return NextResponse.json({
      status,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      requirements_currently_due: account.requirements?.currently_due || [],
      resume_url: resumeUrl,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "unknown error" }, { status: 500 });
  }
}
