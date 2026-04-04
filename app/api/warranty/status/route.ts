import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/warranty/status
 * Bidirectional status sync with warranty companies.
 *
 * Inbound: Warranty company pushes a status update to Field Boss
 * {
 *   "warranty_wo_number": "AHS-12345678",
 *   "tenant_id": 1,
 *   "new_status": "Parts Ordered",
 *   "notes": "Part #XYZ ordered, ETA 5 days"
 * }
 *
 * Also used by Edge Functions to push status OUT to warranty companies via n8n.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { warranty_wo_number, tenant_id, new_status, notes } = body;

    if (!warranty_wo_number || !tenant_id) {
      return NextResponse.json(
        { error: "warranty_wo_number and tenant_id are required" },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();

    // Find the work order by warranty WO number
    const { data: workOrder, error: findError } = await sb
      .from("work_orders")
      .select("id, status, work_order_number")
      .eq("tenant_id", tenant_id)
      .eq("warranty_wo_number", warranty_wo_number)
      .single();

    if (findError || !workOrder) {
      return NextResponse.json(
        { error: "Work order not found for warranty number: " + warranty_wo_number },
        { status: 404 }
      );
    }

    // Map warranty company statuses to Field Boss statuses
    const STATUS_MAP: Record<string, string> = {
      // AHS statuses → Field Boss statuses
      "New": "draft",
      "Assigned": "draft",
      "Scheduling": "ready_to_schedule",
      "Parts Ordered": "ready_to_schedule",
      "Parts Have Arrived": "ready_to_schedule",
      "Scheduled": "scheduled",
      "In Progress": "in_progress",
      "Completed": "completed",
      "Canceled": "canceled",
      // Also accept Field Boss native statuses
      "draft": "draft",
      "ready_to_schedule": "ready_to_schedule",
      "scheduled": "scheduled",
      "in_progress": "in_progress",
      "completed": "completed",
      "canceled": "canceled",
    };

    const mappedStatus = STATUS_MAP[new_status] || new_status;

    // Update the work order
    const updateData: any = { status: mappedStatus };
    if (notes) {
      updateData.notes = (workOrder as any).notes
        ? `${(workOrder as any).notes}\n\n[${new Date().toISOString()}] Warranty update: ${notes}`
        : `[${new Date().toISOString()}] Warranty update: ${notes}`;
    }

    const { error: updateError } = await sb
      .from("work_orders")
      .update(updateData)
      .eq("id", workOrder.id);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to update: " + updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      work_order_id: workOrder.id,
      work_order_number: workOrder.work_order_number,
      old_status: workOrder.status,
      new_status: mappedStatus,
    });
  } catch (error) {
    console.error("Warranty status error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/warranty/status?warranty_wo_number=AHS-123&tenant_id=1
 * Warranty company can check current status of a work order.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const warrantyWoNumber = searchParams.get("warranty_wo_number");
  const tenantId = searchParams.get("tenant_id");

  if (!warrantyWoNumber || !tenantId) {
    return NextResponse.json(
      { error: "warranty_wo_number and tenant_id query params required" },
      { status: 400 }
    );
  }

  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("work_orders")
    .select(`
      id, work_order_number, status, job_type, appliance_type,
      service_date, notes, created_at, updated_at,
      customer:customers(customer_name, phone, service_address, city, state, zip),
      technician:technicians(tech_name, phone)
    `)
    .eq("tenant_id", tenantId)
    .eq("warranty_wo_number", warrantyWoNumber)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Work order not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, work_order: data });
}
