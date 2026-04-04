import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/sms/send-manual
 * Sends a manual SMS from the Command Center — bypasses AI agent.
 * Body: { to: "+1...", body: "message text", tenant_id: 1 }
 */
export async function POST(request: NextRequest) {
  try {
    const { to, body: msgBody, tenant_id } = await request.json();

    if (!to || !msgBody) {
      return NextResponse.json({ error: "to and body required" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // Get Twilio credentials
    const { data: integration } = await sb
      .from("tenant_integrations")
      .select("encrypted_keys")
      .eq("tenant_id", tenant_id || 1)
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

    // Send via Twilio
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
        To: to,
        Body: msgBody,
      }),
    });

    const twilioData = await twilioRes.json();

    // Store in conversation history
    await sb.from("sms_conversations").insert({
      tenant_id: tenant_id || 1,
      phone: to,
      direction: "outbound",
      body: msgBody,
      message_sid: twilioData.sid || null,
    });

    // Log
    await sb.from("sms_logs").insert({
      tenant_id: tenant_id || 1,
      recipient_phone: to,
      message_type: "manual",
      status: twilioRes.ok ? "sent" : "failed",
      twilio_message_id: twilioData.sid || null,
      error_message: twilioRes.ok ? null : JSON.stringify(twilioData),
    });

    return NextResponse.json({
      success: twilioRes.ok,
      message_sid: twilioData.sid,
    });
  } catch (error) {
    console.error("Manual SMS error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
