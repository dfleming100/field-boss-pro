import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/vapi/get-available-slots
 * Returns available appointment slots for a work order.
 * Reads ZIP windows, tech skills, and capacity from database (per-tenant).
 */

function dateStr(d: Date): string {
  return d.toISOString().split("T")[0];
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
      return wrapResponse(toolCallId, {
        error: "Work order not found",
        agent_summary: "I was not able to find that work order. Let me have a team member call you back.",
        available_dates: [], tech_id: "", tech_name: "", wo_number: "",
        window_start: "", window_end: "", slot_count: 0,
      });
    }

    const tenantId = wo.tenant_id;
    const jobType = wo.job_type || "";
    const applianceType = wo.appliance_type || "";
    const zip = wo.customer?.zip || "";
    const assignedTechName = wo.technician?.tech_name || "";
    const assignedTechId = wo.assigned_technician_id;
    const isRepair = jobType === "Repair Follow-up";

    // ── Get time window from service_zones table ──
    const { data: zones } = await sb
      .from("service_zones")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("is_active", true);

    let win: [string, string] = ["9:00am", "12:00pm"]; // default
    for (const zone of zones || []) {
      if (zone.zip_codes && zone.zip_codes.includes(zip)) {
        win = [zone.window_start, zone.window_end];
        break;
      }
    }

    // ── Get tech skills from database ──
    const { data: skillRows } = await sb
      .from("tech_skills")
      .select("technician_id, appliance_type, priority")
      .eq("tenant_id", tenantId);

    // ── Get all active technicians with capacity ──
    const { data: allTechs } = await sb
      .from("technicians")
      .select("id, tech_name, max_daily_appointments, max_daily_repairs")
      .eq("tenant_id", tenantId)
      .eq("is_active", true);

    // Build tech lookup
    const techLookup: Record<number, { id: number; name: string; maxTotal: number; maxRepairs: number }> = {};
    for (const t of allTechs || []) {
      techLookup[t.id] = {
        id: t.id,
        name: t.tech_name,
        maxTotal: t.max_daily_appointments || 12,
        maxRepairs: t.max_daily_repairs || 6,
      };
    }

    // ── Determine which techs to check ──
    let techsToCheck: number[] = [];

    if (isRepair && assignedTechId) {
      // Repair follow-up: same tech
      techsToCheck = [assignedTechId];
    } else if (applianceType && skillRows && skillRows.length > 0) {
      // Find techs with skills matching this appliance, sorted by priority
      const matching = skillRows
        .filter((s) => s.appliance_type === applianceType)
        .sort((a, b) => a.priority - b.priority);

      if (matching.length > 0) {
        techsToCheck = matching.map((s) => s.technician_id);
      } else {
        // No skill match — use all techs
        techsToCheck = (allTechs || []).map((t) => t.id);
      }
    } else {
      // No skills configured — use all techs
      techsToCheck = (allTechs || []).map((t) => t.id);
    }

    // ── Get this WO's current appointment dates (to exclude) ──
    const { data: currentAppts } = await sb
      .from("appointments")
      .select("appointment_date")
      .eq("work_order_id", wo.id)
      .eq("status", "scheduled");
    const currentApptDates = new Set((currentAppts || []).map((a: any) => a.appointment_date));

    // ── Fetch tech capacity for next 30 days ──
    const { data: capacityRows } = await sb
      .from("tech_daily_capacity")
      .select("*")
      .eq("tenant_id", tenantId)
      .gte("date", dateStr(new Date()));

    const capMap: Record<string, { total: number; repairs: number }> = {};
    for (const row of capacityRows || []) {
      capMap[`${row.technician_id}-${row.date}`] = {
        total: row.current_appointments || 0,
        repairs: row.current_repairs || 0,
      };
    }

    // ── Fetch days off + holidays ──
    const { data: daysOffRows } = await sb
      .from("days_off")
      .select("technician_id, date_off")
      .eq("tenant_id", tenantId)
      .gte("date_off", dateStr(new Date()));

    const { data: holidays } = await sb
      .from("tenant_holidays")
      .select("holiday_date")
      .eq("tenant_id", tenantId)
      .gte("holiday_date", dateStr(new Date()));

    const daysOffSet = new Set<string>();
    for (const row of daysOffRows || []) {
      daysOffSet.add(`${row.technician_id}-${row.date_off}`);
    }
    const holidaySet = new Set((holidays || []).map((h: any) => h.holiday_date));

    // ── Scan next 20 business days ──
    const available: { date: string; tech_name: string; tech_id: number }[] = [];
    const today = new Date();
    let d = new Date(today);
    let bizDays = 0;

    while (bizDays < 20) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue; // skip weekends
      bizDays++;

      const ds = dateStr(d);

      // Skip holidays
      if (holidaySet.has(ds)) continue;

      // Skip dates where this WO already has an appointment
      if (currentApptDates.has(ds)) continue;

      for (const techId of techsToCheck) {
        const tech = techLookup[techId];
        if (!tech) continue;

        // Check days off
        if (daysOffSet.has(`${techId}-${ds}`)) continue;

        // Check capacity
        const cap = capMap[`${techId}-${ds}`];
        const totalBooked = cap?.total || 0;
        const repairsBooked = cap?.repairs || 0;

        if (totalBooked >= tech.maxTotal) continue;
        if (isRepair && repairsBooked >= tech.maxRepairs) continue;

        available.push({ date: ds, tech_name: tech.name, tech_id: tech.id });
        break; // first available tech for this date wins
      }
    }

    // ── Build agent summary ──
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const fmtDate = (ds: string): string => {
      const dt = new Date(ds + "T12:00:00");
      return `${dayNames[dt.getDay()]}, ${months[dt.getMonth()]} ${dt.getDate()}`;
    };

    let agentSummary: string;
    if (available.length === 0) {
      agentSummary = `I am sorry, we do not have any availability for your ${applianceType || "appliance"} service in the next 20 business days. I will have a team member reach out to you.`;
    } else {
      const first3 = available.slice(0, 3).map((a) => fmtDate(a.date));
      agentSummary = `Your ${applianceType || "appliance"} appointment is available from ${win[0]} to ${win[1]}. The earliest date is ${first3[0]}.`;
      if (first3.length > 1) {
        agentSummary += ` Other options include ${first3.slice(1).join(" and ")}.`;
      }
      agentSummary += " Which date works best for you?";
    }

    const primarySlot = available[0];
    const result = {
      agent_summary: agentSummary,
      available_dates: available.map((a) => a.date),
      tech_id: primarySlot ? String(primarySlot.tech_id) : "",
      tech_name: primarySlot ? primarySlot.tech_name : "",
      wo_number: workOrderNumber,
      window_start: win[0],
      window_end: win[1],
      slot_count: available.length,
    };

    return wrapResponse(toolCallId, result);
  } catch (error) {
    console.error("Get available slots error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

function wrapResponse(toolCallId: string, result: any) {
  if (toolCallId) {
    return NextResponse.json({ results: [{ toolCallId, result: JSON.stringify(result) }] });
  }
  return NextResponse.json(result);
}
