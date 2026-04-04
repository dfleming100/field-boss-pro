import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import twilio from "twilio";

/**
 * POST /api/twilio/token
 * Generates a Twilio Access Token for browser-based calling.
 * Body: { tenant_id, identity }
 */
export async function POST(request: NextRequest) {
  try {
    const { tenant_id, identity } = await request.json();

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
    const twimlAppSid = creds.twimlAppSid;
    const apiKeySid = creds.apiKeySid;
    const apiKeySecret = creds.apiKeySecret;

    // If we have API keys (preferred), use them
    // Otherwise fall back to account-level token
    if (apiKeySid && apiKeySecret && twimlAppSid) {
      const AccessToken = twilio.jwt.AccessToken;
      const VoiceGrant = AccessToken.VoiceGrant;

      const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
        identity: identity || "field-boss-user",
      });

      const voiceGrant = new VoiceGrant({
        outgoingApplicationSid: twimlAppSid,
        incomingAllow: false,
      });

      token.addGrant(voiceGrant);

      return NextResponse.json({
        token: token.toJwt(),
        identity: identity || "field-boss-user",
      });
    }

    // If no API keys yet, return setup instructions
    return NextResponse.json({
      error: "Twilio API keys not configured",
      setup: {
        step1: "Go to Twilio Console → Account → API Keys → Create new key",
        step2: "Save the SID and Secret",
        step3: "Go to Twilio Console → Voice → TwiML Apps → Create new app",
        step4: "Set Voice Request URL to: https://field-boss-pro.vercel.app/api/twilio/twiml",
        step5: "Save the TwiML App SID",
        step6: "Store apiKeySid, apiKeySecret, twimlAppSid in tenant_integrations",
      },
    }, { status: 400 });
  } catch (error) {
    console.error("Twilio token error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
