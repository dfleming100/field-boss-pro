import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/sms/incoming
 * Twilio webhook — receives inbound SMS from customers.
 * Full processing loop:
 * 1. Look up customer in Supabase by phone
 * 2. Find active work order
 * 3. Get available slots
 * 4. Send context to Claude Haiku for intent classification
 * 5. Take action (book, reply info, etc.)
 * 6. Send reply SMS via Twilio
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://field-boss-pro.vercel.app";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const from = formData.get("From")?.toString() || "";
    const body = formData.get("Body")?.toString() || "";
    const messageSid = formData.get("MessageSid")?.toString() || "";

    console.log(`[SMS] From: ${from}, Body: "${body}"`);

    const sb = supabaseAdmin();

    // Normalize phone
    const fromDigits = from.replace(/\D/g, "");
    const searchDigits = fromDigits.length === 11 && fromDigits.startsWith("1")
      ? fromDigits.slice(1)
      : fromDigits;

    // Store inbound message in conversation history
    await sb.from("sms_conversations").insert({
      tenant_id: 1,
      phone: from,
      direction: "inbound",
      body,
      message_sid: messageSid,
    });

    // Fetch recent conversation history (last 10 messages)
    const { data: convHistory } = await sb
      .from("sms_conversations")
      .select("direction, body, created_at")
      .eq("phone", from)
      .order("created_at", { ascending: false })
      .limit(10);

    // Build conversation thread (oldest first)
    const conversationThread = (convHistory || [])
      .reverse()
      .map((msg: any) => `${msg.direction === "inbound" ? "Customer" : "Fleming"}: ${msg.body}`)
      .join("\n");

    // 1. Customer lookup in Supabase
    const lookupRes = await fetch(`${APP_URL}/api/vapi/customer-lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: searchDigits }),
    });
    const customerData = await lookupRes.json();

    // 2. Always fetch available slots so Claude has full context for any request
    let slotsData: any = null;
    if (customerData.found && customerData.active_wo?.wo_number) {
      const slotsRes = await fetch(`${APP_URL}/api/vapi/get-available-slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ work_order_number: customerData.active_wo.wo_number }),
      });
      slotsData = await slotsRes.json();
    }

    // 3. Build Claude prompt and get intent (with conversation history)
    const aiResult = await classifyIntent(body, customerData, slotsData, conversationThread);

    // 4. Take action
    let replyText = aiResult.reply;

    // If reschedule, use the agent summary from slots
    if (aiResult.action === "reschedule" && slotsData?.agent_summary) {
      replyText = `No problem! ${slotsData.agent_summary}`;
    }

    if (aiResult.action === "book" && aiResult.chosen_date && customerData.active_wo) {
      // Verify date is available
      const availDates = slotsData?.available_dates || [];
      if (availDates.includes(aiResult.chosen_date)) {
        const bookRes = await fetch(`${APP_URL}/api/vapi/book-appointment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            work_order_number: customerData.active_wo.wo_number,
            chosen_date: aiResult.chosen_date,
            tech_id: aiResult.tech_id || slotsData?.tech_id || "",
          }),
        });
        const bookData = await bookRes.json();
        if (!bookData.success) {
          replyText = `Sorry, that date is not available. ${slotsData?.agent_summary || "Please call (855) 269-3196."}`;
        }
      } else {
        // Date not in available list — override with info
        const first3 = availDates.slice(0, 3);
        const fmtDates = first3.map((d: string) => {
          const dt = new Date(d + "T12:00:00");
          const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
          return `${months[dt.getMonth()]} ${dt.getDate()}`;
        }).join(", ");
        replyText = `Sorry, that date is not available. We have openings on ${fmtDates}. Which day works for you?`;
      }
    }

    // 5. Send reply SMS via Twilio
    const tenantId = customerData.found ? customerData.customer_id : 1;
    const { data: integration } = await sb
      .from("tenant_integrations")
      .select("encrypted_keys")
      .eq("tenant_id", 1)
      .eq("integration_type", "twilio")
      .eq("is_configured", true)
      .single();

    if (integration && replyText) {
      const creds = integration.encrypted_keys as any;
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`;
      const basicAuth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");

      await fetch(twilioUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: creds.phoneNumber,
          To: from,
          Body: replyText,
        }),
      });

      // Store outbound in conversation history
      await sb.from("sms_conversations").insert({
        tenant_id: 1,
        phone: from,
        direction: "outbound",
        body: replyText,
      });

      // Log outbound
      await sb.from("sms_logs").insert({
        tenant_id: 1,
        recipient_phone: from,
        message_type: `reply_${aiResult.action}`,
        status: "sent",
        error_message: JSON.stringify({ action: aiResult.action, reply_preview: replyText.substring(0, 100) }),
      });
    }

    // Log inbound
    await sb.from("sms_logs").insert({
      tenant_id: 1,
      recipient_phone: from,
      message_type: "inbound",
      status: "received",
      twilio_message_id: messageSid,
      error_message: JSON.stringify({ body, customer: customerData.customer_name, action: aiResult.action }),
    });

    // Return empty TwiML (we send reply via API, not TwiML)
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
      { status: 200, headers: { "Content-Type": "text/xml" } }
    );
  } catch (error) {
    console.error("[SMS] Error:", error);
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
      { status: 200, headers: { "Content-Type": "text/xml" } }
    );
  }
}

async function classifyIntent(
  smsBody: string,
  customer: any,
  slots: any,
  conversationThread?: string
): Promise<{ action: string; reply: string; chosen_date?: string; tech_id?: string }> {
  if (!ANTHROPIC_API_KEY) {
    return { action: "unclear", reply: "Thanks for reaching out! Please call us at (855) 269-3196." };
  }

  if (!customer.found) {
    return {
      action: "unknown_customer",
      reply: "Hi, thanks for texting Fleming Appliance Repair! We could not find your account. Please call us at (855) 269-3196 so we can assist you.",
    };
  }

  const wo = customer.active_wo || {};
  const today = new Date().toISOString().split("T")[0];
  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const todayName = dayNames[new Date().getDay()];

  const prompt = `You are a friendly SMS assistant for Fleming Appliance Repair. Return ONLY valid JSON. No markdown, no backticks.

Today: ${today} (${todayName})
${conversationThread ? `
CONVERSATION HISTORY (most recent messages):
${conversationThread}

The LATEST message from the customer is what you are responding to. Use the conversation history to understand context — for example, if Fleming just offered dates and the customer says "yes" or "the 7th", they are responding to that offer.
` : ""}
CURRENT MESSAGE: "${smsBody}"
CUSTOMER NAME: ${customer.customer_name}
CUSTOMER ADDRESS: ${customer.address}

WORK ORDER INFO:
- Work Order: ${wo.wo_number || "none"}
- Job Type: ${wo.job_type || ""}
- Appliances: ${wo.appliance_type || ""}
- Status: ${wo.status || "none"}
- Assigned Tech: ${wo.tech_name || ""}
${customer.appointment ? `
EXISTING APPOINTMENT:
- Date: ${customer.appointment.date_display || customer.appointment.date || ""}
- Window: ${customer.appointment.window_start || ""} to ${customer.appointment.window_end || ""}
` : ""}
${slots ? `SCHEDULING DATA:
- Tech: ${slots.tech_name || ""}
- Time Window: ${slots.window_start || ""} to ${slots.window_end || ""}
- Available Dates: ${(slots.available_dates || []).join(", ")}
- Agent Summary: ${slots.agent_summary || ""}
` : ""}
IMPORTANT — EACH TEXT IS INDEPENDENT (NO CONVERSATION MEMORY):
Each incoming text is processed independently. You have NO memory of previous messages.
You must determine intent from THIS single message combined with the work order status and data above.

CRITICAL RULE — STATUS-AWARE RESPONSES:

If Status is "Scheduled":
- For greetings ("hi", "hello", "hey") or vague messages: Say "Hi [name], we have your [appliance] [job type] scheduled for [date] between [window]. How can I help you?" Action: "info"
- For date mentions ("Monday", "the 7th", "April 10") or "yes" or "that works": This means they want to RESCHEDULE to that date. Convert to YYYY-MM-DD, verify it is in the Available Dates list, and return action "book". They are changing their appointment.
- For "reschedule" or "change my appointment": Offer the first 3 available dates. Action: "reschedule"

If Status is "Parts Have Arrived":
- For greetings: Say "Hi [name], your parts have arrived for your [appliance] service at [address]! Would you like to schedule?" Action: "info"
- For date mentions or "yes": They want to book. Convert to YYYY-MM-DD and return action "book".
- For "schedule" or "when can you come": Offer first 3 available dates. Action: "info"

If Status is "Parts Ordered":
- Say "Hi [name], parts for your [appliance] at [address] have been ordered. We will reach out when they arrive." Action: "info"

If Status is "New":
- For greetings: Say "Hi [name], we have your [appliance] service at [address]. Would you like to schedule?" Action: "info"
- For date mentions: Convert and return action "book".
- For "schedule" or "when": Offer first 3 available dates. Action: "info"

If Status is "Complete":
- Say "Hi [name], your [appliance] service is complete. How can I help you?" Action: "info"

RULES:
- The time window is FIXED based on ZIP code and CANNOT be changed
- Keep SMS replies to 2-3 sentences max
- Do NOT use contractions
- When listing dates, list only the first 3 then say "We have more dates available after that as well."
- NEVER return "book" for a date not in the Available Dates list. If the date they mention is NOT in the list, return "info" with available dates instead.
- Always include the customer's name and appliance type
- "yes", "ok", "sure", "that works" when Status is "Scheduled" or "Parts Have Arrived" with available dates = they want the EARLIEST available date. Return action "book" with the first date from Available Dates.

ACTIONS — return JSON:

1. "book" — Customer chose a date OR confirmed with "yes"/"ok". Return: {"action": "book", "chosen_date": "YYYY-MM-DD", "tech_id": "${slots?.tech_id || ""}", "reply": "confirmation message with date, window, and address"}
2. "info" — Greetings, general questions, or status acknowledgment. Return: {"action": "info", "reply": "status-aware response"}
3. "reschedule" — Explicitly asks to reschedule. Return: {"action": "reschedule", "reply": "offer first 3 available dates with window"}
4. "status" — Asking about appointment or tech ETA. Return: {"action": "status", "reply": "appointment details"}
5. "callback" — Same issue after repair. Return: {"action": "callback", "reply": "contact warranty company for recall"}
6. "escalate" — Wants a human. Return: {"action": "escalate", "reply": "we will have someone reach out"}
7. "cancel" — Wants to cancel. Return: {"action": "cancel", "reply": "cancellation confirmed"}
8. "optout" — STOP/unsubscribe. Return: {"action": "optout", "reply": "No problem! Text us back or call (855) 269-3196."}
9. "unclear" — Truly cannot determine intent. Return: {"action": "unclear", "reply": "friendly prompt to clarify"}

Return ONLY valid JSON.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await res.json();
    const rawText = data.content?.[0]?.text || "";

    // Extract JSON from response
    const jsonStart = rawText.indexOf("{");
    if (jsonStart === -1) {
      return { action: "unclear", reply: "Thanks for reaching out! Please call us at (855) 269-3196." };
    }

    let depth = 0;
    let jsonEnd = jsonStart;
    for (let i = jsonStart; i < rawText.length; i++) {
      if (rawText[i] === "{") depth++;
      else if (rawText[i] === "}") {
        depth--;
        if (depth === 0) { jsonEnd = i + 1; break; }
      }
    }

    const parsed = JSON.parse(rawText.slice(jsonStart, jsonEnd));

    // Server-side guard: reject book action for unavailable dates
    if (parsed.action === "book" && parsed.chosen_date) {
      const availDates = slots?.available_dates || [];
      if (!availDates.includes(parsed.chosen_date)) {
        const first3 = availDates.slice(0, 3);
        const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        const dateStr = first3.map((d: string) => {
          const dt = new Date(d + "T12:00:00");
          return `${months[dt.getMonth()]} ${dt.getDate()}`;
        }).join(", ");
        return {
          action: "info",
          reply: `Sorry, that date is not available. We have openings on ${dateStr}. We have more dates available after that as well. Which day works for you?`,
        };
      }
    }

    return {
      action: parsed.action || "unclear",
      reply: parsed.reply || "Thanks for reaching out! Please call us at (855) 269-3196.",
      chosen_date: parsed.chosen_date,
      tech_id: parsed.tech_id,
    };
  } catch (err) {
    console.error("[SMS] Claude API error:", err);
    return { action: "unclear", reply: "We are having trouble right now. Please call us at (855) 269-3196." };
  }
}
