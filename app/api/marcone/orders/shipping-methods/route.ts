import { NextRequest, NextResponse } from "next/server";
import { getShippingMethods } from "@/lib/marcone";

// GET /api/marcone/orders/shipping-methods?warehouse=601
// Returns the Marcone-supported shippingMethod codes for a given warehouse
// (or customer default if omitted). Use these strings verbatim on purchase orders.
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const warehouse = url.searchParams.get("warehouse")?.trim() || undefined;
    const result = await getShippingMethods(warehouse);
    return NextResponse.json({ ok: true, warehouse, result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
