import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/notifications/status-change
 * Fires when a work order status changes. Sends Twilio SMS to the customer.
 * Called from the WO detail page after saving a status change.
 *
 * Body: { work_order_id, tenant_id, old_status, new_status }
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

export async function POST(request: NextRequest) {
  try {
    const { work_order_id, tenant_id, old_status, new_status } = await request.json();

    if (!work_order_id || !tenant_id || !new_status) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Skip if no actual change
    if (old_status === new_status) {
      return NextResponse.json({ skipped: true, reason: "No status change" });
    }

    const sb = supabaseAdmin();

    // Fetch work order with customer
    const { data: wo, error: woErr } = await sb
      .from("work_orders")
      .select(`
        *,
        customer:customers(customer_name, phone, email, service_address, city, state, zip)
      `)
      .eq("id", work_order_id)
      .single();

    if (woErr || !wo) {
      return NextResponse.json({ error: "Work order not found" }, { status: 404 });
    }

    const customer = wo.customer as any;
    if (!customer?.phone) {
      return NextResponse.json({ skipped: true, reason: "No customer phone" });
    }

    // Fetch tenant branding — name and callback phone used in SMS and Vapi
    const { data: tenantRow } = await sb
      .from("tenants")
      .select("name, contact_phone")
      .eq("id", tenant_id)
      .maybeSingle();
    const tenantName = tenantRow?.name || "your service provider";
    const tenantPhone = formatPhoneForDisplay(tenantRow?.contact_phone || "");
    const callbackSuffix = tenantPhone ? ` or call ${tenantPhone}` : "";

    // Fetch Twilio credentials (optional — if missing, SMS is skipped but
    // the Vapi call below still fires independently).
    const { data: integration } = await sb
      .from("tenant_integrations")
      .select("encrypted_keys")
      .eq("tenant_id", tenant_id)
      .eq("integration_type", "twilio")
      .eq("is_configured", true)
      .maybeSingle();

    const creds = (integration?.encrypted_keys as any) || {};
    const accountSid = creds.accountSid || "";
    const authToken = creds.authToken || "";
    const fromPhone = creds.phoneNumber || "";
    const twilioReady = !!(accountSid && authToken && fromPhone);

    // Format customer phone once — used by both SMS and Vapi
    const phoneDigits = customer.phone.replace(/\D/g, "");
    const toPhone = phoneDigits.length === 10 ? `+1${phoneDigits}` : `+${phoneDigits}`;

    // Build SMS message based on status
    const firstName = customer.customer_name?.split(" ")[0] || "there";
    const appliance = wo.appliance_type || "appliance";
    const address = [customer.service_address, customer.city, customer.state]
      .filter(Boolean)
      .join(", ");
    const woNum = wo.work_order_number || "";
    const jobLabel = wo.job_type === "Repair Follow-up" ? "repair follow-up" : "service";

    let smsBody: string | null = null;

    switch (new_status) {
      case "New":
        smsBody = `Hi ${firstName}, this is ${tenantName}. We are ready to schedule your ${appliance} service (WO #${woNum}). Reply${callbackSuffix} to book a time. - ${tenantName}`;
        break;

      case "Scheduled": {
        // Fetch the latest appointment for window info
        const { data: appt } = await sb
          .from("appointments")
          .select("appointment_date, start_time, end_time")
          .eq("work_order_id", work_order_id)
          .eq("status", "scheduled")
          .order("appointment_date", { ascending: false })
          .limit(1)
          .single();

        if (appt) {
          const d = new Date(appt.appointment_date + "T12:00:00");
          const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
          const dateStr = `${months[d.getMonth()]} ${d.getDate()}`;
          const window = `${appt.start_time?.slice(0, 5) || "9:00"} - ${appt.end_time?.slice(0, 5) || "12:00"}`;
          smsBody = `Hi ${firstName}, your ${appliance} ${jobLabel} at ${address} is confirmed for ${dateStr} between ${window}. See you then! - ${tenantName}`;
        } else {
          smsBody = `Hi ${firstName}, your ${appliance} ${jobLabel} at ${address} has been scheduled. We will send you the details shortly. - ${tenantName}`;
        }
        break;
      }

      case "Complete":
        smsBody = `Hi ${firstName}, your ${appliance} ${jobLabel} at ${address} is complete. Thank you for choosing ${tenantName}! We will follow up shortly for your feedback.`;
        break;

      case "Parts Have Arrived":
        smsBody = `Hi ${firstName}, your ${appliance} parts have arrived (WO #${woNum}). Reply${callbackSuffix} to schedule your repair. - ${tenantName}`;
        break;

      case "Parts Ordered":
        smsBody = `Hi ${firstName}, parts for your ${appliance} have been ordered (WO #${woNum}). We will contact you when they arrive to schedule your repair. - ${tenantName}`;
        break;

    }

    // Send SMS via Twilio (only if Twilio is configured and we have a template)
    let smsResult: any = null;
    if (smsBody && twilioReady) {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

      const twilioRes = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: fromPhone,
          To: toPhone,
          Body: smsBody,
        }),
      });

      const twilioData = await twilioRes.json();
      smsResult = { success: twilioRes.ok, message_sid: twilioData.sid };

      // Log the SMS
      await sb.from("sms_logs").insert({
        tenant_id,
        recipient_phone: toPhone,
        message_type: `status_${new_status}`,
        status: twilioRes.ok ? "sent" : "failed",
        twilio_message_id: twilioData.sid || null,
        error_message: twilioRes.ok ? null : JSON.stringify(twilioData),
      });
    } else if (smsBody && !twilioReady) {
      smsResult = { skipped: true, reason: "Twilio not configured" };
    } else if (!smsBody) {
      smsResult = { skipped: true, reason: `No SMS template for status: ${new_status}` };
    }

    // ── Immediate Vapi outbound call for New / Parts Have Arrived ──
    // Fires within 8am–8:30pm CT. Outside those hours, skip —
    // the 8am and 9am/3pm crons on /api/cron/daily-outreach will catch it.
    let vapiResult: any = null;
    if (new_status === "New" || new_status === "Parts Have Arrived") {
      const nowCt = new Date();
      const ctHour = parseInt(nowCt.toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }));
      const ctMin = parseInt(nowCt.toLocaleString("en-US", { timeZone: "America/Chicago", minute: "numeric" }));
      const inBusinessHours = ctHour >= 8 && ctHour <= 20 && !(ctHour === 20 && ctMin >= 30);

      if (!inBusinessHours) {
        vapiResult = { skipped: true, reason: "Outside business hours — cron will fire next" };
      } else {
        const { data: vapiInt } = await sb
          .from("tenant_integrations")
          .select("encrypted_keys")
          .eq("tenant_id", tenant_id)
          .eq("integration_type", "vapi")
          .eq("is_configured", true)
          .maybeSingle();

        const vapiKeys = (vapiInt?.encrypted_keys as any) || {};
        if (!vapiKeys.apiKey || !vapiKeys.assistantId) {
          vapiResult = { skipped: true, reason: "Vapi not configured" };
        } else {
          // firstMessage uses Liquid template variables so Claude reads
          // values straight from variableValues instead of paraphrasing or
          // re-inferring them from inline text. Work order number is
          // intentionally omitted from speech — available in variables if
          // the assistant needs it for a tool call.
          const vapiFirstMessage = new_status === "Parts Have Arrived"
            ? `Hi {{customer_name}}, this is {{tenant_name}} calling about your {{appliance_type}} repair at {{service_address}}. Your parts have arrived and we would like to schedule your repair follow-up appointment. Do you have a moment to pick a date?`
            : `Hi {{customer_name}}, this is {{tenant_name}} calling about your {{appliance_type}} service at {{service_address}}. We would like to schedule your appointment. Do you have a moment to pick a date?`;

          try {
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
                  // First-class Liquid template variables — the assistant's
                  // system prompt and firstMessage reference these as
                  // {{customer_name}}, {{service_address}}, etc. The LLM
                  // treats them as hard facts. Boolean branching (e.g.
                  // outbound flag) lives in metadata instead since Liquid
                  // string truthiness can be misleading.
                  variableValues: {
                    tenant_name: tenantName,
                    customer_name: customer.customer_name || "",
                    service_address: address || "",
                    work_order_number: woNum || "",
                    appliance_type: appliance || "",
                    status: new_status,
                    job_type: wo.job_type || "",
                  },
                  metadata: {
                    tenant_name: tenantName,
                    customer_name: customer.customer_name,
                    service_address: address,
                    work_order_number: woNum,
                    appliance_type: appliance,
                    status: new_status,
                    job_type: wo.job_type,
                    outbound: true,
                    trigger: "status_change_immediate",
                  },
                },
              }),
            });

            const vapiData = await vapiRes.json();
            vapiResult = { success: vapiRes.ok, call_id: vapiData.id };

            await sb.from("sms_logs").insert({
              tenant_id,
              recipient_phone: toPhone,
              message_type: `status_${new_status}_vapi`,
              status: vapiRes.ok ? "sent" : "failed",
              twilio_message_id: vapiData.id || null,
              error_message: vapiRes.ok ? null : JSON.stringify(vapiData),
            });
          } catch (err) {
            vapiResult = { success: false, error: (err as Error).message };
          }
        }

        // Bump outreach_count so the cron respects the 2-hour gap.
        // The DB trigger will stamp first_outreach_date / last_outreach_date.
        await sb
          .from("work_orders")
          .update({ outreach_count: (wo.outreach_count || 0) + 1 })
          .eq("id", work_order_id);
      }
    }

    // ── Sync status back to warranty provider (provider-agnostic) ──
    // Looks up warranty_links for this WO and dispatches to the right
    // provider's status-sync endpoint. Supports AHS, FAHW, and any
    // future providers without adding new conditionals here.
    try {
      const { data: warrantyLink } = await sb
        .from("warranty_links")
        .select("id, provider, external_id")
        .eq("work_order_id", work_order_id)
        .maybeSingle();

      if (warrantyLink) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://field-boss-pro.vercel.app";
        const syncPayload = { work_order_id, tenant_id, new_status, old_status };

        if (warrantyLink.provider === "AHS") {
          await fetch(`${appUrl}/api/ahs/status-update`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(syncPayload),
          });
        } else if (warrantyLink.provider === "FAHW") {
          await fetch(`${appUrl}/api/fahw/status-sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(syncPayload),
          });
        }
        // Future providers: add an else-if here
      }
    } catch {}

    return NextResponse.json({
      success: !!(smsResult?.success || vapiResult?.success),
      to: toPhone,
      status_transition: `${old_status} → ${new_status}`,
      sms: smsResult,
      sms_preview: smsBody ? smsBody.substring(0, 80) + "..." : null,
      vapi: vapiResult,
    });
  } catch (error) {
    console.error("Status change notification error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
