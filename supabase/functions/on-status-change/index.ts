// Supabase Edge Function: on-status-change
// Triggered via Database Webhook when work_order status changes.
// Sends Twilio SMS notifications based on the status transition.
// Also triggers n8n webhook for complex flows (warranty updates, etc.)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const N8N_BASE_URL = Deno.env.get("N8N_BASE_URL") || "https://n8n-production-57dc.up.railway.app";

interface StatusChangePayload {
  type: "UPDATE";
  table: "work_orders";
  record: {
    id: number;
    tenant_id: number;
    customer_id: number;
    assigned_technician_id: number | null;
    work_order_number: string;
    status: string;
    previous_status: string;
    job_type: string;
    appliance_type: string;
    service_date: string | null;
    warranty_company: string | null;
  };
  old_record: {
    status: string;
  };
}

// SMS templates based on status transitions
const SMS_TEMPLATES: Record<string, (ctx: any) => string> = {
  // When appointment is booked
  scheduled: (ctx) =>
    `Hi ${ctx.first_name}, your ${ctx.appliance} ${ctx.job_type_label} at ${ctx.address} is confirmed for ${ctx.service_date_display} between ${ctx.window}. See you then! - Fleming Appliance`,

  // When tech is on the way
  in_progress: (ctx) =>
    `Hi ${ctx.first_name}, your ${ctx.appliance} technician is on the way to ${ctx.address}. They should arrive within your scheduled window. - Fleming Appliance`,

  // When job is completed
  completed: (ctx) =>
    `Hi ${ctx.first_name}, your ${ctx.appliance} service at ${ctx.address} is complete. Thank you for choosing Fleming Appliance! We will follow up shortly.`,

  // When parts are ordered
  parts_ordered: (ctx) =>
    `Hi ${ctx.first_name}, parts for your ${ctx.appliance} at ${ctx.address} have been ordered. We will contact you when they arrive to schedule your repair. - Fleming Appliance`,

  // When parts arrive
  parts_arrived: (ctx) =>
    `Hi ${ctx.first_name}, great news! Your ${ctx.appliance} parts have arrived. Reply or call (855) 269-3196 to schedule your repair. - Fleming Appliance`,
};

serve(async (req: Request) => {
  try {
    const payload: StatusChangePayload = await req.json();
    const record = payload.record;
    const oldStatus = payload.old_record?.status || record.previous_status;
    const newStatus = record.status;

    // Skip if no actual status change
    if (oldStatus === newStatus) {
      return new Response(JSON.stringify({ skipped: true }), { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Fetch customer details
    const { data: customer } = await supabase
      .from("customers")
      .select("customer_name, phone, email, service_address, city, state, zip")
      .eq("id", record.customer_id)
      .single();

    if (!customer || !customer.phone) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "No customer phone" }),
        { status: 200 }
      );
    }

    // Fetch tenant's Twilio credentials
    const { data: integration } = await supabase
      .from("tenant_integrations")
      .select("encrypted_keys, encryption_key")
      .eq("tenant_id", record.tenant_id)
      .eq("integration_type", "twilio")
      .eq("is_configured", true)
      .single();

    // Build context for SMS template
    const firstName = customer.customer_name?.split(" ")[0] || "there";
    const address = [customer.service_address, customer.city, customer.state]
      .filter(Boolean)
      .join(", ");
    const jobTypeLabel =
      record.job_type === "Repair Follow-up" ? "repair" : "service";

    // Fetch appointment for window info if scheduled
    let windowLabel = "";
    let serviceDateDisplay = "";
    if (newStatus === "scheduled" && record.service_date) {
      const { data: appt } = await supabase
        .from("appointments")
        .select("start_time, end_time, appointment_date")
        .eq("work_order_id", record.id)
        .eq("status", "scheduled")
        .order("appointment_date", { ascending: false })
        .limit(1)
        .single();

      if (appt) {
        windowLabel = `${appt.start_time || "9:00"} - ${appt.end_time || "12:00"}`;
        const d = new Date(appt.appointment_date + "T12:00:00");
        const months = [
          "January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December",
        ];
        serviceDateDisplay = `${months[d.getMonth()]} ${d.getDate()}`;
      }
    }

    const ctx = {
      first_name: firstName,
      appliance: record.appliance_type || "appliance",
      address,
      job_type_label: jobTypeLabel,
      service_date_display: serviceDateDisplay,
      window: windowLabel,
      wo_number: record.work_order_number,
    };

    // Map n8n-style statuses to our template keys
    const statusMap: Record<string, string> = {
      scheduled: "scheduled",
      in_progress: "in_progress",
      completed: "completed",
    };

    const templateKey = statusMap[newStatus];
    const template = templateKey ? SMS_TEMPLATES[templateKey] : null;

    const actions: string[] = [];

    // Send SMS if we have a template and Twilio creds
    if (template && integration) {
      const smsBody = template(ctx);

      // Decrypt Twilio credentials
      // For now, use the raw keys (encryption handled by the app layer)
      const twilioKeys = integration.encrypted_keys as any;
      const accountSid = twilioKeys?.accountSid || twilioKeys?.account_sid;
      const authToken = twilioKeys?.authToken || twilioKeys?.auth_token;
      const fromPhone = twilioKeys?.phoneNumber || twilioKeys?.phone_number;

      if (accountSid && authToken && fromPhone) {
        const phoneDigits = customer.phone.replace(/\D/g, "");
        const toPhone =
          phoneDigits.length === 10 ? `+1${phoneDigits}` : `+${phoneDigits}`;

        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
        const basicAuth = btoa(`${accountSid}:${authToken}`);

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
        actions.push(`SMS sent: ${twilioData.sid || "error"}`);

        // Log SMS
        await supabase.from("sms_logs").insert({
          tenant_id: record.tenant_id,
          recipient_phone: toPhone,
          message_type: `status_${newStatus}`,
          status: twilioRes.ok ? "sent" : "failed",
          twilio_message_id: twilioData.sid || null,
          error_message: twilioRes.ok ? null : JSON.stringify(twilioData),
        });
      }
    }

    // If warranty company, notify n8n for outbound sync
    if (record.warranty_company) {
      try {
        await fetch(`${N8N_BASE_URL}/webhook/fa-warranty-status-update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            work_order_id: record.id,
            work_order_number: record.work_order_number,
            warranty_company: record.warranty_company,
            old_status: oldStatus,
            new_status: newStatus,
            tenant_id: record.tenant_id,
          }),
        });
        actions.push("Warranty webhook sent");
      } catch (e) {
        actions.push(`Warranty webhook failed: ${e}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        work_order_id: record.id,
        transition: `${oldStatus} → ${newStatus}`,
        actions,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("on-status-change error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500 }
    );
  }
});
