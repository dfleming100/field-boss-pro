import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/sms/status
 * Twilio StatusCallback webhook. Updates sms_conversations.status
 * for the matching MessageSid.
 * Twilio statuses: queued, sending, sent, delivered, undelivered, failed
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const messageSid = formData.get("MessageSid")?.toString() || "";
    const status = formData.get("MessageStatus")?.toString() || "";
    const errorCode = formData.get("ErrorCode")?.toString() || null;
    const errorMessage = formData.get("ErrorMessage")?.toString() || null;

    if (!messageSid) {
      return NextResponse.json({ ok: false, error: "missing MessageSid" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    await sb
      .from("sms_conversations")
      .update({
        status,
        error_code: errorCode,
        error_message: errorMessage,
      })
      .eq("message_sid", messageSid);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[SMS status] error:", error);
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
