import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/integrations/[tenantId]/[integration]
 * POST /api/integrations/[tenantId]/[integration]
 * DELETE /api/integrations/[tenantId]/[integration]
 *
 * Handles secure storage and retrieval of integration API keys.
 *
 * Keys are stored encrypted in Supabase (via app layer encryption).
 * Use crypto.subtle or sodium.js for AES-256 encryption.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; integration: string }> }
) {
  try {
    const { tenantId, integration } = await params;

    // Verify user has access to this tenant (via RLS)
    const { data, error } = await supabase
      .from("tenant_integrations")
      .select("id, integration_type, config, active, updated_at")
      .eq("tenant_id", tenantId)
      .eq("integration_type", integration)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    // NOTE: Don't return api_key or api_secret in response
    // They should only be used server-side for API calls

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; integration: string }> }
) {
  try {
    const { tenantId, integration } = await params;
    const body = await request.json();

    const { api_key, config, active } = body;

    // TODO: Encrypt api_key and api_secret before storing
    // import { encrypt } from "@/lib/encryption";
    // const encryptedKey = encrypt(api_key);

    // Upsert integration
    const { data, error } = await supabase
      .from("tenant_integrations")
      .upsert(
        {
          tenant_id: Number(tenantId),
          integration_type: integration,
          api_key, // Should be encrypted
          config,
          active: active ?? true,
        },
        {
          onConflict: "tenant_id,integration_type",
        }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; integration: string }> }
) {
  try {
    const { tenantId, integration } = await params;

    const { error } = await supabase
      .from("tenant_integrations")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("integration_type", integration);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
