import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/vapi/book-appointment
 * Books an appointment for a work order.
 * Reads ZIP windows and tech capacity from database (per-tenant).
 */

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
    const source = raw.message?.toolCalls ? "vapi_voice" : "sms_agent";
    if (raw.message?.toolCalls?.[0]) {
      const tc = raw.message.toolCalls[0];
      args = tc.function?.arguments || {};
      toolCallId = tc.id || "";
    }

    // Fall back to Vapi call metadata if the assistant passes a blank WO number
    let workOrderNumber = (args.work_order_number || args.workOrderNumber || "").trim();
    if (!workOrderNumber) {
      const meta = raw.message?.call?.assistantOverrides?.metadata
        || raw.message?.call?.metadata || {};
      const vars = raw.message?.call?.assistantOverrides?.variableValues || {};
      workOrderNumber = (meta.work_order_number || vars.work_order_number || "").trim();
    }
    const chosenDate = (args.chosen_date || args.chosenDate || "").trim();
    const techIdArg = (args.tech_id || args.techId || "").trim();

    const sb = supabaseAdmin();

    // Accept "1005", "WO-1005", or "wo 1005" — try exact then strip/add prefix.
    const digitsOnly = workOrderNumber.replace(/\D/g, "");
    const candidates = [
      workOrderNumber,
      `WO-${digitsOnly}`,
      digitsOnly,
    ].filter((v, i, arr) => v && arr.indexOf(v) === i);

    // Find work order
    let wo: any = null;
    for (const candidate of candidates) {
      const { data } = await sb
        .from("work_orders")
        .select(`
          *,
          customer:customers(zip),
          technician:technicians!assigned_technician_id(id, tech_name, max_daily_appointments, max_daily_repairs)
        `)
        .eq("work_order_number", candidate)
        .limit(1)
        .maybeSingle();
      if (data) { wo = data; break; }
    }

    if (!wo) {
      return wrapResponse(toolCallId, { success: false, error: "Work order not found" });
    }

    const tenantId = wo.tenant_id;
    const zip = wo.customer?.zip || "";
    const jobType = wo.job_type || "";
    const isRepair = jobType === "Repair Follow-up";
    // For Repair Follow-up, the original tech who diagnosed always handles
    // the repair. Ignore any tech_id arg from Vapi/SMS — it's a known
    // hallucination source and was the suspected root cause of the Lori
    // Trapp glitch where booking failed against the wrong tech's capacity.
    // EXCEPTION: if the WO is marked Repair Follow-up but has no assigned
    // tech (e.g. parts-arrival flow on a brand-new WO that was never
    // diagnosed), fall back to the routed tech_id from the caller —
    // otherwise the insert hits a NOT NULL violation and the customer is
    // stuck in a "could not confirm that date" loop. (Rowland 2026-05-04)
    const techId = isRepair && wo.assigned_technician_id
      ? wo.assigned_technician_id
      : (techIdArg ? parseInt(techIdArg) : wo.assigned_technician_id);

    // Get tech info from database
    let techName = wo.technician?.tech_name || "";
    let maxTotal = wo.technician?.max_daily_appointments || 12;
    let maxRepairs = wo.technician?.max_daily_repairs || 6;

    if (techId && techId !== wo.assigned_technician_id) {
      const { data: tech } = await sb.from("technicians").select("tech_name, max_daily_appointments, max_daily_repairs").eq("id", techId).single();
      if (tech) {
        techName = tech.tech_name;
        maxTotal = tech.max_daily_appointments || 12;
        maxRepairs = tech.max_daily_repairs || 6;
      }
    }

    // ── Validation ──
    const chosenDateObj = new Date(chosenDate + "T12:00:00");
    const dow = chosenDateObj.getDay();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

    if (dow === 0 || dow === 6) {
      return wrapResponse(toolCallId, { success: false, error: "weekend", message: "We do not schedule on weekends. Please choose a weekday." });
    }

    if (chosenDate <= today) {
      return wrapResponse(toolCallId, { success: false, error: "sameday", message: "We cannot book same-day or past appointments. Please choose a future date." });
    }

    // Check holidays
    const { data: holidays } = await sb
      .from("tenant_holidays")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("holiday_date", chosenDate)
      .limit(1);

    if (holidays && holidays.length > 0) {
      return wrapResponse(toolCallId, { success: false, error: "holiday", message: "We are closed on that date. Please choose a different date." });
    }

    // Check days off
    const { data: daysOff } = await sb
      .from("days_off")
      .select("id")
      .eq("date_off", chosenDate)
      .or(`technician_id.eq.${techId},technician_id.is.null`)
      .eq("tenant_id", tenantId)
      .limit(1);

    if (daysOff && daysOff.length > 0) {
      return wrapResponse(toolCallId, { success: false, error: "dayoff", message: "The technician is not available on that date. Please choose a different date." });
    }

    // ── Capacity check ──
    // SOURCE OF TRUTH = actual scheduled appointments, NOT the
    // tech_daily_capacity counter. The counter has been observed to drift
    // out of sync (Kazi 2026-05-02 was booked into a 13th slot when Jessys
    // max=12), so we COUNT(*) at booking time to enforce the cap reliably.
    // The counter is still maintained below for legacy reads (e.g. dashboards)
    // but the gate decision uses real numbers only.
    const { data: capRow } = await sb
      .from("tech_daily_capacity")
      .select("*")
      .eq("technician_id", techId)
      .eq("date", chosenDate)
      .maybeSingle();

    const { count: actualTotal } = await sb
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("technician_id", techId)
      .eq("appointment_date", chosenDate)
      .eq("status", "scheduled");
    const totalBooked = actualTotal ?? 0;

    let repairsBooked = 0;
    if (isRepair) {
      const { count: actualRepairs } = await sb
        .from("appointments")
        .select("id, work_order:work_orders!inner(job_type)", { count: "exact", head: true })
        .eq("technician_id", techId)
        .eq("appointment_date", chosenDate)
        .eq("status", "scheduled")
        .eq("work_order.job_type", "Repair Follow-up");
      repairsBooked = actualRepairs ?? 0;
    }

    if (totalBooked >= maxTotal) {
      return wrapResponse(toolCallId, { success: false, error: "capacity_total", message: "The technician is fully booked on that date. Please choose a different date." });
    }

    if (isRepair && repairsBooked >= maxRepairs) {
      return wrapResponse(toolCallId, { success: false, error: "capacity_repairs", message: "No repair slots available on that date. Please choose a different date." });
    }

    // ── Get time window from service_zones table ──
    const { data: zones } = await sb
      .from("service_zones")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("is_active", true);

    let win: [string, string] | null = null;
    for (const zone of zones || []) {
      const zips = (zone.zip_codes || []).map((z: string) => z.trim());
      if (zips.includes(zip.trim())) {
        win = [zone.window_start, zone.window_end];
        break;
      }
    }

    if (!win) {
      return wrapResponse(toolCallId, { success: false, error: "outside_service_area", message: `ZIP code ${zip} is outside our service area.` });
    }

    const startTime = to24h(win[0]);
    const endTime = to24h(win[1]);

    // ── Cancel existing FUTURE appointments and clean up capacity ──
    // (don't retroactively cancel past appointments — they should be marked completed)
    const todayStr = new Date().toISOString().slice(0, 10);
    const { data: oldAppts } = await sb
      .from("appointments")
      .select("id, appointment_date, technician_id")
      .eq("work_order_id", wo.id)
      .eq("status", "scheduled")
      .gte("appointment_date", todayStr);

    for (const oldAppt of oldAppts || []) {
      const { data: oldCap } = await sb
        .from("tech_daily_capacity")
        .select("id, current_appointments, current_repairs")
        .eq("technician_id", oldAppt.technician_id)
        .eq("date", oldAppt.appointment_date)
        .single();

      if (oldCap) {
        const newCount = Math.max(0, (oldCap.current_appointments || 1) - 1);
        const newRepairsCount = isRepair ? Math.max(0, (oldCap.current_repairs || 1) - 1) : oldCap.current_repairs;
        if (newCount === 0) {
          await sb.from("tech_daily_capacity").delete().eq("id", oldCap.id);
        } else {
          await sb.from("tech_daily_capacity").update({ current_appointments: newCount, current_repairs: newRepairsCount }).eq("id", oldCap.id);
        }
      }

      await sb
        .from("appointments")
        .update({ status: "canceled" })
        .eq("id", oldAppt.id);
    }

    // ── Create appointment ──
    const { data: appt, error: apptErr } = await sb
      .from("appointments")
      .insert({
        tenant_id: tenantId,
        work_order_id: wo.id,
        technician_id: techId,
        appointment_date: chosenDate,
        start_time: startTime,
        end_time: endTime,
        status: "scheduled",
        created_by_source: source,
      })
      .select("id")
      .single();

    if (apptErr) {
      return wrapResponse(toolCallId, { success: false, error: apptErr.message });
    }

    // Update WO status
    await sb.from("work_orders").update({ status: "Scheduled", assigned_technician_id: techId, service_date: chosenDate }).eq("id", wo.id);

    // Update or create capacity
    if (capRow) {
      await sb.from("tech_daily_capacity").update({
        current_appointments: totalBooked + 1,
        current_repairs: isRepair ? repairsBooked + 1 : repairsBooked,
      }).eq("id", capRow.id);
    } else {
      await sb.from("tech_daily_capacity").insert({
        tenant_id: tenantId, technician_id: techId, date: chosenDate,
        max_appointments: maxTotal, max_repairs: maxRepairs,
        current_appointments: 1, current_repairs: isRepair ? 1 : 0,
      });
    }

    // Fire SMS notification and warranty sync WITHOUT blocking the response.
    // These are fire-and-forget — the booking is already saved in the DB,
    // so the customer gets a confirmed response from Vapi immediately.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://field-boss-pro.vercel.app";

    // Don't await — fire and forget
    fetch(`${appUrl}/api/notifications/status-change`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ work_order_id: wo.id, tenant_id: tenantId, old_status: wo.status, new_status: "Scheduled" }),
    }).catch(() => {});

    fetch(`${appUrl}/api/fahw/status-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        work_order_id: wo.id,
        tenant_id: tenantId,
        new_status: "Scheduled",
        old_status: wo.status,
        appointment_date: chosenDate,
        start_time: startTime,
        end_time: endTime,
      }),
    }).catch(() => {});

    // Format response
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const d = new Date(chosenDate + "T12:00:00");
    const dateDisplay = `${months[d.getMonth()]} ${d.getDate()}`;

    return wrapResponse(toolCallId, {
      success: true, appointment_id: appt.id, wo_number: workOrderNumber,
      date: chosenDate, date_display: dateDisplay,
      window: `${win[0]} - ${win[1]}`, window_start: win[0], window_end: win[1],
      tech_name: techName, status: "Booked",
    });
  } catch (error) {
    console.error("Book appointment error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

function wrapResponse(toolCallId: string, result: any) {
  if (toolCallId) {
    return NextResponse.json({ results: [{ toolCallId, result: JSON.stringify(result) }] });
  }
  return NextResponse.json(result);
}
