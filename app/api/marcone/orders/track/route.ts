import { NextRequest, NextResponse } from "next/server";
import { trackPackage } from "@/lib/marcone";

/**
 * GET /api/marcone/orders/track?tracking_number=...
 * Returns Fedex/UPS package events for a tracking number.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const trackingNumber = url.searchParams.get("tracking_number")?.trim();
    if (!trackingNumber) {
      return NextResponse.json(
        { ok: false, error: "tracking_number query param required" },
        { status: 400 }
      );
    }
    const result = await trackPackage(trackingNumber);
    return NextResponse.json({
      ok: true,
      tracking_number: result.trackingNumber,
      package_count: result.packageCount,
      events: result.events || [],
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
