import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const PAYMENT_FAILURE_GRACE_DAYS = 5;

export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get("tenantId");
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: tenant, error } = await sb
    .from("tenants")
    .select("subscription_status, subscription_period_end, payment_failed_at, stripe_subscription_id")
    .eq("id", tenantId)
    .single();

  if (error || !tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const status = tenant.subscription_status as string | null;
  const periodEnd = tenant.subscription_period_end ? new Date(tenant.subscription_period_end) : null;
  const failedAt = tenant.payment_failed_at ? new Date(tenant.payment_failed_at) : null;
  const now = new Date();

  // Tenants with no Stripe subscription ever (brand new) — not locked, but flagged
  if (!tenant.stripe_subscription_id) {
    return NextResponse.json({
      locked: false,
      requiresSubscription: true,
      status: null,
      periodEnd: null,
      lockoutAt: null,
      message: "Subscribe to activate your account",
    });
  }

  // Compute lockout date based on status
  let lockoutAt: Date | null = null;
  let message = "";

  if (status === "active" || status === "trialing") {
    return NextResponse.json({
      locked: false,
      requiresSubscription: false,
      status,
      periodEnd: periodEnd?.toISOString() ?? null,
      lockoutAt: null,
      message: "",
    });
  }

  if (status === "past_due") {
    // 5 days from first failed payment
    if (failedAt) {
      lockoutAt = new Date(failedAt.getTime() + PAYMENT_FAILURE_GRACE_DAYS * 24 * 60 * 60 * 1000);
      message = `Payment failed. Update your card by ${lockoutAt.toLocaleDateString()} to avoid losing access.`;
    } else {
      // Past_due but no failed_at recorded — fall back to period end
      lockoutAt = periodEnd;
      message = "Payment failed. Update your card to avoid losing access.";
    }
  } else if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") {
    // Keep access until period end
    lockoutAt = periodEnd;
    message = lockoutAt
      ? `Subscription ended. Access continues until ${lockoutAt.toLocaleDateString()}.`
      : "Subscription ended.";
  } else {
    // incomplete or unknown → require resubscribe
    return NextResponse.json({
      locked: true,
      requiresSubscription: true,
      status,
      periodEnd: periodEnd?.toISOString() ?? null,
      lockoutAt: null,
      message: "Subscription required to continue.",
    });
  }

  const locked = lockoutAt ? now > lockoutAt : false;

  return NextResponse.json({
    locked,
    requiresSubscription: locked,
    status,
    periodEnd: periodEnd?.toISOString() ?? null,
    lockoutAt: lockoutAt?.toISOString() ?? null,
    message,
  });
}
