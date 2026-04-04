import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/vapi/book-appointment
 * Vapi custom tool — books an appointment for a work order.
 * Replicates FA - Book Appointment n8n workflow logic.
 * Validates date, creates appointment, updates WO status, updates capacity.
 */

const ZIP_WINDOWS: Record<string, [string, string]> = {
  "75033": ["8:30am", "10:30am"], "75034": ["8:30am", "10:30am"],
  "75036": ["8:30am", "10:30am"], "75068": ["8:30am", "10:30am"],
  "75078": ["8:30am", "10:30am"], "75009": ["8:30am", "10:30am"],
  "75035": ["9:00am", "12:00pm"], "75070": ["9:00am", "12:00pm"],
  "75071": ["9:00am", "12:00pm"], "75072": ["9:00am", "12:00pm"],
  "75069": ["9:00am", "12:00pm"],
  "75002": ["10:00am", "1:00pm"], "75013": ["10:00am", "1:00pm"],
  "75074": ["10:00am", "1:00pm"], "75075": ["10:00am", "1:00pm"],
  "75023": ["10:00am", "1:00pm"], "75024": ["10:00am", "1:00pm"],
  "75025": ["10:00am", "1:00pm"], "75093": ["10:00am", "1:00pm"],
  "75007": ["11:00am", "2:00pm"], "75010": ["11:00am", "2:00pm"],
  "75056": ["11:00am", "2:00pm"],
};

const TECHS: Record<string, { maxTotal: number; maxRepairs: number }> = {
  Darryl: { maxTotal: 8, maxRepairs: 4 },
  Jessy: { maxTotal: 12, maxRepairs: 6 },
};

// Convert "8:30am" → "08:30"
function to24h(t: string): string {
  const match = t.match(/(\d+):(\d+)(am|pm)/i);
  if (!match) return "09:00";
  let h = parseInt(match[1]);
  const m = match[2];
  const ampm = match[3].toLowerCase();
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m}`;
}

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

    const workOrderNumber = (args.work_order_number || args.workOrderNumber || "").trim();
    const chosenDate = (args.chosen_date || args.chosenDate || "").trim();
    const techIdArg = (args.tech_id || args.techId || "").trim();

    const sb = supabaseAdmin();

    // Find work order
    const { data: wo } = await sb
      .from("work_orders")
      .select(`
        *,
        customer:customers(zip),
        technician:technicians(id, tech_name)
      `)
      .or(`work_order_number.eq.${workOrderNumber}`)
      .limit(1)
      .single();

    if (!wo) {
      return wrapResponse(toolCallId, { success: false, error: "Work order not found" });
    }

    const zip = wo.customer?.zip || "";
    const jobType = wo.job_type || "";
    const isRepair = jobType === "Repair Follow-up";
    const techId = techIdArg ? parseInt(techIdArg) : wo.assigned_technician_id;

    // Get tech info
    let techName = wo.technician?.tech_name || "Darryl";
    if (techId && techId !== wo.assigned_technician_id) {
      const { data: tech } = await sb.from("technicians").select("tech_name").eq("id", techId).single();
      if (tech) techName = tech.tech_name;
    }

    const profile = TECHS[techName] || { maxTotal: 12, maxRepairs: 6 };

    // ── Validation ──
    const chosenDateObj = new Date(chosenDate + "T12:00:00");
    const dow = chosenDateObj.getDay();
    const today = new Date().toISOString().split("T")[0];

    if (dow === 0 || dow === 6) {
      return wrapResponse(toolCallId, {
        success: false, error: "weekend",
        message: `${techName} is not available on weekends. Please choose a weekday.`,
      });
    }

    if (chosenDate <= today) {
      return wrapResponse(toolCallId, {
        success: false, error: "sameday",
        message: "We cannot book same-day or past appointments. Please choose a future date.",
      });
    }

    // Check days off
    const { data: daysOff } = await sb
      .from("days_off")
      .select("id")
      .eq("date_off", chosenDate)
      .or(`technician_id.eq.${techId},technician_id.is.null`)
      .limit(1);

    if (daysOff && daysOff.length > 0) {
      return wrapResponse(toolCallId, {
        success: false, error: "dayoff",
        message: `The technician is not available on ${chosenDate}. Please choose a different date.`,
      });
    }

    // Check capacity
    const { data: capRow } = await sb
      .from("tech_daily_capacity")
      .select("*")
      .eq("technician_id", techId)
      .eq("date", chosenDate)
      .single();

    const totalBooked = capRow?.current_appointments || 0;
    const repairsBooked = capRow?.current_repairs || 0;
    const maxTotal = capRow?.max_appointments || profile.maxTotal;
    const maxRepairs = capRow?.max_repairs || profile.maxRepairs;

    if (totalBooked >= maxTotal) {
      return wrapResponse(toolCallId, {
        success: false, error: "capacity_total",
        message: `The technician is fully booked on ${chosenDate}. Please choose a different date.`,
      });
    }

    if (isRepair && repairsBooked >= maxRepairs) {
      return wrapResponse(toolCallId, {
        success: false, error: "capacity_repairs",
        message: `No repair slots available on ${chosenDate}. Please choose a different date.`,
      });
    }

    // ── Book it ──
    const win = ZIP_WINDOWS[zip] || ["9:00am", "12:00pm"];
    const startTime = to24h(win[0]);
    const endTime = to24h(win[1]);

    // Cancel any existing scheduled appointments for this WO
    await sb
      .from("appointments")
      .delete()
      .eq("work_order_id", wo.id)
      .eq("status", "scheduled");

    // Create appointment
    const { data: appt, error: apptErr } = await sb
      .from("appointments")
      .insert({
        tenant_id: wo.tenant_id,
        work_order_id: wo.id,
        technician_id: techId,
        appointment_date: chosenDate,
        start_time: startTime,
        end_time: endTime,
        status: "scheduled",
      })
      .select("id")
      .single();

    if (apptErr) {
      return wrapResponse(toolCallId, { success: false, error: apptErr.message });
    }

    // Update WO status to Scheduled
    await sb
      .from("work_orders")
      .update({
        status: "Scheduled",
        assigned_technician_id: techId,
        service_date: chosenDate,
      })
      .eq("id", wo.id);

    // Update or create capacity record
    if (capRow) {
      await sb
        .from("tech_daily_capacity")
        .update({
          current_appointments: totalBooked + 1,
          current_repairs: isRepair ? repairsBooked + 1 : repairsBooked,
        })
        .eq("id", capRow.id);
    } else {
      await sb.from("tech_daily_capacity").insert({
        tenant_id: wo.tenant_id,
        technician_id: techId,
        date: chosenDate,
        max_appointments: maxTotal,
        max_repairs: maxRepairs,
        current_appointments: 1,
        current_repairs: isRepair ? 1 : 0,
      });
    }

    // Send SMS notification
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3002";
      await fetch(`${appUrl}/api/notifications/status-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          work_order_id: wo.id,
          tenant_id: wo.tenant_id,
          old_status: wo.status,
          new_status: "Scheduled",
        }),
      });
    } catch {
      // SMS is best-effort, don't fail the booking
    }

    // Format response
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const d = new Date(chosenDate + "T12:00:00");
    const dateDisplay = `${months[d.getMonth()]} ${d.getDate()}`;

    const result = {
      success: true,
      appointment_id: appt.id,
      wo_number: workOrderNumber,
      date: chosenDate,
      date_display: dateDisplay,
      window: `${win[0]} - ${win[1]}`,
      window_start: win[0],
      window_end: win[1],
      tech_name: techName,
      status: "Booked",
    };

    return wrapResponse(toolCallId, result);
  } catch (error) {
    console.error("Book appointment error:", error);
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
