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
    [/\bfort\b/g, "ft"], [/\bmount\b/g, "mt"],
    [/\bparkway\b/g, "pkwy"], [/\bboulevard\b/g, "blvd"],
    [/\bdrive\b/g, "dr"], [/\bstreet\b/g, "st"],
    [/\bavenue\b/g, "ave"], [/\blane\b/g, "ln"],
    [/\broad\b/g, "rd"], [/\bcourt\b/g, "ct"],
    [/\bcircle\b/g, "cir"], [/\bplace\b/g, "pl"],
    [/\btrail\b/g, "trl"], [/\bhighway\b/g, "hwy"],
    [/\bnorth\b/g, "n"], [/\bsouth\b/g, "s"],
    [/\beast\b/g, "e"], [/\bwest\b/g, "w"],
  ];
  for (const [pattern, replacement] of abbrevs) {
    s = s.replace(pattern, replacement);
  }
  // Remove periods and extra spaces
  s = s.replace(/\./g, "").replace(/\s+/g, " ").trim();
  return s;
}

// Extract just the street number and key words for fuzzy matching
function getSearchTokens(addr: string): string[] {
  const normalized = normalizeAddress(addr);
  return normalized.split(" ").filter((t) => t.length > 1);
}

// Expand address for TTS (voice reads "Dr" as "Doctor")
function expandAddress(s: string): string {
  return s
    // Street suffixes (with and without periods)
    .replace(/\bDr\.?\b/gi, "Drive").replace(/\bSt\.?\b/gi, "Street")
    .replace(/\bBlvd\.?\b/gi, "Boulevard").replace(/\bAve\.?\b/gi, "Avenue")
    .replace(/\bLn\.?\b/gi, "Lane").replace(/\bRd\.?\b/gi, "Road")
    .replace(/\bCt\.?\b/gi, "Court").replace(/\bCir\.?\b/gi, "Circle")
    .replace(/\bPl\.?\b/gi, "Place").replace(/\bPkwy\.?\b/gi, "Parkway")
    .replace(/\bTrl\.?\b/gi, "Trail").replace(/\bHwy\.?\b/gi, "Highway")
    // Directionals
    .replace(/\bN\.?\b/g, "North").replace(/\bS\.?\b/g, "South")
    .replace(/\bE\.?\b/g, "East").replace(/\bW\.?\b/g, "West")
    // State abbreviations
    .replace(/\bTX\b/g, "Texas").replace(/\bCA\b/g, "California")
    .replace(/\bFL\b/g, "Florida").replace(/\bNY\b/g, "New York")
    .replace(/\bOK\b/g, "Oklahoma").replace(/\bAR\b/g, "Arkansas")
    .replace(/\bLA\b/g, "Louisiana").replace(/\bNM\b/g, "New Mexico")
    .replace(/\bCO\b/g, "Colorado").replace(/\bAZ\b/g, "Arizona")
    .replace(/\bGA\b/g, "Georgia").replace(/\bNC\b/g, "North Carolina")
    .replace(/\bSC\b/g, "South Carolina").replace(/\bTN\b/g, "Tennessee")
    .replace(/\bAL\b/g, "Alabama").replace(/\bMS\b/g, "Mississippi")
    .replace(/\bVA\b/g, "Virginia").replace(/\bOH\b/g, "Ohio")
    .replace(/\bPA\b/g, "Pennsylvania").replace(/\bIL\b/g, "Illinois")
    .replace(/\bMO\b/g, "Missouri").replace(/\bKS\b/g, "Kansas");
}

const STATUS_PRIORITY = ["Parts Have Arrived", "Parts Ordered", "New", "Scheduled"];

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();

    // Handle every Vapi tool-call payload shape we've seen in the wild.
    let args: any = raw;
    let toolCallId = "";
    const tc =
      raw.message?.toolCalls?.[0]
      || raw.message?.toolCallList?.[0]
      || raw.toolCalls?.[0]
      || raw.toolCallList?.[0]
      || raw.message?.toolCall
      || raw.toolCall
      || null;
    if (tc) {
      const a = tc.function?.arguments || tc.arguments || {};
      args = typeof a === "string" ? JSON.parse(a) : a;
      toolCallId = tc.id || tc.toolCallId || "";
    } else if (raw.message?.toolCallId || raw.toolCallId) {
      toolCallId = raw.message?.toolCallId || raw.toolCallId;
    }
    // If anything Vapi-shaped was in the body, we MUST return the wrapped
    // {results: [{toolCallId, result}]} envelope or Vapi rejects it as
    // "no result returned" (silent failure with the agent confidently
    // claiming success to the customer).
    const isVapi = Boolean(
      tc
      || raw.message
      || raw.call
      || raw.toolCallId
      || raw.assistantId
    );

    const address = (args.address || "").trim();
    const phone = (args.phone || "").replace(/\D/g, "");
    const name = (args.name || "").trim();
    let tenantId = args.tenant_id || args.tenantId;
    if (!tenantId) {
      // Vapi has shipped multiple payload shapes over time; check every
      // place the assistantId / phoneNumberId might land. Tom Nolen's
      // cancel test failed because the previous code only checked
      // raw.message?.call?.assistantId and Vapi's current payload puts
      // it elsewhere — leading to a "tenant could not be identified"
      // even though the assistant IS configured for tenant 1.
      const assistantId =
        raw.message?.call?.assistantId
        || raw.message?.call?.assistant?.id
        || raw.message?.assistant?.id
        || raw.message?.assistantId
        || raw.call?.assistantId
        || raw.call?.assistant?.id
        || raw.assistantId
        || raw.metadata?.assistantId;
      const phoneNumberId =
        raw.message?.call?.phoneNumberId
        || raw.message?.phoneNumberId
        || raw.message?.phoneNumber?.id
        || raw.call?.phoneNumberId
        || raw.phoneNumberId;

      if (assistantId || phoneNumberId) {
        const sb2 = supabaseAdmin();
        const { data: allVapi } = await sb2
          .from("tenant_integrations")
          .select("tenant_id, encrypted_keys")
          .eq("integration_type", "vapi")
          .eq("is_configured", true);
        // Try assistantId first (most specific), then phoneNumberId as fallback.
        const match = (allVapi || []).find((v: any) => {
          const keys = v.encrypted_keys || {};
          return (assistantId && keys.assistantId === assistantId)
              || (phoneNumberId && keys.phoneNumberId === phoneNumberId);
        });
        if (match) tenantId = match.tenant_id;
      }

      // Last resort: log everything we got so the next debug session is shorter.
      if (!tenantId) {
        console.error(
          `[customer-lookup] Could not resolve tenant. assistantId=${assistantId} phoneNumberId=${phoneNumberId} ` +
          `payload-keys=${Object.keys(raw).join(",")} message-keys=${Object.keys(raw.message || {}).join(",")} ` +
          `call-keys=${Object.keys(raw.message?.call || {}).join(",")}`
        );
      }
    }
    if (!tenantId) {
      return wrapResponse(toolCallId, isVapi, {
        found: false,
        message: "Internal configuration error: tenant could not be identified. Please contact support.",
      });
    }

    const sb = supabaseAdmin();

    let customer: any = null;

    // Search by address — try multiple approaches (filtered by tenant)
    if (address.length >= 3) {
      // 1. Try exact normalized match
      const normalized = normalizeAddress(address);
      const { data: exactMatch } = await sb
        .from("customers")
        .select("*")
        .eq("tenant_id", tenantId)
        .ilike("service_address", `%${normalized}%`)
        .limit(1);
      if (exactMatch?.length) customer = exactMatch[0];

      // 2. Try with original address
      if (!customer) {
        const { data: origMatch } = await sb
          .from("customers")
          .select("*")
          .eq("tenant_id", tenantId)
          .ilike("service_address", `%${address}%`)
          .limit(1);
        if (origMatch?.length) customer = origMatch[0];
      }

      // 3. Try matching just the street number + first keyword
      if (!customer) {
        const tokens = getSearchTokens(address);
        const streetNum = tokens.find((t) => /^\d+$/.test(t));
        const streetWord = tokens.find((t) => !/^\d+$/.test(t) && t !== "st" && t !== "dr" && t !== "ave" && t !== "blvd" && t !== "rd" && t !== "ln" && t !== "ct");
        if (streetNum && streetWord) {
          const { data: fuzzyMatch } = await sb
            .from("customers")
            .select("*")
            .eq("tenant_id", tenantId)
            .ilike("service_address", `%${streetNum}%${streetWord}%`)
            .limit(5);
          if (fuzzyMatch?.length) customer = fuzzyMatch[0];
        }
      }
    }

    // Fallback: search by phone — match against BOTH phone and phone2.
    // Only the LAST 10 (or last 7) digits are used, and we compare full
    // contiguous tail — not arbitrary substring. Last-4 ILIKE was previously
    // matching unrelated customers whose number happened to contain those
    // digits in the middle (e.g. last4=9972 hit 334-66997-29). Fixed.
    if (!customer && phone.length >= 7) {
      const last10 = phone.slice(-10);
      const last7 = phone.slice(-7);
      // Pull a small candidate set by last 7 (cheap pre-filter), then
      // verify the full tail in JS by stripping non-digits.
      const { data } = await sb
        .from("customers")
        .select("*")
        .eq("tenant_id", tenantId)
        .or(`phone.ilike.%${last7}%,phone2.ilike.%${last7}%`)
        .limit(10);

      const tailMatch = (val: string | null | undefined): boolean => {
        const d = (val || "").replace(/\D/g, "");
        if (!d) return false;
        if (last10.length === 10 && d.endsWith(last10)) return true;
        if (d.endsWith(last7) && phone.endsWith(d.slice(-7))) return true;
        return false;
      };

      const verified = (data || []).find((c: any) => tailMatch(c.phone) || tailMatch(c.phone2));
      if (verified) customer = verified;
    }

    // Fallback: maybe this number is an alt_contact on someone else's WO
    // (e.g., husband Scott replying to a handoff text we sent him on behalf
    // of his wife Lori). Look up by alt_contact_phone and route to that WO's
    // customer so the rest of the flow operates on the original WO.
    if (!customer && phone.length >= 7) {
      const last10 =
        phone.length === 10
          ? `+1${phone}`
          : phone.length === 11
          ? `+${phone}`
          : phone;
      const { data: altWos } = await sb
        .from("work_orders")
        .select("customer_id")
        .eq("tenant_id", tenantId)
        .eq("alt_contact_phone", last10)
        .order("created_at", { ascending: false })
        .limit(1);
      if (altWos?.length) {
        const { data: c } = await sb
          .from("customers")
          .select("*")
          .eq("id", altWos[0].customer_id)
          .single();
        if (c) customer = c;
      }
    }

    // Fallback: search by name
    if (!customer && name.length >= 2) {
      const { data } = await sb
        .from("customers")
        .select("*")
        .eq("tenant_id", tenantId)
        .ilike("customer_name", `%${name}%`)
        .limit(1);
      if (data?.length) customer = data[0];
    }

    if (!customer) {
      const result = {
        found: false,
        message: "I could not find an account for that address. Ask the customer: Do you have a work order number or a phone number on file? Try looking them up again with the phone number. Only create a new account after trying phone number and the customer confirms they are new.",
      };
      return wrapResponse(toolCallId, isVapi, result);
    }

    // Fetch work orders for this customer, ordered by status priority
    const { data: workOrders } = await sb
      .from("work_orders")
      .select(`
        *,
        technician:technicians!assigned_technician_id(tech_name),
        appointments(id, appointment_date, start_time, end_time, status)
      `)
      .eq("customer_id", customer.id)
      .eq("tenant_id", customer.tenant_id)
      .not("status", "in", '("Complete","Canceled","canceled")')
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
        // Parse as UTC noon so day-of-week is deterministic regardless of server TZ
        const d = new Date(appt.appointment_date + "T12:00:00Z");
        const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
        // Use UTC getters since we parsed as UTC noon
        const dateDisplay = `${dayNames[d.getUTCDay()]}, ${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
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

    return wrapResponse(toolCallId, isVapi, result);
  } catch (error) {
    console.error("Customer lookup error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// Vapi expects: { results: [{ toolCallId, result: "<JSON-stringified payload>" }] }
// — even when toolCallId is empty. Returning a bare body causes Vapi to
// report "no result returned" and the agent confidently lies to the
// customer that the action succeeded. Always wrap if Vapi is the caller.
function wrapResponse(toolCallId: string, isVapi: boolean, result: any) {
  if (isVapi) {
    return NextResponse.json({
      results: [{ toolCallId, result: JSON.stringify(result) }],
    });
  }
  return NextResponse.json(result);
}
