import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/vapi/get-available-slots
 * Returns available appointment slots for a work order.
 * Reads ZIP windows, tech skills, and capacity from database (per-tenant).
 */

// Get date string in Central Time (handles CDT/CST automatically)
function dateStr(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

// Get "today" in Central Time
function todayCT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
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

    // Try to get WO number from tool args first. If blank, fall back to
    // Vapi call metadata/variableValues (the assistant may omit the arg
    // on outbound calls where the WO number was prefilled).
    let workOrderNumber = (args.work_order_number || args.workOrderNumber || "").trim();
    if (!workOrderNumber) {
      const meta = raw.message?.call?.assistantOverrides?.metadata
        || raw.message?.call?.metadata || {};
      const vars = raw.message?.call?.assistantOverrides?.variableValues || {};
      workOrderNumber = (meta.work_order_number || vars.work_order_number || "").trim();
    }
    const sb = supabaseAdmin();

    // Build lookup candidates — the LLM may pass "1005", "WO-1005", or even "wo 1005".
    // Try the exact value first, then try with/without the "WO-" prefix as fallbacks.
    const digitsOnly = workOrderNumber.replace(/\D/g, "");
    const candidates = [
      workOrderNumber,
      `WO-${digitsOnly}`,
      digitsOnly,
    ].filter((v, i, arr) => v && arr.indexOf(v) === i);

    // Find work order (try each candidate until a match is found)
    let wo: any = null;
    for (const candidate of candidates) {
      const { data } = await sb
        .from("work_orders")
        .select(`
          *,
          customer:customers(zip),
          technician:technicians!assigned_technician_id(id, tech_name)
        `)
        .eq("work_order_number", candidate)
        .limit(1)
        .maybeSingle();
      if (data) { wo = data; break; }
    }

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

    let win: [string, string] | null = null;
    console.log(`[SLOTS] tenant=${tenantId}, zip="${zip}", zones found=${(zones || []).length}`);
    for (const zone of zones || []) {
      const zips = (zone.zip_codes || []).map((z: string) => z.trim());
      console.log(`[SLOTS] zone=${zone.zone_name}, zips=${JSON.stringify(zips)}, checking "${zip.trim()}", match=${zips.includes(zip.trim())}`);
      if (zips.includes(zip.trim())) {
        win = [zone.window_start, zone.window_end];
        break;
      }
    }

    if (!win) {
      console.log(`[SLOTS] No zone match for zip "${zip}" in tenant ${tenantId}`);
      return wrapResponse(toolCallId, {
        agent_summary: `I am sorry, ZIP code ${zip || "unknown"} is outside our service area. Please call us at the office to see if we can help.`,
        available_dates: [], tech_id: "", tech_name: "", wo_number: workOrderNumber,
        window_start: "", window_end: "", slot_count: 0,
      });
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
      // Multi-appliance routing: split the comma-separated appliance string,
      // find which techs can handle EACH appliance, then intersect (the chosen
      // tech must be able to service all appliances on the WO). Sort by SUM
      // of priorities so a tech who is "primary" (priority 1) on every appliance
      // wins over a tech who is "secondary" (priority 2) on some.
      //
      // Example: WO has "Cooktop, Dishwasher".
      //   - Jessy: cooktop=1, dishwasher=2 → can do both, priority sum=3
      //   - Darryl: dishwasher=1 (no cooktop) → can't do cooktop, excluded
      //   → Jessy wins.
      const appliancesOnWo: string[] = applianceType.split(",").map((a: string) => a.trim()).filter(Boolean);

      // For each appliance, find techs whose skill matches it (using the
      // existing keyword match so "Built In Microwave" → "Microwave",
      // "Glass Cooktop" → "Cooktop", etc.).
      const matchSkill = (skillLower: string, appLower: string): boolean => {
        if (!skillLower || !appLower) return false;
        if (appLower === skillLower) return true;
        if (appLower.endsWith(" " + skillLower)) return true;
        if (skillLower.startsWith(appLower + ":") || appLower.startsWith(skillLower + ":")) return true;
        return false;
      };

      // Map of techId → array of priorities (one per matched appliance on the WO).
      // Only techs who match ALL appliances are kept.
      const techPrioritiesPerAppliance: Record<number, number[]> = {};
      let allAppliancesMatched = true;
      for (const wAppl of appliancesOnWo) {
        const wLower = wAppl.toLowerCase();
        const matchingForThis = skillRows.filter((s) => matchSkill((s.appliance_type || "").toLowerCase().trim(), wLower));
        if (matchingForThis.length === 0) {
          allAppliancesMatched = false;
          console.log(`[SLOTS] No tech has skill for "${wAppl}" on WO ${workOrderNumber}`);
          break;
        }
        const techsForThis = new Set(matchingForThis.map((s) => s.technician_id));
        // First appliance: seed the map. Later appliances: intersect.
        if (Object.keys(techPrioritiesPerAppliance).length === 0) {
          for (const s of matchingForThis) {
            if (!techPrioritiesPerAppliance[s.technician_id]) techPrioritiesPerAppliance[s.technician_id] = [];
            techPrioritiesPerAppliance[s.technician_id].push(s.priority);
          }
        } else {
          // Drop techs who don't have skill for this appliance
          for (const techId of Object.keys(techPrioritiesPerAppliance).map(Number)) {
            if (!techsForThis.has(techId)) {
              delete techPrioritiesPerAppliance[techId];
            } else {
              const skillForThis = matchingForThis.find((s) => s.technician_id === techId);
              if (skillForThis) techPrioritiesPerAppliance[techId].push(skillForThis.priority);
            }
          }
        }
      }

      const eligibleTechs = Object.keys(techPrioritiesPerAppliance).map(Number);

      if (!allAppliancesMatched || eligibleTechs.length === 0) {
        // No single tech can do all the appliances on this WO. Block scheduling.
        console.log(`[SLOTS] No tech covers all appliances "${applianceType}" — escalating`);
        return wrapResponse(toolCallId, {
          agent_summary: `I am sorry, we do not currently have a technician available to service all the items on this work order (${applianceType}). Please contact our office so we can split the job or escalate.`,
          available_dates: [], tech_id: "", tech_name: "", wo_number: workOrderNumber,
          window_start: "", window_end: "", slot_count: 0,
        });
      }

      // Sort by sum of priorities (lower = better). Tie-break by min priority.
      techsToCheck = eligibleTechs.sort((a, b) => {
        const sumA = techPrioritiesPerAppliance[a].reduce((x, y) => x + y, 0);
        const sumB = techPrioritiesPerAppliance[b].reduce((x, y) => x + y, 0);
        if (sumA !== sumB) return sumA - sumB;
        return Math.min(...techPrioritiesPerAppliance[a]) - Math.min(...techPrioritiesPerAppliance[b]);
      });
      console.log(`[SLOTS] Multi-appliance "${applianceType}" eligible techs (best first):`, techsToCheck);
    } else {
      // No skills configured for tenant at all — fall back to all techs
      techsToCheck = (allTechs || []).map((t) => t.id);
    }

    // ── Get this WO's current appointment dates (to exclude) ──
    const { data: currentAppts } = await sb
      .from("appointments")
      .select("appointment_date")
      .eq("work_order_id", wo.id)
      .eq("status", "scheduled");
    const currentApptDates = new Set((currentAppts || []).map((a: any) => a.appointment_date));

    // ── Compute REAL capacity from actual appointments (not the counter) ──
    // The tech_daily_capacity counter has been observed to drift out of sync,
    // which let us double-book. Source of truth = COUNT(*) on appointments.
    const { data: futureAppts } = await sb
      .from("appointments")
      .select("technician_id, appointment_date, work_order:work_orders!inner(job_type)")
      .eq("tenant_id", tenantId)
      .eq("status", "scheduled")
      .gte("appointment_date", todayCT());

    const capMap: Record<string, { total: number; repairs: number }> = {};
    for (const a of (futureAppts as any[]) || []) {
      const key = `${a.technician_id}-${a.appointment_date}`;
      if (!capMap[key]) capMap[key] = { total: 0, repairs: 0 };
      capMap[key].total += 1;
      const wo = Array.isArray(a.work_order) ? a.work_order[0] : a.work_order;
      if (wo?.job_type === "Repair Follow-up") capMap[key].repairs += 1;
    }

    // ── Fetch days off + holidays ──
    const { data: daysOffRows } = await sb
      .from("days_off")
      .select("technician_id, date_off")
      .eq("tenant_id", tenantId)
      .gte("date_off", todayCT());

    const { data: holidays } = await sb
      .from("tenant_holidays")
      .select("holiday_date")
      .eq("tenant_id", tenantId)
      .gte("holiday_date", todayCT());

    const daysOffSet = new Set<string>();
    const companyDaysOff = new Set<string>();
    for (const row of daysOffRows || []) {
      if (row.technician_id) {
        daysOffSet.add(`${row.technician_id}-${row.date_off}`);
      } else {
        companyDaysOff.add(row.date_off);
      }
    }
    const holidaySet = new Set((holidays || []).map((h: any) => h.holiday_date));

    // ── Scan next 20 business days (starting from tomorrow in CT) ──
    const available: { date: string; tech_name: string; tech_id: number }[] = [];
    const todayStr = todayCT();
    // Start scanning from tomorrow CT
    let d = new Date(todayStr + "T12:00:00");
    let bizDays = 0;

    while (bizDays < 20) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue; // skip weekends
      bizDays++;

      const ds = dateStr(d);

      // Skip holidays
      if (holidaySet.has(ds)) continue;

      // Skip company-wide days off
      if (companyDaysOff.has(ds)) continue;

      // Skip dates where this WO already has an appointment
      if (currentApptDates.has(ds)) continue;

      for (const techId of techsToCheck) {
        const tech = techLookup[techId];
        if (!tech) continue;

        // Check individual tech days off
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
      // Parse as UTC noon so day-of-week is server-TZ-independent
      const dt = new Date(ds + "T12:00:00Z");
      return `${dayNames[dt.getUTCDay()]}, ${months[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
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
