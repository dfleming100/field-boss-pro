import { NextResponse } from "next/server";

/**
 * GET /api/stripe/config
 * Returns the platform's publishable key so the mobile app can initialize Stripe.
 */
export async function GET() {
  return NextResponse.json({
    publishable_key: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  });
}
