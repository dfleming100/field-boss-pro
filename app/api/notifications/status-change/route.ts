import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/notifications/status-change
 * Fires when a work order status changes. Sends Twilio SMS to the customer.
 * Called from the WO detail page after saving a status change.
 *
 * Body: { work_order_id, tenant_id, old_status, new_status }
 */
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

    // Fetch Twilio credentials
    const { data: integration } = await sb
      .from("tenant_integrations")
      .select("encrypted_keys")
      .eq("tenant_id", tenant_id)
      .eq("integration_type", "twilio")
      .eq("is_configured", true)
      .single();

    if (!integration) {
      return NextResponse.json({ skipped: true, reason: "No Twilio configured" });
    }

    const creds = integration.encrypted_keys as any;
    const accountSid = creds.accountSid;
    const authToken = creds.authToken;
    const fromPhone = creds.phoneNumber;

    if (!accountSid || !authToken || !fromPhone) {
      return NextResponse.json({ error: "Incomplete Twilio credentials" }, { status: 500 });
    }

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
      case "scheduled": {
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
          smsBody = `Hi ${firstName}, your ${appliance} ${jobLabel} at ${address} is confirmed for ${dateStr} between ${window}. See you then! - Fleming Appliance`;
        } else {
          smsBody = `Hi ${firstName}, your ${appliance} ${jobLabel} at ${address} has been scheduled. We will send you the details shortly. - Fleming Appliance`;
        }
        break;
      }

      case "in_progress":
        smsBody = `Hi ${firstName}, your ${appliance} technician is on the way to ${address}. They should arrive within your scheduled window. - Fleming Appliance`;
        break;

      case "completed":
        smsBody = `Hi ${firstName}, your ${appliance} ${jobLabel} at ${address} is complete. Thank you for choosing Fleming Appliance! We will follow up shortly for your feedback.`;
        break;

      case "ready_to_schedule":
        smsBody = `Hi ${firstName}, your ${appliance} parts have arrived (WO #${woNum}). Reply or call (855) 269-3196 to schedule your repair. - Fleming Appliance`;
        break;

      case "canceled":
        smsBody = `Hi ${firstName}, your ${appliance} service (WO #${woNum}) has been canceled. If you need anything, call us at (855) 269-3196. - Fleming Appliance`;
        break;
    }

    if (!smsBody) {
      return NextResponse.json({ skipped: true, reason: `No SMS template for status: ${new_status}` });
    }

    // Send via Twilio
    const phoneDigits = customer.phone.replace(/\D/g, "");
    const toPhone = phoneDigits.length === 10 ? `+1${phoneDigits}` : `+${phoneDigits}`;

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

    // Log the SMS
    await sb.from("sms_logs").insert({
      tenant_id,
      recipient_phone: toPhone,
      message_type: `status_${new_status}`,
      status: twilioRes.ok ? "sent" : "failed",
      twilio_message_id: twilioData.sid || null,
      error_message: twilioRes.ok ? null : JSON.stringify(twilioData),
    });

    return NextResponse.json({
      success: twilioRes.ok,
      message_sid: twilioData.sid,
      to: toPhone,
      status_transition: `${old_status} → ${new_status}`,
      sms_preview: smsBody.substring(0, 80) + "...",
    });
  } catch (error) {
    console.error("Status change notification error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
