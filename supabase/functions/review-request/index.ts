// Supabase Edge Function: review-request
// Replicates FA - Review Collection n8n workflow
// Called via pg_cron (hourly) or external cron
// Sends review request SMS 3+ hours after WO completion (business hours only)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req: Request) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Business hours check (8am - 7pm Central Time)
    const now = new Date();
    const ctHour = parseInt(
      now.toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false })
    );
    if (ctHour < 8 || ctHour >= 19) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "Outside business hours" }),
        { status: 200 }
      );
    }

    // Phase 1: Stamp completed_date on WOs that are 'completed' but missing it
    const { data: unstamped } = await supabase
      .from("work_orders")
      .select("id")
      .eq("status", "Complete")
      .is("completed_date", null)
      .limit(50);

    if (unstamped && unstamped.length > 0) {
      for (const wo of unstamped) {
        await supabase
          .from("work_orders")
          .update({ completed_date: new Date().toISOString() })
          .eq("id", wo.id);
      }
    }

    // Phase 2: Find WOs completed 3+ hours ago, review not yet requested
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000).toISOString();

    const { data: candidates } = await supabase
      .from("work_orders")
      .select(`
        id, tenant_id, work_order_number, appliance_type,
        customer:customers(customer_name, phone)
      `)
      .eq("status", "Complete")
      .eq("review_requested", false)
      .not("completed_date", "is", null)
      .lt("completed_date", threeHoursAgo)
      .limit(50);

    const results: any[] = [];

    for (const wo of candidates || []) {
      const customer = wo.customer as any;
      if (!customer?.phone) continue;

      // Get Twilio creds
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

      const firstName = customer.customer_name?.split(" ")[0] || "there";
      const appliance = wo.appliance_type || "appliance";
      const smsText = `Hi ${firstName}, thanks for choosing Fleming Appliance Repair! How was your experience with your ${appliance} service? Reply with a number 1-5 (5 = excellent, 1 = poor)`;

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

      const success = twilioRes.ok;

      // Mark review requested
      await supabase
        .from("work_orders")
        .update({
          review_requested: true,
          review_requested_date: new Date().toISOString(),
        })
        .eq("id", wo.id);

      // Log
      await supabase.from("sms_logs").insert({
        tenant_id: wo.tenant_id,
        recipient_phone: toPhone,
        message_type: "review_request",
        status: success ? "sent" : "failed",
      });

      results.push({ wo_id: wo.id, sent: success });
    }

    return new Response(
      JSON.stringify({
        success: true,
        stamped: unstamped?.length || 0,
        reviews_sent: results.length,
        results,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("review-request error:", error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
});
