import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/sms/incoming
 * Twilio webhook — receives inbound SMS from customers.
 * Full processing loop:
 * 1. Resolve tenant from Twilio "To" phone number
 * 2. Look up customer in Supabase by phone
 * 3. Find active work order
 * 4. Get available slots
 * 5. Send context to Claude Haiku for intent classification
 * 6. Take action (book, reply info, etc.)
 * 7. Send reply SMS via Twilio
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://field-boss-pro.vercel.app";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const from = formData.get("From")?.toString() || "";
    const to = formData.get("To")?.toString() || "";
    const body = formData.get("Body")?.toString() || "";
    const messageSid = formData.get("MessageSid")?.toString() || "";
    const numMedia = parseInt(formData.get("NumMedia")?.toString() || "0", 10);
    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const url = formData.get(`MediaUrl${i}`)?.toString();
      if (url) mediaUrls.push(url);
    }

    console.log(`[SMS] From: ${from}, To: ${to}, Body: "${body}", Media: ${numMedia}`);

    const sb = supabaseAdmin();

    // ── Resolve tenant from the Twilio "To" phone number ──
    const toDigits = to.replace(/\D/g, "");
    let tenantId: number | null = null;
    let twilioIntegration: any = null;
    let tenantInfo: { name: string; phone: string } = { name: "", phone: "" };

    const { data: allTwilio } = await sb
      .from("tenant_integrations")
      .select("tenant_id, encrypted_keys")
      .eq("integration_type", "twilio")
      .eq("is_configured", true);

    for (const row of allTwilio || []) {
      const storedPhone = ((row.encrypted_keys as any)?.phoneNumber || "").replace(/\D/g, "");
      if (storedPhone && toDigits.endsWith(storedPhone.slice(-10))) {
        tenantId = row.tenant_id;
        twilioIntegration = row;
        break;
      }
    }

    if (!tenantId) {
      console.error(`[SMS] No tenant found for To number: ${to}`);
      tenantId = 1; // fallback
    }

    // Fetch tenant info for dynamic prompt
    const { data: tenant } = await sb
      .from("tenants")
      .select("name, phone")
      .eq("id", tenantId)
      .single();

    if (tenant) {
      tenantInfo = { name: tenant.name || "", phone: tenant.phone || "" };
    }

    // Normalize phone
    const fromDigits = from.replace(/\D/g, "");
    const searchDigits = fromDigits.length === 11 && fromDigits.startsWith("1")
      ? fromDigits.slice(1)
      : fromDigits;

    // Store inbound message in conversation history
    await sb.from("sms_conversations").insert({
      tenant_id: tenantId,
      phone: from,
      direction: "inbound",
      body,
      message_sid: messageSid,
      media_urls: mediaUrls.length ? mediaUrls : null,
      status: "received",
    });

    // ── STOP / HELP / START keyword handling (compliance) ──
    const trimmed = body.trim().toUpperCase();
    const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
    const START_WORDS = ["START", "UNSTOP", "YES"];
    const HELP_WORDS = ["HELP", "INFO"];

    if (STOP_WORDS.includes(trimmed)) {
      await sb.from("sms_optouts").upsert(
        { tenant_id: tenantId, phone: from, keyword: trimmed },
        { onConflict: "tenant_id,phone" }
      );
      // Twilio auto-sends STOP confirmation; we stay silent.
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
        { status: 200, headers: { "Content-Type": "text/xml" } }
      );
    }

    if (trimmed === "START" || trimmed === "UNSTOP") {
      await sb.from("sms_optouts").delete().eq("tenant_id", tenantId).eq("phone", from);
    }

    if (HELP_WORDS.includes(trimmed)) {
      await sendTwilioSms(sb, tenantId, from, `${tenantInfo.name || "Field Boss Pro"}: Reply STOP to opt out. Msg&data rates may apply. Call ${tenantInfo.phone || "us"} for help.`);
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
        { status: 200, headers: { "Content-Type": "text/xml" } }
      );
    }

    // If opted out and not a START word, do not reply
    if (!START_WORDS.includes(trimmed)) {
      const { data: optout } = await sb
        .from("sms_optouts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("phone", from)
        .maybeSingle();
      if (optout) {
        return new NextResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
          { status: 200, headers: { "Content-Type": "text/xml" } }
        );
      }
    }

    // ── AI-pause check: if a tenant user took over the thread, skip Claude ──
    const { data: threadState } = await sb
      .from("sms_thread_state")
      .select("ai_paused")
      .eq("tenant_id", tenantId)
      .eq("phone", from)
      .maybeSingle();

    if (threadState?.ai_paused) {
      console.log(`[SMS] Thread paused for ${from}, skipping AI reply`);
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
        { status: 200, headers: { "Content-Type": "text/xml" } }
      );
    }

    // Fetch recent conversation history (last 10 messages, filtered by tenant)
    const { data: convHistory } = await sb
      .from("sms_conversations")
      .select("direction, body, created_at")
      .eq("phone", from)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(10);

    // Build conversation thread (oldest first)
    const companyLabel = tenantInfo.name || "Company";
    const conversationThread = (convHistory || [])
      .reverse()
      .map((msg: any) => `${msg.direction === "inbound" ? "Customer" : companyLabel}: ${msg.body}`)
      .join("\n");

    // 0. Fetch tenant's serviced appliances from skills table
    const { data: skillsData } = await sb
      .from("tech_skills")
      .select("appliance_type")
      .eq("tenant_id", tenantId);
    const servicedAppliances = [...new Set((skillsData || []).map((s: any) => s.appliance_type))].join(", ");

    // 1. Customer lookup in Supabase (pass tenant_id)
    const lookupRes = await fetch(`${APP_URL}/api/vapi/customer-lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: searchDigits, tenant_id: tenantId }),
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
    const aiResult = await classifyIntent(body, customerData, slotsData, conversationThread, servicedAppliances, tenantInfo);

    // 4. Take action
    let replyText = aiResult.reply;

    // Handle new customer creation
    if (aiResult.action === "new_customer" && aiResult.customer_name && aiResult.appliance_type) {
      try {
        const createRes = await fetch(`${APP_URL}/api/sms/create-customer-wo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenant_id: tenantId,
            phone: from,
            customer_name: aiResult.customer_name,
            service_address: aiResult.service_address || "",
            city: aiResult.city || "",
            state: aiResult.state || "",
            zip: aiResult.zip || "",
            appliance_type: aiResult.appliance_type,
          }),
        });
        const createData = await createRes.json();
        if (createData.success) {
          // Now get slots for the new WO
          const newSlotsRes = await fetch(`${APP_URL}/api/vapi/get-available-slots`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ work_order_number: createData.work_order_number }),
          });
          const newSlots = await newSlotsRes.json();
          replyText = aiResult.reply + (newSlots.agent_summary ? ` ${newSlots.agent_summary}` : "");
        }
      } catch {}
    }

    // Handle new WO for existing customer (different appliance)
    if (aiResult.action === "new_wo" && aiResult.appliance_type && customerData.found) {
      try {
        const createRes = await fetch(`${APP_URL}/api/sms/create-customer-wo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenant_id: tenantId,
            phone: from,
            existing_customer_id: customerData.customer_id,
            appliance_type: aiResult.appliance_type,
          }),
        });
        const createData = await createRes.json();
        if (createData.success) {
          const newSlotsRes = await fetch(`${APP_URL}/api/vapi/get-available-slots`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ work_order_number: createData.work_order_number }),
          });
          const newSlots = await newSlotsRes.json();
          replyText = aiResult.reply + (newSlots.agent_summary ? ` ${newSlots.agent_summary}` : "");
        }
      } catch {}
    }

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
          replyText = `Sorry, that date is not available. ${slotsData?.agent_summary || `Please call us at ${tenantInfo.phone || "the office"}.`}`;
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
    // Use the already-found integration, or look it up
    if (!twilioIntegration) {
      const { data: integration } = await sb
        .from("tenant_integrations")
        .select("encrypted_keys")
        .eq("tenant_id", tenantId)
        .eq("integration_type", "twilio")
        .eq("is_configured", true)
        .single();
      twilioIntegration = integration;
    }

    if (twilioIntegration && replyText) {
      const creds = twilioIntegration.encrypted_keys as any;
      const statusCallback = `${APP_URL}/api/sms/status`;
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`;
      const basicAuth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");

      const twilioParams: Record<string, string> = {
        From: creds.phoneNumber,
        To: from,
        Body: replyText,
        StatusCallback: statusCallback,
      };

      const twilioRes = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(twilioParams),
      });
      const twilioData: any = await twilioRes.json().catch(() => ({}));

      // Store outbound in conversation history
      await sb.from("sms_conversations").insert({
        tenant_id: tenantId,
        phone: from,
        direction: "outbound",
        body: replyText,
        message_sid: twilioData.sid || null,
        status: twilioData.status || "queued",
      });

      // Log outbound
      await sb.from("sms_logs").insert({
        tenant_id: tenantId,
        recipient_phone: from,
        message_type: `reply_${aiResult.action}`,
        status: "sent",
        error_message: JSON.stringify({ action: aiResult.action, reply_preview: replyText.substring(0, 100) }),
      });
    }

    // Log inbound
    await sb.from("sms_logs").insert({
      tenant_id: tenantId,
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

async function sendTwilioSms(sb: any, tenantId: number, toPhone: string, body: string) {
  const { data: integration } = await sb
    .from("tenant_integrations")
    .select("encrypted_keys")
    .eq("tenant_id", tenantId)
    .eq("integration_type", "twilio")
    .eq("is_configured", true)
    .single();
  if (!integration) return;
  const creds = integration.encrypted_keys as any;
  const statusCallback = `${APP_URL}/api/sms/status`;
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`;
  const basicAuth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
  const res = await fetch(twilioUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: creds.phoneNumber, To: toPhone, Body: body, StatusCallback: statusCallback }),
  });
  const data: any = await res.json().catch(() => ({}));
  await sb.from("sms_conversations").insert({
    tenant_id: tenantId,
    phone: toPhone,
    direction: "outbound",
    body,
    message_sid: data.sid || null,
    status: data.status || "queued",
  });
}

async function classifyIntent(
  smsBody: string,
  customer: any,
  slots: any,
  conversationThread?: string,
  servicedAppliances?: string,
  tenantInfo?: { name: string; phone: string }
): Promise<{ action: string; reply: string; chosen_date?: string; tech_id?: string; customer_name?: string; service_address?: string; city?: string; state?: string; zip?: string; appliance_type?: string }> {
  const companyName = tenantInfo?.name || "our company";
  const companyPhone = tenantInfo?.phone || "the office";

  if (!ANTHROPIC_API_KEY) {
    return { action: "unclear", reply: `Thanks for reaching out! Please call us at ${companyPhone}.` };
  }

  const isNewCustomer = !customer.found;

  const wo = customer.active_wo || {};
  const today = new Date().toISOString().split("T")[0];
  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const todayName = dayNames[new Date().getDay()];

  const prompt = `You are a friendly SMS assistant for ${companyName}. Return ONLY valid JSON. No markdown, no backticks.

Today: ${today} (${todayName})
${conversationThread ? `
CONVERSATION HISTORY (most recent messages):
${conversationThread}

The LATEST message from the customer is what you are responding to. Use the conversation history to understand context — for example, if ${companyName} just offered dates and the customer says "yes" or "the 7th", they are responding to that offer.
` : ""}
LATEST MESSAGE FROM CUSTOMER: "${smsBody}"
IS NEW CUSTOMER (not in our system): ${isNewCustomer ? "YES" : "NO"}
CUSTOMER NAME: ${customer.customer_name || "unknown"}
CUSTOMER ADDRESS: ${customer.address || "unknown"}

APPLIANCES WE SERVICE: ${servicedAppliances || "all major appliances"}
IMPORTANT: Only mention appliances from the list above. If a customer asks about an appliance NOT on this list, say "We do not service that appliance type. We specialize in ${servicedAppliances}."

${isNewCustomer ? `
NEW CUSTOMER FLOW:
This person is NOT in our system. You need to collect their info to create an account and schedule them.
- If they haven't provided their name yet, ask: "What is your name?"
- If they haven't provided their address yet, ask: "What is your service address?"
- If they haven't provided which appliance needs service, ask: "Which appliance needs service?"
- Once you have name + address + appliance, return action "new_customer" with all the info.
- Use conversation history to check if they already provided any of this info in previous messages.
` : `
EXISTING CUSTOMER — NEW APPLIANCE FLOW:
If the customer asks about scheduling service for a DIFFERENT appliance than what is on their current work order, return action "new_wo" to create a new work order for the new appliance. Do NOT move their existing work order to a different appliance.
Current WO appliance: ${wo.appliance_type || "none"}
If the customer mentions a different appliance (e.g., WO is Washer but they ask about Microwave), use action "new_wo".

NO ACTIVE WORK ORDER FLOW:
If Work Order is "none" (the customer has no active or open work order — all previous work is complete), do NOT offer to schedule any existing work. The conversation history may reference older completed jobs — IGNORE those; they are done.
- For greetings ("hi", "hello"): Reply "Hi [name]! What can we help you with today?" Action: "info"
- If the customer mentions a specific appliance needing service, return action "new_wo" with that appliance_type to open a new work order.
- If the customer asks about scheduling without specifying an appliance, ask "Which appliance needs service?" Action: "info"
- NEVER say "we are ready to schedule your [appliance]" when Work Order is "none".
`}

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
CONVERSATION CONTEXT:
Use the conversation history above to understand follow-up messages. If the customer says "yes", "the 7th", "ok", etc., look at what ${companyName} last said to understand what they are responding to.

CRITICAL RULE — STATUS-AWARE RESPONSES:

If Status is "Scheduled":
- For greetings ("hi", "hello", "hey") or vague messages: Say "Hi [name], we have your [appliance] [job type] scheduled for [date] between [window]. Let us know if you need to reschedule or have any questions." Action: "info"
- For EXPLICIT date mentions ("Monday", "the 7th", "April 10") that differ from the current appointment: This means they want to RESCHEDULE to that date. Convert to YYYY-MM-DD, verify it is in the Available Dates list, and return action "book".
- For "reschedule" or "change my appointment": Offer the first 3 available dates. Action: "reschedule"
- For ambiguous replies like "yes", "ok", "sure", "schedule it", "let's schedule": The customer is ALREADY scheduled — do NOT reschedule. Instead reply "Hi [name], you already have your [appliance] appointment on [date] between [window]. Would you like to keep this appointment or pick a different day?" Action: "info"

If Status is "Parts Have Arrived":
- For greetings: Say "Hi [name], your parts have arrived for your [appliance] service at [address]! Would you like to schedule?" Action: "info"
- For date mentions or "yes": They want to book. Convert to YYYY-MM-DD and return action "book".
- For "schedule" or "when can you come": Offer first 3 available dates. Action: "info"

If Status is "Parts Ordered":
- For greetings or general check-in: "Hi [name], I see your parts for your [appliance] at [address] have been ordered but have not arrived yet. We will reach out to you as soon as they arrive." Action: "info"
- For "when will parts arrive" or "parts status": Same response. Action: "info"

If Status is "New":
- For greetings: Say "Hi [name], we have your [appliance] service at [address]. Would you like to schedule?" Action: "info"
- For date mentions: Convert and return action "book".
- For "schedule", "when", or ANY affirmative reply ("ok", "yes", "sure", "let's schedule", "yes let's schedule"): Offer the first 3 available dates from the Available Dates list with the time window. Say "We have openings on [date1], [date2], and [date3] between [window]. Which day works best for you?" Action: "info"
- CRITICAL: The WO is NEW — the customer does NOT have an appointment yet. NEVER say "you already have an appointment" or "appointment scheduled" when status is New. There is no appointment to confirm.

If Status is "Complete":
- Say "Hi [name], your [appliance] service is complete. How can I help you?" Action: "info"

INTENT-SPECIFIC RESPONSES:

PRICING — "How much?", "What do you charge?", "What are your rates?"
Reply: "Hi [name], our diagnostic fee is $75. If you choose to continue with the repair, the diagnostic fee is waived. Labor is $125 plus the cost of any parts needed. Would you like to schedule your appointment?"
Action: "info"

ETA / TECH STATUS — "Where is the tech?", "Is the tech running late?", "When will they arrive?"
Reply: Read back their appointment date and time window, then say "Your tech should be arriving within your scheduled time window. I will notify your tech of your concern."
Action: "status"

CONFIRM APPOINTMENT — "Just confirming", "Am I still on for tomorrow?"
Reply: Read back their full appointment details — date, time window, tech name, address.
Action: "status"

DIFFERENT TIME OF DAY REQUEST — Customer asks for a time OUTSIDE the tech's window. Examples: "after 10:30am", "before 9am", "can you come at 2pm", "I need an afternoon appointment", "mornings do not work", "anything later in the day".
This is NOT a reschedule — it is a time-of-day constraint we cannot satisfy. The window is locked by ZIP routing.
Reply: "Hi [name], our tech comes to your area between [window_start] and [window_end]. We can do any available weekday but that is the only time window we can offer. We have openings on [date1], [date2], and [date3]. Which day works for you?"
Action: "info"

CUSTOMER RUNNING LATE — "I am running late", "I will be 10 minutes late", "I am not home yet"
Reply: "No problem, [name]. Your technician will do his best to accommodate you. I will notify the office that you are running late."
Action: "info"

REVIEW RESPONSE — Customer replies with a number 1-5 (responding to a review request)
- If 4 or 5: Reply "Thank you so much, [name]! We really appreciate your feedback. If you have a moment, we would love a Google review!" Action: "review"
- If 1, 2, or 3: Reply "Thank you for your feedback, [name]. We appreciate you letting us know." Action: "review"

PARTS STATUS — "When will my parts come?", "Any update on parts?"
Look at the WO status:
- If "Parts Ordered": "Hi [name], I see your parts for your [appliance] have been ordered but have not arrived yet. We will reach out to you as soon as they arrive."
- If "Parts Have Arrived": "Hi [name], your parts have arrived! Would you like to schedule your repair?"
Action: "info"

BUSINESS HOURS — "What are your hours?", "Are you open?", "When do you open?"
Reply: "Hi [name], our office hours are Monday through Friday, 8am to 5pm. How can I help you?"
Action: "info"

SERVICE AREA — "Do you service my area?", "What area do you cover?", "Do you come to [city]?"
Reply: "Hi [name], give me your ZIP code and I can check if we service your area!"
Action: "info"

CALLBACK / SAME ISSUE — "It is doing the same thing", "It broke again", "Same problem"
Reply: "We are sorry to hear your [appliance] is still having issues, [name]. Please contact your home warranty company and request a recall for ${companyName}. Once they issue the recall, we will get you scheduled right away. If you have any questions, call us at ${companyPhone}."
Action: "callback"

ESCALATE — "I want to talk to someone", "I want a manager"
Reply: "We understand your concern, [name]. We will forward your message to our team and someone will reach out to you. You can also reach us directly at ${companyPhone}."
Action: "escalate"

CANCEL — "Cancel my appointment", "I do not need service"
Reply: "No problem, [name]. We have noted your cancellation request for your [appliance] service. If you change your mind or need anything in the future, just text us or call ${companyPhone}."
Action: "cancel"

OPT OUT — "STOP", "unsubscribe"
Reply: "No problem! If you change your mind, just text us back or call ${companyPhone}."
Action: "optout"

GENERAL RULES:
- The time window is FIXED based on ZIP code and CANNOT be changed
- Keep SMS replies to 2-3 sentences max
- Do NOT use contractions
- When listing dates, list only the first 3 then say "We have more dates available after that as well."
- NEVER return "book" for a date not in the Available Dates list. If the date they mention is NOT in the list, return "info" with available dates instead.
- Always include the customer's name
- "yes", "ok", "sure", "that works" ONLY count as booking intent if Company just offered specific dates in the previous message. Check the CONVERSATION HISTORY — if Company's most recent message offered dates, return action "book" with the first Available Date. If there was NO recent date offer, treat "yes" as ambiguous and respond with action "info" asking what they want to do.

ACTIONS — return JSON:

1. "book" — Customer chose a date OR confirmed with "yes"/"ok". Return: {"action": "book", "chosen_date": "YYYY-MM-DD", "tech_id": "${slots?.tech_id || ""}", "reply": "confirmation message with date, window, and address"}
2. "info" — Greetings, pricing, general questions, running late, parts status. Return: {"action": "info", "reply": "helpful response"}
3. "reschedule" — Explicitly asks to reschedule. Return: {"action": "reschedule", "reply": "offer first 3 available dates with window"}
4. "status" — Asking about appointment, tech ETA, or confirming. Return: {"action": "status", "reply": "appointment details"}
5. "new_customer" — New person not in system, and you have collected their name + address + appliance from the conversation. Return: {"action": "new_customer", "customer_name": "John Smith", "service_address": "123 Main St", "city": "Frisco", "state": "TX", "zip": "75034", "appliance_type": "Washer", "reply": "Great, I have you set up! Let me check availability for your [appliance] service."}
6. "new_wo" — Existing customer asking about a DIFFERENT appliance than their current WO. Return: {"action": "new_wo", "appliance_type": "Microwave", "reply": "I will set up a new service order for your Microwave. Let me check availability."}
7. "callback" — Same issue after repair. Return: {"action": "callback", "reply": "contact warranty company for recall"}
8. "escalate" — Wants a human. Return: {"action": "escalate", "reply": "we will forward to team"}
9. "cancel" — Wants to cancel. Return: {"action": "cancel", "reply": "cancellation confirmed"}
10. "review" — Reply to a review request (number 1-5). Return: {"action": "review", "reply": "thank you message"}
11. "optout" — STOP/unsubscribe. Return: {"action": "optout", "reply": "opted out message"}
12. "unclear" — Truly cannot determine intent. Return: {"action": "unclear", "reply": "friendly prompt to clarify"}

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
      return { action: "unclear", reply: `Thanks for reaching out! Please call us at ${companyPhone}.` };
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
      reply: parsed.reply || `Thanks for reaching out! Please call us at ${companyPhone}.`,
      chosen_date: parsed.chosen_date,
      tech_id: parsed.tech_id,
      customer_name: parsed.customer_name,
      service_address: parsed.service_address,
      city: parsed.city,
      state: parsed.state,
      zip: parsed.zip,
      appliance_type: parsed.appliance_type,
    };
  } catch (err) {
    console.error("[SMS] Claude API error:", err);
    return { action: "unclear", reply: `We are having trouble right now. Please call us at ${companyPhone}.` };
  }
}
