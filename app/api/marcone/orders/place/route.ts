import { NextRequest, NextResponse } from "next/server";
import { placePurchaseOrder } from "@/lib/marcone";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/marcone/orders/place
 * Body: { parts_order_id }
 * Reads the saved cart row + items, builds a Marcone PurchaseOrderRequest,
 * submits it, and writes the returned order number + transaction id back.
 */
export async function POST(request: NextRequest) {
  try {
    const { parts_order_id } = await request.json();
    if (!parts_order_id) {
      return NextResponse.json({ ok: false, error: "parts_order_id is required" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    const { data: order, error: orderErr } = await sb
      .from("parts_orders")
      .select(`
        *,
        items:parts_order_items(*),
        work_order:work_orders(
          id, work_order_number,
          customer:customers(customer_name, service_address, city, state, zip)
        )
      `)
      .eq("id", parts_order_id)
      .single();

    if (orderErr || !order) {
      return NextResponse.json({ ok: false, error: orderErr?.message || "Order not found" }, { status: 404 });
    }

    const customer = (order as any).work_order?.customer;
    if (!customer?.service_address) {
      return NextResponse.json(
        { ok: false, error: "Customer address missing — can't generate ship-to" },
        { status: 400 }
      );
    }

    const purchaseOrderItems = (order.items || []).map((it: any) => ({
      make: it.marcone_make || "",
      partNumber: it.part_number,
      quantity: it.quantity || 1,
      warehouseNumber: it.marcone_warehouse_number,
    }));

    if (purchaseOrderItems.length === 0) {
      return NextResponse.json({ ok: false, error: "No items on this order" }, { status: 400 });
    }

    const poNumber = order.marcone_po_number || `WO${(order as any).work_order?.work_order_number || order.work_order_id}-${Date.now().toString().slice(-6)}`;

    const result = await placePurchaseOrder({
      poNumber,
      warehouseNumber: order.marcone_warehouse_number || undefined,
      shippingMethod: order.marcone_shipping_method || undefined,
      shipTo: {
        name: customer.customer_name,
        address1: customer.service_address,
        city: customer.city,
        state: customer.state,
        zip: customer.zip,
      },
      purchaseOrderItems,
      internalNotes: order.notes || undefined,
    });

    if (!result.success) {
      // Save the rejection but don't change order status
      await sb
        .from("parts_orders")
        .update({
          marcone_transaction_id: result.transactionId || null,
          marcone_metadata: result as unknown as Record<string, unknown>,
        })
        .eq("id", parts_order_id);
      return NextResponse.json(
        { ok: false, error: result.reason || result.errorCode || "Order rejected by Marcone" },
        { status: 400 }
      );
    }

    const orderNumber = result.orderNumbers?.[0];
    await sb
      .from("parts_orders")
      .update({
        status: "submitted",
        submitted_at: new Date().toISOString(),
        external_order_id: orderNumber || null,
        marcone_po_number: poNumber,
        marcone_transaction_id: result.transactionId || null,
        marcone_metadata: result as unknown as Record<string, unknown>,
      })
      .eq("id", parts_order_id);

    return NextResponse.json({
      ok: true,
      order_number: orderNumber,
      transaction_id: result.transactionId,
      substitutions: result.substitutions || [],
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
