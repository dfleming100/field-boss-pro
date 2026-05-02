import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/cron/daily-outreach
 * Runs 6 times daily — sends SMS AND makes Vapi call for each eligible WO.
 *
 * Schedule (CT): 8am, 11am, 2pm, 4pm, 6pm, 8pm
 *
 * Rules:
 * - WOs with status "New" or "Parts Have Arrived"
 * - 5 day max from first outreach, then stops
 * - No gap between attempts — every cron window fires
 * - Skip if WO already has a scheduled appointment
 * - No contact before 8am or after 8:30pm CT
 * - Each attempt = 1 SMS + 1 Vapi call
 * - Runs 7 days a week
 * - Plus immediate fire on status change (separate handler)
 */

// Format a phone stored as raw digits or mixed into (xxx) xxx-xxxx for
// customer-facing SMS. Leaves non-10-digit values untouched.
function formatPhoneForDisplay(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

// Expand street and state abbreviations for TTS
function expandAddressForTTS(s: string): string {
  return s
    .replace(/\bDr\.?\b/gi, "Drive")
    .replace(/\bSt\.?\b/gi, "Street")
    .replace(/\bBlvd\.?\b/gi, "Boulevard")
    .replace(/\bAve\.?\b/gi, "Avenue")
    .replace(/\bLn\.?\b/gi, "Lane")
    .replace(/\bRd\.?\b/gi, "Road")
    .replace(/\bCt\.?\b/gi, "Court")
    .replace(/\bCir\.?\b/gi, "Circle")
    .replace(/\bPl\.?\b/gi, "Place")
    .replace(/\bPkwy\.?\b/gi, "Parkway")
    .replace(/\bTrl\.?\b/gi, "Trail")
    .replace(/\bHwy\.?\b/gi, "Highway")
    .replace(/\bN\.?\b/g, "North")
    .replace(/\bS\.?\b/g, "South")
    .replace(/\bE\.?\b/g, "East")
    .replace(/\bW\.?\b/g, "West")
    .replace(/\bTX\b/g, "Texas")
    .replace(/\bCA\b/g, "California")
    .replace(/\bFL\b/g, "Florida")
    .replace(/\bNY\b/g, "New York")
    .replace(/\bOK\b/g, "Oklahoma")
    .replace(/\bAR\b/g, "Arkansas")
    .replace(/\bLA\b/g, "Louisiana")
    .replace(/\bNM\b/g, "New Mexico")
    .replace(/\bCO\b/g, "Colorado")
    .replace(/\bAZ\b/g, "Arizona")
    .replace(/\bGA\b/g, "Georgia")
    .replace(/\bNC\b/g, "North Carolina")
    .replace(/\bSC\b/g, "South Carolina")
    .replace(/\bTN\b/g, "Tennessee")
    .replace(/\bAL\b/g, "Alabama")
    .replace(/\bMS\b/g, "Mississippi")
    .replace(/\bVA\b/g, "Virginia")
    .replace(/\bOH\b/g, "Ohio")
    .replace(/\bPA\b/g, "Pennsylvania")
    .replace(/\bIL\b/g, "Illinois")
    .replace(/\bMO\b/g, "Missouri")
    .replace(/\bKS\b/g, "Kansas");
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sb = supabaseAdmin();

    // Business hours check: 8am - 8:30pm CT
    const ctHour = parseInt(new Date().toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }));
    const ctMin = parseInt(new Date().toLocaleString("en-US", { timeZone: "America/Chicago", minute: "numeric" }));
    if (ctHour < 8 || (ctHour === 20 && ctMin >= 30) || ctHour > 20) {
      return NextResponse.json({ skipped: true, reason: "Outside business hours (8am-8:30pm CT)" });
    }

    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();

    // Fetch eligible work orders from ALL tenants
    const { data: workOrders } = await sb
      .from("work_orders")
      .select(`
        id, tenant_id, work_order_number, status, job_type, appliance_type,
        outreach_count, last_outreach_date, first_outreach_date,
        customer:customers(customer_name, phone, phone2, service_address, city, state, zip)
      `)
      .in("status", ["New", "Parts Have Arrived"])
      .order("created_at", { ascending: true })
      .limit(50);

    // Cache Vapi credentials PER TENANT so each tenant uses their own assistant
    const vapiCache: Record<number, { apiKey: string; assistantId: string; phoneNumberId?: string } | null> = {};

    const getVapiForTenant = async (tenantId: number) => {
      if (vapiCache[tenantId] !== undefined) return vapiCache[tenantId];
      const { data: vapiInt } = await sb
        .from("tenant_integrations")
        .select("encrypted_keys")
        .eq("tenant_id", tenantId)
        .eq("integration_type", "vapi")
        .eq("is_configured", true)
        .maybeSingle();
      const keys = (vapiInt?.encrypted_keys as any) || {};
      vapiCache[tenantId] = (keys.apiKey && keys.assistantId) ? keys : null;
      return vapiCache[tenantId];
    };

    const results: any[] = [];

    for (const wo of workOrders || []) {
      const customer = wo.customer as any;
      // For SMS we prefer phone2 (text-capable line, populated by AHS phones[1]
      // and FAHW claimantTextPhoneNum) and fall back to phone. Mutate the
      // customer object so the rest of this loop transparently uses the SMS
      // number wherever it reads customer.phone.
      const smsPhone = customer?.phone2 || customer?.phone;
      if (!smsPhone) continue;
      customer.phone = smsPhone;

      // Stop after 5 days from first outreach
      if (wo.first_outreach_date && new Date(wo.first_outreach_date) < new Date(fiveDaysAgo)) {
        continue;
      }

      // Skip if WO already has a scheduled appointment
      const { count } = await sb
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("work_order_id", wo.id)
        .eq("status", "scheduled");

      if ((count || 0) > 0) continue;

      // Fetch tenant branding for SMS/Vapi copy
      const { data: tenantRow } = await sb
        .from("tenants")
        .select("name, contact_phone")
        .eq("id", wo.tenant_id)
        .maybeSingle();
      const tenantName = tenantRow?.name || "your service provider";
      const tenantPhone = formatPhoneForDisplay(tenantRow?.contact_phone || "");

      // Get Twilio creds (optional — if missing, SMS is skipped but Vapi
      // call below still fires independently)
      const { data: integration } = await sb
        .from("tenant_integrations")
        .select("encrypted_keys")
        .eq("tenant_id", wo.tenant_id)
        .eq("integration_type", "twilio")
        .eq("is_configured", true)
        .maybeSingle();

      const creds = (integration?.encrypted_keys as any) || {};
      const twilioReady = !!(creds.accountSid && creds.authToken && creds.phoneNumber);
      // Use Twilio number for customer-facing SMS, not the office contact phone
      const twilioNum = formatPhoneForDisplay(creds.phoneNumber || "");
      const callbackSuffix = twilioNum ? ` or call ${twilioNum}` : (tenantPhone ? ` or call ${tenantPhone}` : "");

      const firstName = customer.customer_name?.split(" ")[0] || "there";
      const appliance = wo.appliance_type || "appliance";
      const woNum = wo.work_order_number || "";
      const rawAddress = [customer.service_address, customer.city, customer.state].filter(Boolean).join(", ");
      const address = expandAddressForTTS(rawAddress);
      const phoneDigits = customer.phone.replace(/\D/g, "");
      const toPhone = phoneDigits.length === 10 ? `+1${phoneDigits}` : `+${phoneDigits}`;

      const result: any = { wo_id: wo.id, wo_number: woNum, to: toPhone, sms: false, vapi: false };

      // ── 1. Send SMS (if Twilio is configured) ──
      if (twilioReady) {
        let smsBody: string;
        if (wo.status === "Parts Have Arrived") {
          smsBody = `Hi ${firstName}, this is ${tenantName}. Your ${appliance} parts are in (WO #${woNum}). Reply${callbackSuffix} to schedule your repair.`;
        } else if ((wo.outreach_count || 0) > 0) {
          smsBody = `Hi ${firstName}, this is ${tenantName} following up on your ${appliance} service (WO #${woNum}). Reply${callbackSuffix} to schedule.`;
        } else {
          smsBody = `Hi ${firstName}, this is ${tenantName}. We are ready to schedule your ${appliance} service (WO #${woNum}). Reply${callbackSuffix}.`;
        }

        const basicAuth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
        const smsRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`,
          {
            method: "POST",
            headers: { Authorization: `Basic ${basicAuth}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ From: creds.phoneNumber, To: toPhone, Body: smsBody }),
          }
        );
        result.sms = smsRes.ok;

        // Store SMS in conversation history
        await sb.from("sms_conversations").insert({ tenant_id: wo.tenant_id, phone: toPhone, direction: "outbound", body: smsBody });
        await sb.from("sms_logs").insert({ tenant_id: wo.tenant_id, recipient_phone: toPhone, message_type: "daily_outreach", status: smsRes.ok ? "sent" : "failed" });
      }

      // ── 2. Make Vapi Call (using THIS tenant's Vapi credentials) ──
      const vapiKeys = await getVapiForTenant(wo.tenant_id);
      if (vapiKeys) {
        try {
          const vapiFirstMessage = wo.status === "Parts Have Arrived"
            ? `Hi {{customer_name}}, this is {{tenant_name}} calling about your {{appliance_type}} repair at {{service_address}}. Your parts have arrived and we would like to schedule your repair follow-up appointment. Do you have a moment to pick a date?`
            : `Hi {{customer_name}}, this is {{tenant_name}} calling about your {{appliance_type}} service at {{service_address}}. We would like to schedule your appointment. Do you have a moment to pick a date?`;

          const vapiRes = await fetch("https://api.vapi.ai/call", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${vapiKeys.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              assistantId: vapiKeys.assistantId,
              customer: { number: toPhone, name: customer.customer_name },
              phoneNumberId: vapiKeys.phoneNumberId || undefined,
              assistantOverrides: {
                firstMessage: vapiFirstMessage,
                variableValues: {
                  tenant_name: tenantName,
                  customer_name: customer.customer_name || "",
                  service_address: address || "",
                  work_order_number: woNum || "",
                  appliance_type: appliance || "",
                  status: wo.status,
                  job_type: wo.job_type || "",
                },
                metadata: {
                  tenant_name: tenantName,
                  customer_name: customer.customer_name,
                  service_address: address,
                  work_order_number: woNum,
                  appliance_type: appliance,
                  status: wo.status,
                  job_type: wo.job_type,
                  outbound: true,
                },
              },
            }),
          });

          const vapiData = await vapiRes.json();
          result.vapi = vapiRes.ok;
          result.call_id = vapiData.id;

          await sb.from("sms_logs").insert({
            tenant_id: wo.tenant_id, recipient_phone: toPhone,
            message_type: "vapi_outreach", status: vapiRes.ok ? "sent" : "failed",
            twilio_message_id: vapiData.id || null,
          });
        } catch (err) {
          result.vapi_error = (err as Error).message;
        }
      }

      // ── 3. Send Email via Resend ──
      const customerEmail = customer?.email;
      const resendKey = process.env.RESEND_API_KEY || "";
      const twilioPhone = formatPhoneForDisplay(creds.phoneNumber || "");
      if (customerEmail && resendKey) {
        let emailBody: string;
        if (wo.status === "Parts Have Arrived") {
          emailBody = `Hi ${firstName}, this is ${tenantName}. Your ${appliance} parts have arrived (WO #${woNum}). You can call or text ${twilioPhone || tenantPhone || "us"} to schedule your repair using our AI automated assistant.`;
        } else {
          emailBody = `Hi ${firstName}, this is ${tenantName}. We are ready to schedule your ${appliance} service (WO #${woNum}). You can call or text ${twilioPhone || tenantPhone || "us"} to book an appointment using our AI automated assistant.`;
        }

        try {
          const emailRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: `${tenantName} <noreply@fieldbosspro.com>`,
              to: customerEmail,
              subject: `${tenantName} — Your ${appliance} Service`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
                  <h2 style="color: #1e293b;">${tenantName}</h2>
                  <p>${emailBody}</p>
                  <p style="color: #64748b; font-size: 12px; margin-top: 24px;">${tenantName}${twilioPhone ? ` | ${twilioPhone}` : ""}</p>
                </div>
              `,
            }),
          });
          result.email = emailRes.ok;
        } catch {
          result.email = false;
        }
      }

      // Update outreach count
      await sb.from("work_orders").update({ outreach_count: (wo.outreach_count || 0) + 1 }).eq("id", wo.id);

      results.push(result);
    }

    return NextResponse.json({ success: true, outreach_sent: results.length, results });
  } catch (error) {
    console.error("Daily outreach error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
