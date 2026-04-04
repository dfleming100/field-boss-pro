import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/vapi/customer-lookup
 * Vapi custom tool — looks up customer by address or phone.
 * Returns customer info + active work order + appointment details.
 * Supports Vapi toolCallId format.
 */

// Normalize address abbreviations (matches n8n workflow logic)
function normalizeAddress(addr: string): string {
  let s = addr.trim().toLowerCase();
  const abbrevs: [RegExp, string][] = [
    [/\bparkway\b/g, "pkwy"], [/\bboulevard\b/g, "blvd"],
    [/\bdrive\b/g, "dr"], [/\bstreet\b/g, "st"],
    [/\bavenue\b/g, "ave"], [/\blane\b/g, "ln"],
    [/\broad\b/g, "rd"], [/\bcourt\b/g, "ct"],
    [/\bcircle\b/g, "cir"], [/\bplace\b/g, "pl"],
    [/\btrail\b/g, "trl"], [/\bnorth\b/g, "n"],
    [/\bsouth\b/g, "s"], [/\beast\b/g, "e"], [/\bwest\b/g, "w"],
  ];
  for (const [pattern, replacement] of abbrevs) {
    s = s.replace(pattern, replacement);
  }
  return s;
}

// Expand address for TTS (voice reads "Dr" as "Doctor")
function expandAddress(s: string): string {
  return s
    .replace(/\bDr\b/gi, "Drive").replace(/\bSt\b/gi, "Street")
    .replace(/\bBlvd\b/gi, "Boulevard").replace(/\bAve\b/gi, "Avenue")
    .replace(/\bLn\b/gi, "Lane").replace(/\bRd\b/gi, "Road")
    .replace(/\bCt\b/gi, "Court").replace(/\bCir\b/gi, "Circle")
    .replace(/\bPl\b/gi, "Place").replace(/\bPkwy\b/gi, "Parkway")
    .replace(/\bTrl\b/gi, "Trail").replace(/\bN\b/g, "North")
    .replace(/\bS\b/g, "South").replace(/\bE\b/g, "East").replace(/\bW\b/g, "West");
}

const STATUS_PRIORITY = ["Parts Have Arrived", "Parts Ordered", "New", "Scheduled"];

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();

    // Handle Vapi tool call format
    let args = raw;
    let toolCallId = "";
    if (raw.message?.toolCalls?.[0]) {
      const tc = raw.message.toolCalls[0];
      args = tc.function?.arguments || {};
      toolCallId = tc.id || "";
    }

    const address = (args.address || "").trim();
    const phone = (args.phone || "").replace(/\D/g, "");
    const name = (args.name || "").trim();

    const sb = supabaseAdmin();

    let customer: any = null;

    // Search by address first
    if (address.length >= 3) {
      const normalized = normalizeAddress(address);
      const { data } = await sb
        .from("customers")
        .select("*")
        .ilike("service_address", `%${normalized}%`)
        .limit(1);
      if (data?.length) customer = data[0];
    }

    // Fallback: search by phone
    if (!customer && phone.length >= 7) {
      const last7 = phone.slice(-7);
      const { data } = await sb
        .from("customers")
        .select("*")
        .or(`phone.ilike.%${last7}%`)
        .limit(1);
      if (data?.length) customer = data[0];
    }

    // Fallback: search by name
    if (!customer && name.length >= 2) {
      const { data } = await sb
        .from("customers")
        .select("*")
        .ilike("customer_name", `%${name}%`)
        .limit(1);
      if (data?.length) customer = data[0];
    }

    if (!customer) {
      const result = {
        found: false,
        message: "No customer record found for the provided address or phone number.",
      };
      return wrapResponse(toolCallId, result);
    }

    // Fetch work orders for this customer, ordered by status priority
    const { data: workOrders } = await sb
      .from("work_orders")
      .select(`
        *,
        technician:technicians(tech_name),
        appointments(id, appointment_date, start_time, end_time, status)
      `)
      .eq("customer_id", customer.id)
      .eq("tenant_id", customer.tenant_id)
      .not("status", "in", '("Complete")')
      .order("created_at", { ascending: false });

    // Find active WO by status priority
    let activeWO: any = null;
    for (const targetStatus of STATUS_PRIORITY) {
      const match = (workOrders || []).find((wo: any) => wo.status === targetStatus);
      if (match) {
        const techName = match.technician?.tech_name || "";
        const appts = match.appointments || [];
        const latestAppt = appts.find((a: any) => a.status === "scheduled");

        activeWO = {
          wo_id: match.id,
          wo_number: match.work_order_number || "",
          status: match.status,
          appliance_type: match.appliance_type || "",
          tech_name: techName,
          job_type: match.job_type || "",
          appointment_id: latestAppt?.id || "",
        };
        break;
      }
    }

    // Build address string for TTS
    const addr = expandAddress(
      [customer.service_address, customer.city, customer.state, customer.zip]
        .filter(Boolean)
        .join(", ")
    );

    let message = `Customer: ${customer.customer_name}. Address: ${addr}.`;
    if (activeWO) {
      message += ` Active work order ${activeWO.wo_number}: ${activeWO.appliance_type}. Status: ${activeWO.status}.`;
      if (activeWO.status === "Scheduled" && activeWO.tech_name) {
        message += ` Assigned to ${activeWO.tech_name}.`;
      }
    } else {
      message += " No active work orders found.";
    }

    // If scheduled, fetch appointment details
    let enrichedAppt: any = null;
    if (activeWO?.status === "Scheduled" && activeWO.appointment_id) {
      const { data: appt } = await sb
        .from("appointments")
        .select("appointment_date, start_time, end_time")
        .eq("id", activeWO.appointment_id)
        .single();

      if (appt) {
        const d = new Date(appt.appointment_date + "T12:00:00");
        const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        const dateDisplay = `${months[d.getMonth()]} ${d.getDate()}`;
        enrichedAppt = {
          date: appt.appointment_date,
          date_display: dateDisplay,
          window_start: appt.start_time,
          window_end: appt.end_time,
        };
        message = message.replace(
          "Status: Scheduled.",
          `Status: Scheduled for ${dateDisplay} between ${appt.start_time} and ${appt.end_time} with ${activeWO.tech_name}.`
        );
      }
    }

    const result = {
      found: true,
      customer_id: customer.id,
      customer_name: customer.customer_name,
      phone: customer.phone,
      address: addr,
      message,
      active_wo: activeWO,
      appointment: enrichedAppt,
    };

    return wrapResponse(toolCallId, result);
  } catch (error) {
    console.error("Customer lookup error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

function wrapResponse(toolCallId: string, result: any) {
  if (toolCallId) {
    return NextResponse.json({
      results: [{ toolCallId, result: JSON.stringify(result) }],
    });
  }
  return NextResponse.json(result);
}
