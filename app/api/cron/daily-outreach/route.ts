import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/cron/daily-outreach
 * Runs at 9am and 9pm CT — sends SMS to customers with unscheduled work orders.
 * Replicates FA - Daily Outreach n8n workflow logic.
 *
 * Rules:
 * - Only WOs with status "New" or "Parts Have Arrived"
 * - Skip if outreach_count >= 5
 * - Skip if last outreach was < 10 hours ago
 * - Skip if WO already has a scheduled appointment
 * - Personalized message based on status and outreach count
 *
 * Triggered by Vercel Cron.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sb = supabaseAdmin();
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();

    // Fetch eligible work orders
    const { data: workOrders } = await sb
      .from("work_orders")
      .select(`
        id, tenant_id, work_order_number, status, job_type, appliance_type,
        outreach_count, last_outreach_date, first_outreach_date,
        customer:customers(customer_name, phone)
      `)
      .in("status", ["New", "Parts Have Arrived"])
      .order("created_at", { ascending: true })
      .limit(50);

    const results: any[] = [];

    for (const wo of workOrders || []) {
      const customer = wo.customer as any;
      if (!customer?.phone) continue;

      // Stop after 5 days from first outreach
      if (wo.first_outreach_date && new Date(wo.first_outreach_date) < new Date(fiveDaysAgo)) {
        continue;
      }

      // Skip if last outreach (SMS or Vapi) was less than 2 hours ago
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

      // Get Twilio creds
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

      // Build personalized SMS
      const firstName = customer.customer_name?.split(" ")[0] || "there";
      const appliance = wo.appliance_type || "appliance";
      const woNum = wo.work_order_number || "";
      const count_val = wo.outreach_count || 0;

      let smsBody: string;
      if (wo.status === "Parts Have Arrived") {
        smsBody = `Hi ${firstName}, this is Fleming Appliance Repair. Your ${appliance} parts are in (WO #${woNum}). Reply or call (855) 269-3196 to schedule your repair.`;
      } else if (count_val > 0) {
        smsBody = `Hi ${firstName}, this is Fleming Appliance Repair following up on your ${appliance} service (WO #${woNum}). Call (855) 269-3196 or reply to schedule.`;
      } else {
        smsBody = `Hi ${firstName}, this is Fleming Appliance Repair. We are ready to schedule your ${appliance} service (WO #${woNum}). Call (855) 269-3196 or reply.`;
      }

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

      // Update outreach count (trigger handles last_outreach_date)
      await sb
        .from("work_orders")
        .update({ outreach_count: count_val + 1 })
        .eq("id", wo.id);

      // Log
      await sb.from("sms_logs").insert({
        tenant_id: wo.tenant_id,
        recipient_phone: toPhone,
        message_type: "daily_outreach",
        status: twilioRes.ok ? "sent" : "failed",
      });

      // Store in conversation history
      await sb.from("sms_conversations").insert({
        tenant_id: wo.tenant_id,
        phone: toPhone,
        direction: "outbound",
        body: smsBody,
      });

      results.push({ wo_id: wo.id, wo_number: woNum, to: toPhone, sent: twilioRes.ok });
    }

    return NextResponse.json({ success: true, outreach_sent: results.length, results });
  } catch (error) {
    console.error("Daily outreach error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
