import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/cron/review-request
 * Runs hourly — sends "rate us 1-5" SMS to customers 3+ hours after job completion.
 * Business hours only (8am - 8:30pm CT).
 * Only sends once per WO (checks review_requested flag).
 */
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

    // Phase 1: Stamp completed_date on WOs that are Complete but missing it
    const { data: unstamped } = await sb
      .from("work_orders")
      .select("id")
      .eq("status", "Complete")
      .is("completed_date", null)
      .limit(50);

    for (const wo of unstamped || []) {
      await sb.from("work_orders").update({ completed_date: new Date().toISOString() }).eq("id", wo.id);
    }

    // Phase 2: Find WOs completed 3+ hours ago, review not yet requested
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000).toISOString();

    const { data: candidates } = await sb
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
      const smsBody = `Hi ${firstName}, thanks for choosing Fleming Appliance Repair! How was your experience with your ${appliance} service? Reply with a number 1-5 (5 = excellent, 1 = poor)`;

      const phoneDigits = customer.phone.replace(/\D/g, "");
      const toPhone = phoneDigits.length === 10 ? `+1${phoneDigits}` : `+${phoneDigits}`;
      const basicAuth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");

      const twilioRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: { Authorization: `Basic ${basicAuth}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ From: creds.phoneNumber, To: toPhone, Body: smsBody }),
        }
      );

      // Mark review requested
      await sb.from("work_orders").update({
        review_requested: true,
        review_requested_date: new Date().toISOString(),
      }).eq("id", wo.id);

      // Store in conversation history
      await sb.from("sms_conversations").insert({ tenant_id: wo.tenant_id, phone: toPhone, direction: "outbound", body: smsBody });
      await sb.from("sms_logs").insert({ tenant_id: wo.tenant_id, recipient_phone: toPhone, message_type: "review_request", status: twilioRes.ok ? "sent" : "failed" });

      results.push({ wo_id: wo.id, to: toPhone, sent: twilioRes.ok });
    }

    return NextResponse.json({ success: true, stamped: unstamped?.length || 0, reviews_sent: results.length, results });
  } catch (error) {
    console.error("Review request error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
