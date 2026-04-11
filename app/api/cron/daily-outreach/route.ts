import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/cron/daily-outreach
 * Runs twice daily — sends SMS AND makes Vapi call for each eligible WO.
 *
 * Rules:
 * - WOs with status "New" or "Parts Have Arrived"
 * - 5 day max from first outreach, then stops
 * - 2 hour gap between attempts
 * - Skip if WO already has a scheduled appointment
 * - No contact before 8am or after 8:30pm CT
 * - Each attempt = 1 SMS + 1 Vapi call
 * - Runs 7 days a week
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

    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();

    // Fetch eligible work orders
    const { data: workOrders } = await sb
      .from("work_orders")
      .select(`
        id, tenant_id, work_order_number, status, job_type, appliance_type,
        outreach_count, last_outreach_date, first_outreach_date,
        customer:customers(customer_name, phone, service_address, city, state, zip)
      `)
      .in("status", ["New", "Parts Have Arrived"])
      .order("created_at", { ascending: true })
      .limit(20);

    // Get Vapi credentials (once, for the tenant)
    const { data: vapiInt } = await sb
      .from("tenant_integrations")
      .select("encrypted_keys")
      .eq("integration_type", "vapi")
      .eq("is_configured", true)
      .limit(1)
      .single();

    const vapiKeys = (vapiInt?.encrypted_keys as any) || {};
    const hasVapi = !!(vapiKeys.apiKey && vapiKeys.assistantId);

    const results: any[] = [];

    for (const wo of workOrders || []) {
      const customer = wo.customer as any;
      if (!customer?.phone) continue;

      // Stop after 5 days from first outreach
      if (wo.first_outreach_date && new Date(wo.first_outreach_date) < new Date(fiveDaysAgo)) {
        continue;
      }

      // Skip if last outreach was less than 2 hours ago
      if (wo.last_outreach_date && new Date(wo.last_outreach_date) > new Date(twoHoursAgo)) {
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
      const callbackSuffix = tenantPhone ? ` or call ${tenantPhone}` : "";

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

      const firstName = customer.customer_name?.split(" ")[0] || "there";
      const appliance = wo.appliance_type || "appliance";
      const woNum = wo.work_order_number || "";
      const address = [customer.service_address, customer.city, customer.state].filter(Boolean).join(", ");
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

      // ── 2. Make Vapi Call ──
      if (hasVapi) {
        try {
          // firstMessage uses Liquid template variables so Claude reads
          // values straight from variableValues instead of paraphrasing.
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
                // First-class Liquid template variables — referenced in
                // firstMessage and the assistant's system prompt as
                // {{customer_name}}, {{service_address}}, etc. The LLM
                // treats them as hard facts. Boolean branching (outbound
                // flag) lives in metadata since Liquid string truthiness
                // can be misleading.
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

      // Update outreach count
      await sb.from("work_orders").update({ outreach_count: (wo.outreach_count || 0) + 1 }).eq("id", wo.id);

      results.push(result);
    }

    return NextResponse.json({ success: true, outreach_sent: results.length, has_vapi: hasVapi, results });
  } catch (error) {
    console.error("Daily outreach error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
