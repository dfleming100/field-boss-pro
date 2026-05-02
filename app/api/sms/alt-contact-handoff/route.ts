import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/sms/alt-contact-handoff
 *
 * Body: { work_order_id, contact_name, contact_phone, relationship?, tenant_id? }
 *
 * Saves the alt contact onto the WO and texts them with the next 3 openings.
 * Inbound SMS handler also matches against work_orders.alt_contact_phone, so
 * the alt contact's reply routes back to this WO and they can complete the
 * booking conversation themselves.
 *
 * Called from:
 *   - SMS agent (action="alt_contact" in /api/sms/incoming)
 *   - Vapi voice agent (alt_contact_handoff tool)
 */
export async function POST(request: NextRequest) {
  try {
    const { work_order_id, contact_name, contact_phone, relationship, tenant_id } =
      await request.json();

    if (!work_order_id || !contact_phone) {
      return NextResponse.json(
        { error: "work_order_id and contact_phone required" },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();
    const altPhoneDigits = String(contact_phone).replace(/\D/g, "");
    if (altPhoneDigits.length < 10) {
      return NextResponse.json({ error: "invalid contact_phone" }, { status: 400 });
    }
    const toE164 =
      altPhoneDigits.length === 10
        ? `+1${altPhoneDigits}`
        : `+${altPhoneDigits}`;

    // Pull WO + customer
    const { data: wo, error: woErr } = await sb
      .from("work_orders")
      .select(
        `id, tenant_id, work_order_number, appliance_type, status,
         customer:customers(customer_name)`
      )
      .eq("id", work_order_id)
      .single();
    if (woErr || !wo) {
      return NextResponse.json({ error: "work order not found" }, { status: 404 });
    }
    const tenantId = tenant_id || wo.tenant_id;

    // Block sends to opted-out numbers
    const { data: optout } = await sb
      .from("sms_optouts")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("phone", toE164)
      .maybeSingle();
    if (optout) {
      return NextResponse.json({ error: "alt contact has opted out" }, { status: 403 });
    }

    // Save alt contact onto the WO
    await sb
      .from("work_orders")
      .update({
        alt_contact_name: contact_name || null,
        alt_contact_phone: toE164,
        alt_contact_relationship: relationship || null,
      })
      .eq("id", work_order_id);

    // Pull next 3 available dates from get-available-slots
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://field-boss-pro.vercel.app";
    let datesLine = "";
    let windowLine = "";
    try {
      const slotsRes = await fetch(`${appUrl}/api/vapi/get-available-slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ work_order_number: wo.work_order_number }),
      });
      const slots = await slotsRes.json();
      const dates: string[] = (slots.available_dates || []).slice(0, 3);
      const fmt = (d: string) => {
        const dt = new Date(d + "T12:00:00Z");
        const months = [
          "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec",
        ];
        const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
        return `${days[dt.getUTCDay()]} ${months[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
      };
      datesLine = dates.map(fmt).join(", ");
      if (slots.window_start && slots.window_end) {
        windowLine = `${slots.window_start}-${slots.window_end}`;
      }
    } catch {}

    // Twilio creds
    const { data: integration } = await sb
      .from("tenant_integrations")
      .select("encrypted_keys")
      .eq("tenant_id", tenantId)
      .eq("integration_type", "twilio")
      .eq("is_configured", true)
      .single();
    if (!integration) {
      return NextResponse.json({ error: "Twilio not configured" }, { status: 400 });
    }
    const creds = integration.encrypted_keys as any;
    const accountSid = creds.accountSid;
    const authToken = creds.authToken;
    const fromPhone = creds.phoneNumber;

    // Tenant company name (for greeting)
    const { data: tenantRow } = await sb
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .single();
    const companyName = tenantRow?.name || "our office";

    const customerArr = wo.customer as any;
    const origCustomerName =
      (Array.isArray(customerArr) ? customerArr[0]?.customer_name : customerArr?.customer_name) ||
      "the customer";
    const origFirst = String(origCustomerName).split(" ")[0];
    const altFirst = (contact_name || "there").split(" ")[0];
    const appliance = wo.appliance_type || "appliance";

    let body =
      `Hi ${altFirst}, this is ${companyName}. ${origFirst} asked us to coordinate the ${appliance} repair with you. `;
    if (datesLine) {
      body += `We have openings ${datesLine}${windowLine ? ` between ${windowLine}` : ""}. Reply with a date that works.`;
    } else {
      body += `Reply with a date that works for you and we will check availability.`;
    }
    body += ` Reply STOP to opt out.`;

    // Send via Twilio
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const params = new URLSearchParams();
    params.append("From", fromPhone);
    params.append("To", toE164);
    params.append("Body", body);
    params.append("StatusCallback", `${appUrl}/api/sms/status`);

    const twilioRes = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    const twilioData = await twilioRes.json();

    await sb.from("sms_conversations").insert({
      tenant_id: tenantId,
      phone: toE164,
      direction: "outbound",
      body,
      message_sid: twilioData.sid || null,
      status: twilioData.status || (twilioRes.ok ? "queued" : "failed"),
      work_order_id: wo.id,
      error_code: twilioRes.ok ? null : String(twilioData.code || ""),
      error_message: twilioRes.ok ? null : twilioData.message || null,
    });

    await sb.from("sms_logs").insert({
      tenant_id: tenantId,
      recipient_phone: toE164,
      message_type: "alt_contact_handoff",
      status: twilioRes.ok ? "sent" : "failed",
      twilio_message_id: twilioData.sid || null,
      error_message: twilioRes.ok ? null : JSON.stringify(twilioData),
    });

    if (!twilioRes.ok) {
      return NextResponse.json(
        { success: false, error: twilioData.message || "send failed" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      message_sid: twilioData.sid,
      to: toE164,
      preview: body,
    });
  } catch (error) {
    console.error("alt-contact-handoff error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
