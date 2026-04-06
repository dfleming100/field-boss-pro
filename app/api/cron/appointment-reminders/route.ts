import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/cron/appointment-reminders
 * Runs daily at 7am CT — sends reminder SMS to all customers with appointments today.
 * "Hi [name], this is a reminder that your [appliance] appointment is today between [window].
 *  Your technician [tech] will be arriving within that window. See you soon!"
 *
 * Triggered by Vercel Cron.
 */
export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sends this header)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sb = supabaseAdmin();
    const today = new Date().toISOString().split("T")[0];

    // Fetch today's scheduled appointments with customer and tech info
    const { data: appointments } = await sb
      .from("appointments")
      .select(`
        id, appointment_date, start_time, end_time, technician_id,
        work_order:work_orders!inner(
          id, tenant_id, work_order_number, appliance_type, job_type,
          customer:customers(customer_name, phone)
        ),
        technician:technicians!assigned_technician_id(tech_name)
      `)
      .eq("appointment_date", today)
      .eq("status", "scheduled");

    const results: any[] = [];

    for (const appt of appointments || []) {
      const wo = appt.work_order as any;
      const customer = wo?.customer;
      const tech = appt.technician as any;

      if (!customer?.phone) continue;

      // Get Twilio creds for this tenant
      const { data: integration } = await sb
        .from("tenant_integrations")
        .select("encrypted_keys")
        .eq("tenant_id", wo.tenant_id)
        .eq("integration_type", "twilio")
        .eq("is_configured", true)
        .single();

      if (!integration) continue;

      const creds = integration.encrypted_keys as any;
      if (!creds.accountSid || !creds.authToken || !creds.phoneNumber) continue;

      const firstName = customer.customer_name?.split(" ")[0] || "there";
      const appliance = wo.appliance_type || "appliance";
      const techName = tech?.tech_name || "your technician";
      const startTime = appt.start_time?.slice(0, 5) || "9:00";
      const endTime = appt.end_time?.slice(0, 5) || "12:00";

      const smsBody = `Hi ${firstName}, this is a reminder that your ${appliance} appointment is today between ${startTime} and ${endTime}. Your technician ${techName} will be arriving within that window. See you soon! - Fleming Appliance`;

      // Send via Twilio
      const phoneDigits = customer.phone.replace(/\D/g, "");
      const toPhone = phoneDigits.length === 10 ? `+1${phoneDigits}` : `+${phoneDigits}`;
      const basicAuth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");

      const twilioRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ From: creds.phoneNumber, To: toPhone, Body: smsBody }),
        }
      );

      const twilioData = await twilioRes.json();

      // Log
      await sb.from("sms_logs").insert({
        tenant_id: wo.tenant_id,
        recipient_phone: toPhone,
        message_type: "appointment_reminder",
        status: twilioRes.ok ? "sent" : "failed",
        twilio_message_id: twilioData.sid || null,
      });

      // Store in conversation history
      await sb.from("sms_conversations").insert({
        tenant_id: wo.tenant_id,
        phone: toPhone,
        direction: "outbound",
        body: smsBody,
      });

      results.push({ appt_id: appt.id, to: toPhone, sent: twilioRes.ok });
    }

    return NextResponse.json({ success: true, date: today, reminders_sent: results.length, results });
  } catch (error) {
    console.error("Appointment reminders error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
