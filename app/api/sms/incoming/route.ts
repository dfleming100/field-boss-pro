import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/sms/incoming
 * Twilio webhook — receives inbound SMS from customers.
 * Logs the message and forwards to n8n for AI processing.
 *
 * Twilio sends form-encoded: From, To, Body, MessageSid, etc.
 */
export async function POST(request: NextRequest) {
  try {
    // Twilio sends form-encoded data
    const formData = await request.formData();
    const from = formData.get("From")?.toString() || "";
    const to = formData.get("To")?.toString() || "";
    const body = formData.get("Body")?.toString() || "";
    const messageSid = formData.get("MessageSid")?.toString() || "";

    console.log(`[Incoming SMS] From: ${from}, Body: "${body}"`);

    const sb = supabaseAdmin();

    // Normalize phone to find customer
    const fromDigits = from.replace(/\D/g, "");
    const searchDigits = fromDigits.length === 11 && fromDigits.startsWith("1")
      ? fromDigits.slice(1)
      : fromDigits;

    // Try to find the customer by phone
    const { data: customers } = await sb
      .from("customers")
      .select("id, tenant_id, customer_name, phone")
      .or(`phone.ilike.%${searchDigits.slice(-7)}%`)
      .limit(1);

    const customer = customers?.[0];
    const tenantId = customer?.tenant_id || 1;

    // Log the inbound SMS
    await sb.from("sms_logs").insert({
      tenant_id: tenantId,
      recipient_phone: from,
      message_type: "inbound",
      status: "received",
      twilio_message_id: messageSid,
      error_message: JSON.stringify({
        from,
        to,
        body,
        customer_id: customer?.id || null,
        customer_name: customer?.customer_name || null,
      }),
    });

    // Forward to n8n for AI processing
    const n8nUrl = process.env.N8N_BASE_URL || "https://n8n-production-57dc.up.railway.app";
    try {
      const n8nRes = await fetch(`${n8nUrl}/webhook/fa-incoming-sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          From: from,
          To: to,
          Body: body,
          MessageSid: messageSid,
        }),
      });
      console.log(`[Incoming SMS] Forwarded to n8n: ${n8nRes.status}`);
    } catch (n8nErr) {
      console.error("[Incoming SMS] n8n forward failed:", n8nErr);
    }

    // Return TwiML empty response (don't auto-reply — n8n handles the response)
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
      {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      }
    );
  } catch (error) {
    console.error("Incoming SMS error:", error);
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
      { status: 200, headers: { "Content-Type": "text/xml" } }
    );
  }
}
