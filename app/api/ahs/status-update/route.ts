import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/ahs/status-update
 * Sends status updates FROM Field Boss TO AHS (Frontdoor Dispatch Connector API).
 * Called when a work order status changes and the WO has an ahs_dispatch_id.
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { work_order_id, tenant_id, new_status, start_time, end_time, note } = body;

    if (!work_order_id || !tenant_id) {
      return NextResponse.json({ error: "work_order_id and tenant_id required" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // Fetch work order with AHS info
    const { data: wo } = await sb
      .from("work_orders")
      .select("id, ahs_dispatch_id, ahs_external_org, appliance_type, work_order_number")
      .eq("id", work_order_id)
      .eq("tenant_id", tenant_id)
      .single();

    if (!wo || !wo.ahs_dispatch_id) {
      return NextResponse.json({ skipped: true, reason: "Not an AHS dispatch" });
    }

    // Get AHS integration credentials
    const { data: integration } = await sb
      .from("tenant_integrations")
      .select("encrypted_keys")
      .eq("tenant_id", tenant_id)
      .eq("integration_type", "ahs")
      .eq("is_configured", true)
      .single();

    if (!integration) {
      return NextResponse.json({ skipped: true, reason: "AHS integration not configured" });
    }

    const creds = integration.encrypted_keys as any;
    const apiToken = creds.api_token || creds.apiToken || "";
    const apiUrl = creds.api_url || creds.apiUrl || "https://api.frontdoorhome.com";
    const vendorId = creds.vendor_id || creds.vendorId || "";

    if (!apiToken) {
      return NextResponse.json({ skipped: true, reason: "No AHS API token configured" });
    }

    const ahsStatus = FB_TO_AHS_STATUS[new_status];
    if (!ahsStatus) {
      return NextResponse.json({ skipped: true, reason: `No AHS mapping for status: ${new_status}` });
    }

    // Build AHS status update payload
    const ahsPayload: any = {
      data: [
        {
          type: "status",
          object: {
            source: "DISPATCH_ME",
            tenant: wo.ahs_external_org || "AHS",
            vendor_id: vendorId,
            dispatch_id: wo.ahs_dispatch_id,
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
    const ahsRes = await fetch(`${apiUrl}/dispatch/status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ahsPayload),
    });

    const ahsData = await ahsRes.json().catch(() => ({}));

    // Log the sync attempt
    await sb.from("ahs_dispatch_log").insert({
      tenant_id,
      dispatch_id: wo.ahs_dispatch_id,
      external_org: wo.ahs_external_org || "AHS",
      operation: "status_outbound",
      status_code: parseInt(ahsStatus.code),
      status_description: ahsStatus.description,
      raw_payload: ahsPayload,
      work_order_id: wo.id,
      processed: ahsRes.ok,
      error_message: ahsRes.ok ? null : JSON.stringify(ahsData),
    });

    return NextResponse.json({
      success: ahsRes.ok,
      ahs_status_code: ahsStatus.code,
      ahs_status_description: ahsStatus.description,
      dispatch_id: wo.ahs_dispatch_id,
    });
  } catch (error) {
    console.error("[AHS] Status update error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
