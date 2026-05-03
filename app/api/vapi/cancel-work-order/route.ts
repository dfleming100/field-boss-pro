import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/vapi/cancel-work-order
 *
 * Vapi tool — called by the voice agent when a customer says they want
 * to cancel their service entirely (NOT reschedule). Mirrors the SMS
 * cancellation flow:
 *   - Sets work_orders.status = 'Canceled'
 *   - Stamps status_changed_at + appends an audit note
 *   - Marks any future scheduled appointments as 'canceled'
 *
 * Accepts:
 *   - work_order_number (preferred — passed by Vapi tool args)
 *   - reason (optional — captured into the audit note)
 *
 * Falls back to call.metadata.work_order_number if the assistant
 * forgets to pass it (matches the pattern in book-appointment).
 */
export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();

    let args = raw;
    let toolCallId = "";
    if (raw.message?.toolCalls?.[0]) {
      const tc = raw.message.toolCalls[0];
      args = tc.function?.arguments || {};
      toolCallId = tc.id || "";
    }

    let workOrderNumber = (args.work_order_number || args.workOrderNumber || "").trim();
    if (!workOrderNumber) {
      const meta = raw.message?.call?.assistantOverrides?.metadata
        || raw.message?.call?.metadata || {};
      const vars = raw.message?.call?.assistantOverrides?.variableValues || {};
      workOrderNumber = (meta.work_order_number || vars.work_order_number || "").trim();
    }
    const reason = (args.reason || "").toString().trim();

    if (!workOrderNumber) {
      return wrapResponse(toolCallId, {
        success: false,
        agent_summary: "I was not able to find that work order. Let me have a team member call you back.",
      });
    }

    const sb = supabaseAdmin();

    // Match against work_order_number OR warranty_wo_number — Vapi may
    // get the WO number from a warranty company that uses different
    // numbering than ours.
    const digits = workOrderNumber.replace(/\D/g, "");
    const candidates = [workOrderNumber, `WO-${digits}`, digits].filter((v, i, arr) => v && arr.indexOf(v) === i);

    let wo: any = null;
    for (const c of candidates) {
      const { data } = await sb
        .from("work_orders")
        .select("id, tenant_id, work_order_number, status, appliance_type, notes, customer:customers(customer_name)")
        .or(`work_order_number.eq.${c},warranty_wo_number.eq.${c}`)
        .not("status", "in", '("Complete","Canceled","canceled")')
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) { wo = data; break; }
    }

    if (!wo) {
      return wrapResponse(toolCallId, {
        success: false,
        agent_summary: "I could not find an active work order with that number. Let me transfer you to a team member.",
      });
    }

    const stamp = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
    const reasonNote = reason
      ? `[${stamp}] Canceled by customer via voice call. Reason: "${reason.slice(0, 200)}"`
      : `[${stamp}] Canceled by customer via voice call.`;
    const newNotes = wo.notes ? `${wo.notes}\n\n${reasonNote}` : reasonNote;

    await sb.from("work_orders").update({
      status: "Canceled",
      status_changed_at: new Date().toISOString(),
      notes: newNotes,
    }).eq("id", wo.id);

    // Cancel any future-or-today scheduled appointments
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    await sb.from("appointments")
      .update({ status: "canceled" })
      .eq("work_order_id", wo.id)
      .eq("status", "scheduled")
      .gte("appointment_date", todayStr);

    const cust = Array.isArray(wo.customer) ? wo.customer[0] : wo.customer;
    const firstName = (cust?.customer_name || "there").split(" ")[0];
    return wrapResponse(toolCallId, {
      success: true,
      work_order_number: wo.work_order_number,
      status: "Canceled",
      agent_summary: `No problem, ${firstName}. I have canceled your ${wo.appliance_type || "service"} request. If you change your mind or need anything in the future, just give us a call.`,
    });
  } catch (error) {
    console.error("Cancel WO error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

function wrapResponse(toolCallId: string, result: any) {
  if (toolCallId) {
    return NextResponse.json({ results: [{ toolCallId, result: JSON.stringify(result) }] });
  }
  return NextResponse.json(result);
}
