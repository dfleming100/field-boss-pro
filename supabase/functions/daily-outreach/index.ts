// Supabase Edge Function: daily-outreach
// Replicates FA - Daily Outreach n8n workflow
// Called via pg_cron or external cron (9am and 9pm CT)
// Sends SMS to customers with "New" or "Parts Have Arrived" WOs that have no appointment

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req: Request) => {
  try {
    // Optional: verify cron secret
    const authHeader = req.headers.get("Authorization");
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Parse tenant_id from request body (or run for all tenants)
    let tenantFilter: number | null = null;
    try {
      const body = await req.json();
      tenantFilter = body.tenant_id || null;
    } catch {
      // No body, run for all tenants
    }

    // Fetch eligible work orders: status New or ready_to_schedule,
    // outreach_count < 5, last outreach > 10 hours ago (or never)
    const tenHoursAgo = new Date(Date.now() - 10 * 3600 * 1000).toISOString();

    let query = supabase
      .from("work_orders")
      .select(`
        id, tenant_id, work_order_number, status, job_type, appliance_type,
        outreach_count, last_outreach_date, first_outreach_date,
        customer:customers(customer_name, phone, service_address)
      `)
      .in("status", ["draft", "ready_to_schedule", "New", "Parts Have Arrived"])
      .lt("outreach_count", 5)
      .order("created_at", { ascending: true })
      .limit(50);

    if (tenantFilter) {
      query = query.eq("tenant_id", tenantFilter);
    }

    const { data: workOrders, error: woError } = await query;

    if (woError) {
      return new Response(JSON.stringify({ error: woError.message }), { status: 500 });
    }

    const results: any[] = [];

    for (const wo of workOrders || []) {
      const customer = wo.customer as any;
      if (!customer?.phone) continue;

      // Skip if last outreach was less than 10 hours ago
      if (wo.last_outreach_date && new Date(wo.last_outreach_date) > new Date(tenHoursAgo)) {
        continue;
      }

      // Check if WO already has a scheduled appointment
      const { count: apptCount } = await supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("work_order_id", wo.id)
        .in("status", ["scheduled", "en_route", "arrived"]);

      if ((apptCount || 0) > 0) continue;

      // Get Twilio credentials for this tenant
      const { data: integration } = await supabase
        .from("tenant_integrations")
        .select("encrypted_keys")
        .eq("tenant_id", wo.tenant_id)
        .eq("integration_type", "twilio")
        .eq("is_configured", true)
        .single();

      if (!integration) continue;

      const twilioKeys = integration.encrypted_keys as any;
      const accountSid = twilioKeys?.accountSid || twilioKeys?.account_sid;
      const authToken = twilioKeys?.authToken || twilioKeys?.auth_token;
      const fromPhone = twilioKeys?.phoneNumber || twilioKeys?.phone_number;
      if (!accountSid || !authToken || !fromPhone) continue;

      // Build personalized SMS
      const firstName = customer.customer_name?.split(" ")[0] || "there";
      const appliance = wo.appliance_type || "appliance";
      const woNum = wo.work_order_number || "";
      const count = wo.outreach_count || 0;

      let smsText: string;
      if (wo.status === "Parts Have Arrived") {
        smsText = `Hi ${firstName}, this is Fleming Appliance Repair. Your ${appliance} parts are in (WO #${woNum}). Reply or call (855) 269-3196 to schedule your repair.`;
      } else if (count > 0) {
        smsText = `Hi ${firstName}, this is Fleming Appliance Repair following up on your ${appliance} service (WO #${woNum}). Call (855) 269-3196 or reply to schedule.`;
      } else {
        smsText = `Hi ${firstName}, this is Fleming Appliance Repair. We are ready to schedule your ${appliance} service (WO #${woNum}). Call (855) 269-3196 or reply.`;
      }

      // Send SMS via Twilio
      const phoneDigits = customer.phone.replace(/\D/g, "");
      const toPhone = phoneDigits.length === 10 ? `+1${phoneDigits}` : `+${phoneDigits}`;

      const twilioRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ From: fromPhone, To: toPhone, Body: smsText }),
        }
      );

      const twilioData = await twilioRes.json();
      const success = twilioRes.ok;

      // Update outreach count
      await supabase
        .from("work_orders")
        .update({ outreach_count: count + 1 })
        .eq("id", wo.id);

      // Log SMS
      await supabase.from("sms_logs").insert({
        tenant_id: wo.tenant_id,
        recipient_phone: toPhone,
        message_type: "daily_outreach",
        status: success ? "sent" : "failed",
        twilio_message_id: twilioData.sid || null,
        error_message: success ? null : JSON.stringify(twilioData),
      });

      results.push({
        wo_id: wo.id,
        wo_number: woNum,
        sent: success,
        to: toPhone,
      });
    }

    return new Response(
      JSON.stringify({ success: true, sent: results.length, results }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("daily-outreach error:", error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
});
