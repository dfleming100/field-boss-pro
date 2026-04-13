import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  getEvents,
  getWorkOrder,
  acknowledgeWorkOrder,
  mapFahwStatusToFieldBoss,
  type FAHWCredentials,
} from "@/lib/fahw";

/**
 * GET /api/cron/fahw-poller
 * Runs every 5 minutes — polls FAHW for new work order events.
 *
 * For each tenant with a configured FAHW integration:
 * 1. Fetch events from FAHW (new assignments, status changes, notes)
 * 2. For "Work Order Assigned" events → fetch full WO detail → create
 *    customer + work_order + warranty_links row → auto-acknowledge
 * 3. For "Status Change" events → update work_order status
 * 4. For "Note Created" events → append to work_order notes
 *
 * The poller is idempotent — it uses warranty_links.external_id to
 * detect duplicates and skips WOs that already exist.
 */

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sb = supabaseAdmin();

    // Get all tenants with FAHW configured
    const { data: fahwIntegrations } = await sb
      .from("tenant_integrations")
      .select("tenant_id, encrypted_keys")
      .eq("integration_type", "fahw")
      .eq("is_configured", true);

    if (!fahwIntegrations || fahwIntegrations.length === 0) {
      return NextResponse.json({ skipped: true, reason: "No FAHW integrations configured" });
    }

    const allResults: any[] = [];

    for (const integration of fahwIntegrations) {
      const tenantId = integration.tenant_id;
      const keys = integration.encrypted_keys as any;
      if (!keys?.username || !keys?.password || !keys?.apiUrl) continue;

      const creds: FAHWCredentials = {
        username: keys.username,
        password: keys.password,
        apiUrl: keys.apiUrl,
      };

      const tenantResults: any[] = [];

      try {
        // 1. Fetch events
        const events = await getEvents(creds, tenantId);
        if (!Array.isArray(events)) {
          tenantResults.push({ error: "Events not an array", raw: events });
          continue;
        }

        // Group events by type
        for (const event of events) {
          const eventType = event.eventType || event.EventType || "";
          const woId = event.workOrderId || event.WorkOrderId;

          try {
            if (eventType === "Work Order Assigned") {
              const result = await handleNewAssignment(sb, creds, tenantId, woId);
              tenantResults.push({ event: eventType, woId, ...result });

              // ONLY trigger outreach for genuinely new FAHW dispatches
              // (from the events endpoint), NEVER for historical backfills.
              if (result.status === "created" && result.work_order_id && result.fb_status === "New") {
                try {
                  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://field-boss-pro.vercel.app";
                  await fetch(`${appUrl}/api/notifications/status-change`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      work_order_id: result.work_order_id,
                      tenant_id: tenantId,
                      old_status: null,
                      new_status: "New",
                    }),
                  });
                } catch {}
              }
            } else if (eventType === "Status Change") {
              const result = await handleStatusChange(sb, creds, tenantId, woId, event);
              tenantResults.push({ event: eventType, woId, ...result });
            } else if (eventType === "Work Order Note Created") {
              const result = await handleNoteCreated(sb, creds, tenantId, woId, event);
              tenantResults.push({ event: eventType, woId, ...result });
            }
            // Other event types (Appointment Created/Updated, Item Created/Cancelled)
            // are handled implicitly when we fetch the full WO detail
          } catch (eventErr) {
            tenantResults.push({ event: eventType, woId, error: (eventErr as Error).message });
          }
        }

        // NOTE: We intentionally do NOT run catchMissedAssignments here.
        // The notes endpoint returns a mix of WO IDs and PO numbers that
        // are unreliable for discovering real dispatches. We rely solely
        // on the events endpoint for new work order assignments.

      } catch (tenantErr) {
        tenantResults.push({ error: (tenantErr as Error).message });
      }

      // Log
      for (const r of tenantResults) {
        await sb.from("warranty_sync_log").insert({
          tenant_id: tenantId,
          work_order_id: r.work_order_id || null,
          provider: "FAHW",
          direction: "inbound",
          operation: r.event || r.operation || "poll",
          external_id: r.woId?.toString() || r.external_id || null,
          status_code: r.status_code || null,
          status_description: r.status_description || null,
          processed: !r.error,
          error_message: r.error || null,
          raw_payload: r.raw_payload || null,
        });
      }

      allResults.push({ tenant_id: tenantId, results: tenantResults });
    }

    return NextResponse.json({ success: true, tenants: allResults.length, results: allResults });
  } catch (error) {
    console.error("[FAHW Poller] Error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// ── Handle new work order assignment ──

async function handleNewAssignment(
  sb: any,
  creds: FAHWCredentials,
  tenantId: number,
  fahwWorkOrderId: number
) {
  // Check if we already have this WO
  const { data: existing } = await sb
    .from("warranty_links")
    .select("id, work_order_id")
    .eq("tenant_id", tenantId)
    .eq("provider", "FAHW")
    .eq("external_id", fahwWorkOrderId.toString())
    .maybeSingle();

  if (existing) {
    return { status: "already_exists", work_order_id: existing.work_order_id };
  }

  // Fetch full WO detail from FAHW
  const woDetail = await getWorkOrder(creds, tenantId, fahwWorkOrderId);
  if (woDetail.ErrorCode || woDetail.Success === false) {
    return { error: `FAHW API error: ${woDetail.ErrorDescription || "unknown"}`, raw_payload: woDetail };
  }

  // Parse customer info
  const custName = woDetail.claimantName || "";
  const custPhone = woDetail.claimantPhone || woDetail.claimantTextPhoneNum || "";
  const custEmail = woDetail.claimantEmail || "";
  const custAddress = woDetail.address || "";
  const custCity = woDetail.city || "";
  const custState = woDetail.state || "";
  const custZip = woDetail.zipCode || "";

  // Find or create customer (same dedup logic as AHS)
  let customerId: number | null = null;
  const phoneDigits = custPhone.replace(/\D/g, "");

  if (phoneDigits.length >= 7) {
    const { data: phoneMatch } = await sb
      .from("customers")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("phone", `%${phoneDigits.slice(-7)}%`)
      .limit(1);
    if (phoneMatch?.length) customerId = phoneMatch[0].id;
  }

  if (!customerId && custAddress) {
    const { data: addrMatch } = await sb
      .from("customers")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("service_address", `%${custAddress}%`)
      .limit(1);
    if (addrMatch?.length) customerId = addrMatch[0].id;
  }

  if (!customerId) {
    const { data: newCust, error: custErr } = await sb
      .from("customers")
      .insert({
        tenant_id: tenantId,
        customer_name: custName,
        phone: custPhone || null,
        email: custEmail || null,
        service_address: custAddress || null,
        city: custCity || null,
        state: custState || null,
        zip: custZip || null,
      })
      .select("id")
      .single();
    if (custErr) return { error: `Customer creation failed: ${custErr.message}` };
    customerId = newCust.id;
  }

  // Parse appliance / service item info
  const items = woDetail.workOrderItemDetails || [];
  const primaryItem = items[0] || {};
  const applianceType = primaryItem.serviceItem || primaryItem.trade || "";
  const symptoms = primaryItem.symptom || "";
  const brand = primaryItem.brand || "";
  const failure = primaryItem.failure || "";
  const failureCorrection = primaryItem.failureCorrection || "";

  // Build description
  const descParts: string[] = [];
  if (primaryItem.description) descParts.push(primaryItem.description);
  if (failure) descParts.push(failure);
  if (failureCorrection) descParts.push(failureCorrection);
  if (woDetail.priority === "Expedited") descParts.push("EXPEDITED");

  // Determine job type
  let jobType = "Diagnosis";
  const woType = (woDetail.workOrderType || "").toLowerCase();
  if (woType.includes("recall")) jobType = "Recall";
  else if (woType.includes("continuation") || woType.includes("completion")) jobType = "Repair Follow-up";

  // Map FAHW status to Field Boss status
  const fbStatus = mapFahwStatusToFieldBoss(woDetail.lastAction || "", woDetail.subStatus);

  // Determine service fee
  const serviceFee = woDetail.svcFeeApplicableAmount || null;
  const doNotCollect = (woDetail.svcFeeStatus || "").toLowerCase().includes("satisfied") ||
    (woDetail.svcFeeStatus || "").toLowerCase().includes("waived");

  // Use the actual FAHW work order number — plain numeric, no prefix
  const woNumber = (woDetail.workOrderNumber || fahwWorkOrderId).toString();
  const { data: wo, error: woErr } = await sb
    .from("work_orders")
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      work_order_number: woNumber,
      appliance_type: applianceType || null,
      job_type: jobType,
      status: fbStatus,
      description: descParts.join("\n") || null,
      outreach_count: 0,
    })
    .select("id, work_order_number")
    .single();

  if (woErr) return { error: `WO creation failed: ${woErr.message}` };

  // Create warranty_links row
  await sb.from("warranty_links").insert({
    work_order_id: wo.id,
    tenant_id: tenantId,
    provider: "FAHW",
    external_id: fahwWorkOrderId.toString(),
    external_number: woDetail.workOrderNumber?.toString() || fahwWorkOrderId.toString(),
    service_fee: serviceFee,
    do_not_collect_fee: doNotCollect,
    authorization_required: woDetail.authorizationStatus === "Authorization Required",
    dispatch_type: woDetail.workOrderType || "First Time Dispatch",
    priority: woDetail.priority || "Normal",
    coverage_notes: (woDetail.transactionDetails || [])
      .map((t: any) => `[${t.createdDate}] ${t.transactionDetails}`)
      .join("\n") || null,
    provider_status_code: woDetail.lastAction || null,
    provider_status_description: woDetail.lastAction || null,
    raw_payload: woDetail,
  });

  // Add appliance details
  for (let i = 0; i < items.length && i < 4; i++) {
    const item = items[i];
    await sb.from("appliance_details").insert({
      work_order_id: wo.id,
      tenant_id: tenantId,
      item: item.serviceItem || item.trade || `Item ${i + 1}`,
      make: item.brand || null,
      symptoms: item.symptom || null,
      sort_order: i + 1,
    });
  }

  // Auto-acknowledge the work order with FAHW
  try {
    await acknowledgeWorkOrder(creds, tenantId, fahwWorkOrderId);
  } catch {}

  return {
    status: "created",
    work_order_id: wo.id,
    work_order_number: wo.work_order_number,
    customer_id: customerId,
    appliance_type: applianceType,
    fb_status: fbStatus,
    external_id: fahwWorkOrderId.toString(),
  };
}

// ── Handle status change event ──

async function handleStatusChange(
  sb: any,
  creds: FAHWCredentials,
  tenantId: number,
  fahwWorkOrderId: number,
  event: any
) {
  const { data: link } = await sb
    .from("warranty_links")
    .select("id, work_order_id")
    .eq("tenant_id", tenantId)
    .eq("provider", "FAHW")
    .eq("external_id", fahwWorkOrderId.toString())
    .maybeSingle();

  if (!link) {
    // WO not in our system yet — try to import it
    return handleNewAssignment(sb, creds, tenantId, fahwWorkOrderId);
  }

  // Fetch latest detail from FAHW
  const woDetail = await getWorkOrder(creds, tenantId, fahwWorkOrderId);
  if (woDetail.ErrorCode) return { error: woDetail.ErrorDescription };

  const newFbStatus = mapFahwStatusToFieldBoss(woDetail.lastAction || "");

  // Get current FB status
  const { data: wo } = await sb
    .from("work_orders")
    .select("id, status")
    .eq("id", link.work_order_id)
    .single();

  if (!wo) return { error: "Work order not found in Field Boss" };

  const oldStatus = wo.status;
  if (oldStatus === newFbStatus) {
    // Update the warranty_links provider status even if FB status didn't change
    await sb.from("warranty_links").update({
      provider_status_code: woDetail.lastAction,
      provider_status_description: event.eventDescription || woDetail.lastAction,
      updated_at: new Date().toISOString(),
    }).eq("id", link.id);

    return { status: "no_change", work_order_id: wo.id, fb_status: oldStatus };
  }

  // Update work order status
  await sb.from("work_orders").update({ status: newFbStatus }).eq("id", wo.id);

  // Update warranty_links
  await sb.from("warranty_links").update({
    provider_status_code: woDetail.lastAction,
    provider_status_description: event.eventDescription || woDetail.lastAction,
    updated_at: new Date().toISOString(),
  }).eq("id", link.id);

  // Fire outreach if transitioning to New or Parts Have Arrived
  if (newFbStatus === "New" || newFbStatus === "Parts Have Arrived") {
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://field-boss-pro.vercel.app";
      await fetch(`${appUrl}/api/notifications/status-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          work_order_id: wo.id,
          tenant_id: tenantId,
          old_status: oldStatus,
          new_status: newFbStatus,
        }),
      });
    } catch {}
  }

  return {
    status: "updated",
    work_order_id: wo.id,
    old_status: oldStatus,
    new_status: newFbStatus,
    fahw_action: woDetail.lastAction,
    status_description: event.eventDescription,
  };
}

// ── Handle note created event ──

async function handleNoteCreated(
  sb: any,
  _creds: FAHWCredentials,
  tenantId: number,
  fahwWorkOrderId: number,
  event: any
) {
  const { data: link } = await sb
    .from("warranty_links")
    .select("work_order_id")
    .eq("tenant_id", tenantId)
    .eq("provider", "FAHW")
    .eq("external_id", fahwWorkOrderId.toString())
    .maybeSingle();

  if (!link) return { status: "skipped", reason: "WO not in system" };

  const { data: wo } = await sb
    .from("work_orders")
    .select("id, notes")
    .eq("id", link.work_order_id)
    .single();

  if (!wo) return { error: "WO not found" };

  const noteText = event.eventDescription || "";
  const noteEntry = `[${new Date().toISOString()}] FAHW: ${noteText}`;
  const updatedNotes = wo.notes ? `${wo.notes}\n${noteEntry}` : noteEntry;

  await sb.from("work_orders").update({ notes: updatedNotes }).eq("id", wo.id);

  return { status: "note_added", work_order_id: wo.id };
}

// ── Catch missed assignments ──
// On first run or if events were missed, do a full WO list pull

async function catchMissedAssignments(
  sb: any,
  creds: FAHWCredentials,
  tenantId: number,
  results: any[]
) {
  try {
    // Fetch recent notes (which contain workOrderIds) as a proxy for active WOs
    const notes = await import("@/lib/fahw").then(m => m.getNotes(creds, tenantId));
    if (!notes?.Result || !Array.isArray(notes.Result)) return;

    // Get unique WO IDs from notes
    const woIds: number[] = [...new Set(notes.Result.map((n: any) => n.workOrderId).filter(Boolean))] as number[];

    // Check which ones we already have
    const { data: existingLinks } = await sb
      .from("warranty_links")
      .select("external_id")
      .eq("tenant_id", tenantId)
      .eq("provider", "FAHW");

    const existingIds = new Set((existingLinks || []).map((l: any) => l.external_id));

    for (const woId of woIds) {
      if (existingIds.has(woId.toString())) continue;

      try {
        const result = await handleNewAssignment(sb, creds, tenantId, woId as number);
        results.push({ event: "catch_missed", woId, ...result, operation: "catch_missed" });
      } catch (err) {
        results.push({ event: "catch_missed", woId, error: (err as Error).message, operation: "catch_missed" });
      }
    }
  } catch {}
}
