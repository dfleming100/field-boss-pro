import { NextRequest, NextResponse } from "next/server";
import { getOrderStatus } from "@/lib/marcone";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/marcone/orders/status
 * Body: { parts_order_id }
 * Pulls latest status from Marcone, updates parts_orders row.
 */
export async function POST(request: NextRequest) {
  try {
    const { parts_order_id } = await request.json();
    if (!parts_order_id) {
      return NextResponse.json({ ok: false, error: "parts_order_id is required" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const { data: order } = await sb
      .from("parts_orders")
      .select("id, external_order_id")
      .eq("id", parts_order_id)
      .single();

    if (!order?.external_order_id) {
      return NextResponse.json({ ok: false, error: "No Marcone order number on this row yet" }, { status: 400 });
    }

    const result = await getOrderStatus(order.external_order_id);
    const info = result.orderResults?.[0];
    if (!info) {
      return NextResponse.json({ ok: false, error: "Marcone returned no order info" }, { status: 404 });
    }

    const statusCode = info.status?.statusCode?.toLowerCase() || "";
    let mappedStatus = "submitted";
    if (statusCode.includes("ship")) mappedStatus = "shipped";
    else if (statusCode.includes("deliver")) mappedStatus = "delivered";
    else if (statusCode.includes("cancel")) mappedStatus = "canceled";
    else if (statusCode.includes("invoice")) mappedStatus = "shipped";

    const trackingNumber = info.trackingNumbers?.[0] || null;
    const updatePayload: Record<string, unknown> = {
      status: mappedStatus,
      tracking_number: trackingNumber,
      delivery_charge: info.deliveryCharge ?? null,
      sales_tax: info.salesTax ?? null,
      total: info.totalCharge ?? null,
      last_status_check_at: new Date().toISOString(),
      marcone_metadata: info as unknown as Record<string, unknown>,
    };

    // Carrier inference from shippingMethod
    const ship = (info.shippingMethod || "").toLowerCase();
    if (ship.includes("fedex")) updatePayload.carrier = "FedEx";
    else if (ship.includes("ups")) updatePayload.carrier = "UPS";
    else if (ship.includes("doordash")) updatePayload.carrier = "DoorDash";

    if (mappedStatus === "delivered") updatePayload.delivered_at = new Date().toISOString();

    await sb.from("parts_orders").update(updatePayload).eq("id", parts_order_id);

    return NextResponse.json({
      ok: true,
      status: mappedStatus,
      status_description: info.status?.statusDescription,
      tracking_number: trackingNumber,
      delivery_charge: info.deliveryCharge,
      total_charge: info.totalCharge,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
