import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/mobile/register-push-token
 * Body: { auth_uid: string, push_token: string, platform?: "ios"|"android" }
 * Stores the Expo push token on the matching tenant_users row.
 */
export async function POST(request: NextRequest) {
  try {
    const { auth_uid, push_token, platform } = await request.json();

    if (!auth_uid || !push_token) {
      return NextResponse.json({ error: "auth_uid and push_token required" }, { status: 400 });
    }
    if (!push_token.startsWith("ExponentPushToken")) {
      return NextResponse.json({ error: "invalid push token format" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const { error } = await sb
      .from("tenant_users")
      .update({
        push_token,
        push_platform: platform || null,
        push_token_updated_at: new Date().toISOString(),
      })
      .eq("auth_uid", auth_uid);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "unknown error" }, { status: 500 });
  }
}
