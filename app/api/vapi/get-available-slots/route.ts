import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/vapi/get-available-slots
 * Vapi custom tool — returns available appointment slots for a work order.
 * Replicates FA - Get Available Slots n8n workflow logic.
 */

// ZIP → time window mapping (DFW area routing)
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

// Tech profiles
const TECHS: Record<string, { maxTotal: number; maxRepairs: number }> = {
  Darryl: { maxTotal: 8, maxRepairs: 4 },
  Jessy: { maxTotal: 12, maxRepairs: 6 },
};

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
      const result = {
        error: "Work order not found",
        agent_summary: "I was not able to find that work order. Let me have a team member call you back.",
        available_dates: [], tech_id: "", tech_name: "", wo_number: "",
        window_start: "", window_end: "", slot_count: 0,
      };
      return wrapResponse(toolCallId, result);
    }

    const jobType = wo.job_type || "";
    const applianceType = wo.appliance_type || "";
    const zip = wo.customer?.zip || "";
    const assignedTechName = wo.technician?.tech_name || "";
    const assignedTechId = wo.assigned_technician_id;
    const isRepair = jobType === "Repair Follow-up";

    // Tech assignment logic (matches n8n workflow)
    let useTech: string;
    if (isRepair) {
      useTech = assignedTechName || "Darryl";
    } else if (applianceType.includes("Cooktop") || applianceType.includes("Microwave")) {
      useTech = "Jessy";
    } else if (applianceType.includes("Dishwasher") || applianceType.includes("Dryer")) {
      useTech = "Darryl";
    } else {
      useTech = "EITHER";
    }

    // Get time window from ZIP
    const win = ZIP_WINDOWS[zip] || ["9:00am", "12:00pm"];

    // Fetch tech capacity for next 30 days
    const { data: capacityRows } = await sb
      .from("tech_daily_capacity")
      .select("*")
      .gte("date", dateStr(new Date()));

    const capMap: Record<string, { total: number; repairs: number; maxTotal: number; maxRepairs: number }> = {};
    for (const row of capacityRows || []) {
      // Build key: "TechName-YYYY-MM-DD" (we'll look up tech name)
      capMap[`${row.technician_id}-${row.date}`] = {
        total: row.current_appointments || 0,
        repairs: row.current_repairs || 0,
        maxTotal: row.max_appointments || 12,
        maxRepairs: row.max_repairs || 6,
      };
    }

    // Fetch days off
    const { data: daysOffRows } = await sb
      .from("days_off")
      .select("technician_id, date_off, reason")
      .gte("date_off", dateStr(new Date()));

    const daysOffSet = new Set<string>();
    for (const row of daysOffRows || []) {
      daysOffSet.add(`${row.technician_id}-${row.date_off}`);
      if (!row.technician_id) daysOffSet.add(`all-${row.date_off}`);
    }

    // Fetch technician IDs
    const { data: allTechs } = await sb
      .from("technicians")
      .select("id, tech_name")
      .eq("tenant_id", wo.tenant_id)
      .eq("is_active", true);

    const techLookup: Record<string, { id: number; name: string }> = {};
    for (const t of allTechs || []) {
      techLookup[t.tech_name] = { id: t.id, name: t.tech_name };
    }

    // Determine which techs to check
    const techsToCheck = useTech === "EITHER"
      ? ["Darryl", "Jessy"]
      : [useTech];

    // Scan next 20 business days
    const available: { date: string; tech_name: string; tech_id: number }[] = [];
    const today = new Date();
    let d = new Date(today);
    let bizDays = 0;

    while (bizDays < 20) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      bizDays++;

      const ds = dateStr(d);

      for (const techName of techsToCheck) {
        const tech = techLookup[techName];
        if (!tech) continue;
        const profile = TECHS[techName] || { maxTotal: 12, maxRepairs: 6 };

        // Check days off
        if (daysOffSet.has(`${tech.id}-${ds}`) || daysOffSet.has(`all-${ds}`)) continue;

        // Check capacity
        const cap = capMap[`${tech.id}-${ds}`];
        const maxTotal = cap?.maxTotal || profile.maxTotal;
        const maxRepairs = cap?.maxRepairs || profile.maxRepairs;
        const totalBooked = cap?.total || 0;
        const repairsBooked = cap?.repairs || 0;

        if (totalBooked >= maxTotal) continue;
        if (isRepair && repairsBooked >= maxRepairs) continue;

        available.push({ date: ds, tech_name: techName, tech_id: tech.id });
        break; // first available tech for this date wins
      }
    }

    // Build agent summary
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    function fmtDate(ds: string): string {
      const dt = new Date(ds + "T12:00:00");
      return `${dayNames[dt.getDay()]}, ${months[dt.getMonth()]} ${dt.getDate()}`;
    }

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
    return NextResponse.json({
      results: [{ toolCallId, result: JSON.stringify(result) }],
    });
  }
  return NextResponse.json(result);
}
