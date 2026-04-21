import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/sms/send-manual
 * Sends a manual SMS/MMS from the Command Center — bypasses AI agent.
 * Body: { to, body, tenant_id, media_urls?: string[], customer_id?, work_order_id? }
 */
export async function POST(request: NextRequest) {
  try {
    const { to, body: msgBody, tenant_id, media_urls, customer_id, work_order_id } = await request.json();

    if (!to || (!msgBody && !(Array.isArray(media_urls) && media_urls.length))) {
      return NextResponse.json({ error: "to and (body or media_urls) required" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const tenantId = tenant_id || 1;

    // Block sends to opted-out numbers
    const { data: optout } = await sb
      .from("sms_optouts")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("phone", to)
      .maybeSingle();
    if (optout) {
      return NextResponse.json({ error: "recipient has opted out" }, { status: 403 });
    }

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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://field-boss-pro.vercel.app";
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    const params = new URLSearchParams();
    params.append("From", fromPhone);
    params.append("To", to);
    if (msgBody) params.append("Body", msgBody);
    params.append("StatusCallback", `${appUrl}/api/sms/status`);
    if (Array.isArray(media_urls)) {
      for (const url of media_urls) {
        if (typeof url === "string" && url) params.append("MediaUrl", url);
      }
    }

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
      phone: to,
      direction: "outbound",
      body: msgBody || "",
      message_sid: twilioData.sid || null,
      status: twilioData.status || (twilioRes.ok ? "queued" : "failed"),
      media_urls: Array.isArray(media_urls) && media_urls.length ? media_urls : null,
      customer_id: customer_id || null,
      work_order_id: work_order_id || null,
      error_code: twilioRes.ok ? null : String(twilioData.code || ""),
      error_message: twilioRes.ok ? null : twilioData.message || null,
    });

    await sb.from("sms_logs").insert({
      tenant_id: tenantId,
      recipient_phone: to,
      message_type: "manual",
      status: twilioRes.ok ? "sent" : "failed",
      twilio_message_id: twilioData.sid || null,
      error_message: twilioRes.ok ? null : JSON.stringify(twilioData),
    });

    if (!twilioRes.ok) {
      return NextResponse.json({ success: false, error: twilioData.message || "send failed", details: twilioData }, { status: 502 });
    }

    return NextResponse.json({ success: true, message_sid: twilioData.sid, status: twilioData.status });
  } catch (error) {
    console.error("Manual SMS error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
