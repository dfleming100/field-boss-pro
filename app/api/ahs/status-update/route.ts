import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/ahs/status-update
 * Sends status updates FROM Field Boss TO AHS (Frontdoor Dispatch Connector API).
 * Called when a work order status changes and the WO has a warranty_link with provider=AHS.
 *
 * Auth: OAuth2 password grant via FusionAuth → Bearer token.
 *
 * Body: { work_order_id, tenant_id, new_status, start_time?, end_time?, note? }
 */

// Map Field Boss statuses to AHS status codes.
// "New" is intentionally omitted — AHS already knows the dispatch is new
// (they sent it to us), so there's no value in echoing it back.
const FB_TO_AHS_STATUS: Record<string, { code: string; description: string }> = {
  "Scheduled": { code: "30", description: "Appointment Set" },
  "Parts Ordered": { code: "100", description: "In Progress With Parts on Order" },
  "Parts Have Arrived": { code: "160", description: "Parts/Equipment Status" },
  "Complete": { code: "10", description: "Job Completed" },
};

// In-memory token cache keyed by tenant_id
const tokenCache: Record<number, { token: string; expiresAt: number }> = {};

async function getAhsToken(creds: any, tenantId: number): Promise<string> {
  const cached = tokenCache[tenantId];
  if (cached && cached.expiresAt > Date.now() + 60 * 1000) {
    return cached.token;
  }

  const tokenUrl = creds.api_token_url || "https://frontdoorhome-dev.fusionauth.io/oauth2/token";

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: creds.grant_type || "password",
      client_id: creds.client_id,
      username: creds.username,
      password: creds.password,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`AHS token failed: ${data.error_description || data.error || res.statusText}`);
  }

  const expiresAt = Date.now() + (data.expires_in || 7200) * 1000;
  tokenCache[tenantId] = { token: data.access_token, expiresAt };
  return data.access_token;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { work_order_id, tenant_id, new_status, start_time, end_time, note } = body;

    if (!work_order_id || !tenant_id) {
      return NextResponse.json({ error: "work_order_id and tenant_id required" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // Look up via warranty_links first, fall back to ahs_dispatch_id on work_orders
    let dispatchId: string | null = null;
    let externalOrg = "AHS";
    let vendorId = "";

    const { data: link } = await sb
      .from("warranty_links")
      .select("external_id, external_org")
      .eq("work_order_id", work_order_id)
      .eq("provider", "AHS")
      .maybeSingle();

    if (link) {
      dispatchId = link.external_id;
      externalOrg = link.external_org || "AHS";
    } else {
      // Fall back to legacy ahs_dispatch_id column
      const { data: wo } = await sb
        .from("work_orders")
        .select("ahs_dispatch_id, ahs_external_org")
        .eq("id", work_order_id)
        .eq("tenant_id", tenant_id)
        .single();

      if (!wo?.ahs_dispatch_id) {
        return NextResponse.json({ skipped: true, reason: "Not an AHS dispatch" });
      }
      dispatchId = wo.ahs_dispatch_id.toString();
      externalOrg = wo.ahs_external_org || "AHS";
    }

    // Fetch work order details for the payload
    const { data: wo } = await sb
      .from("work_orders")
      .select("id, appliance_type, work_order_number")
      .eq("id", work_order_id)
      .single();

    if (!wo) {
      return NextResponse.json({ error: "Work order not found" }, { status: 404 });
    }

    // Get AHS integration credentials
    const { data: integration } = await sb
      .from("tenant_integrations")
      .select("encrypted_keys")
      .eq("tenant_id", tenant_id)
      .eq("integration_type", "ahs")
      .eq("is_configured", true)
      .maybeSingle();

    if (!integration) {
      return NextResponse.json({ skipped: true, reason: "AHS integration not configured" });
    }

    const creds = integration.encrypted_keys as any;
    const apiUrl = creds.api_url || "https://api.sandbox.frontdoorhome.com/dispatch-connector/v1/webhook";
    vendorId = creds.vendor_id || "";

    // Check we have OAuth credentials
    if (!creds.client_id || !creds.username || !creds.password) {
      return NextResponse.json({ skipped: true, reason: "AHS OAuth credentials not configured" });
    }

    const ahsStatus = FB_TO_AHS_STATUS[new_status];
    if (!ahsStatus) {
      return NextResponse.json({ skipped: true, reason: `No AHS mapping for status: ${new_status}` });
    }

    // Get OAuth Bearer token
    const token = await getAhsToken(creds, tenant_id);

    // Build AHS status update payload
    const ahsPayload: any = {
      data: [
        {
          type: "status",
          object: {
            source: "DISPATCH_ME",
            tenant: externalOrg,
            vendor_id: vendorId,
            dispatch_id: parseInt(dispatchId || "0"),
            description: ahsStatus.description,
            status_code: ahsStatus.code,
            updated_at: new Date().toISOString(),
            items: wo.appliance_type
              ? [{ description: wo.appliance_type }]
              : [],
          },
        },
      ],
    };

    // Add appointment times if scheduling
    if (new_status === "Scheduled" && start_time) {
      ahsPayload.data[0].object.start_time = start_time;
      ahsPayload.data[0].object.end_time = end_time || start_time;
    }

    // Add note if provided
    if (note) {
      ahsPayload.data[0].object.note = note;
    }

    // Send to AHS Dispatch Connector API
    const ahsRes = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ahsPayload),
    });

    const ahsData = await ahsRes.json().catch(() => ({}));

    // Log the sync attempt to warranty_sync_log
    await sb.from("warranty_sync_log").insert({
      tenant_id,
      work_order_id: wo.id,
      provider: "AHS",
      direction: "outbound",
      operation: `status_${new_status}`,
      external_id: dispatchId,
      status_code: ahsStatus.code,
      status_description: ahsStatus.description,
      processed: ahsRes.ok,
      error_message: ahsRes.ok ? null : JSON.stringify(ahsData),
      raw_payload: ahsPayload,
    });

    return NextResponse.json({
      success: ahsRes.ok,
      ahs_status_code: ahsStatus.code,
      ahs_status_description: ahsStatus.description,
      dispatch_id: dispatchId,
    });
  } catch (error) {
    console.error("[AHS] Status update error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
