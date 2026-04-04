import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/cron/vapi-outreach
 * Runs at 11am and 3pm CT — makes outbound Vapi calls to customers
 * with unscheduled work orders (New or Parts Have Arrived).
 *
 * Rules:
 * - Only WOs with status "New" or "Parts Have Arrived"
 * - Stop after 5 days from first outreach
 * - Skip if WO already has a scheduled appointment
 * - Skip if last outreach (SMS or Vapi) was < 2 hours ago
 * - Uses Vapi outbound call API
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
        customer:customers(customer_name, phone, service_address, city, state, zip)
      `)
      .in("status", ["New", "Parts Have Arrived"])
      .order("created_at", { ascending: true })
      .limit(20);

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

      // Get Vapi credentials for this tenant
      const { data: vapiInt } = await sb
        .from("tenant_integrations")
        .select("encrypted_keys")
        .eq("tenant_id", wo.tenant_id)
        .eq("integration_type", "vapi")
        .eq("is_configured", true)
        .single();

      if (!vapiInt) continue;

      const vapiKeys = vapiInt.encrypted_keys as any;
      if (!vapiKeys.apiKey || !vapiKeys.assistantId) continue;

      // Get Twilio phone number for caller ID
      const { data: twilioInt } = await sb
        .from("tenant_integrations")
        .select("encrypted_keys")
        .eq("tenant_id", wo.tenant_id)
        .eq("integration_type", "twilio")
        .eq("is_configured", true)
        .single();

      const twilioPhone = (twilioInt?.encrypted_keys as any)?.phoneNumber || "";

      // Format customer phone
      const phoneDigits = customer.phone.replace(/\D/g, "");
      const toPhone = phoneDigits.length === 10 ? `+1${phoneDigits}` : `+${phoneDigits}`;

      // Make outbound Vapi call
      try {
        const vapiRes = await fetch("https://api.vapi.ai/call", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${vapiKeys.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            assistantId: vapiKeys.assistantId,
            customer: {
              number: toPhone,
            },
            phoneNumberId: vapiKeys.phoneNumberId || undefined,
            assistantOverrides: {
              firstMessage: wo.status === "Parts Have Arrived"
                ? `Hi, this is Fleming Appliance Repair calling about your ${wo.appliance_type || "appliance"} repair. Your parts have arrived and we would like to schedule your repair appointment. Do you have a moment?`
                : `Hi, this is Fleming Appliance Repair calling about your ${wo.appliance_type || "appliance"} service at ${customer.service_address || "your home"}. We would like to schedule your appointment. Do you have a moment?`,
            },
          }),
        });

        const vapiData = await vapiRes.json();
        const success = vapiRes.ok;

        // Update outreach count
        await sb
          .from("work_orders")
          .update({ outreach_count: (wo.outreach_count || 0) + 1 })
          .eq("id", wo.id);

        // Log
        await sb.from("sms_logs").insert({
          tenant_id: wo.tenant_id,
          recipient_phone: toPhone,
          message_type: "vapi_outreach",
          status: success ? "sent" : "failed",
          twilio_message_id: vapiData.id || null,
          error_message: success ? null : JSON.stringify(vapiData),
        });

        results.push({
          wo_id: wo.id,
          wo_number: wo.work_order_number,
          to: toPhone,
          call_id: vapiData.id,
          sent: success,
        });
      } catch (err) {
        results.push({ wo_id: wo.id, error: (err as Error).message });
      }
    }

    return NextResponse.json({ success: true, calls_made: results.length, results });
  } catch (error) {
    console.error("Vapi outreach error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
