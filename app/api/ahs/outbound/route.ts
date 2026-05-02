import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/ahs/outbound
 * Receives outbound webhooks from AHS/Frontdoor system.
 * Handles 4 operation types: Schedule, Status, ncc, notes
 *
 * AHS sends dispatches here when:
 * - A new dispatch is created/assigned to this contractor (Schedule)
 * - A dispatch status changes (Status)
 * - Non-covered costs are created/accepted (ncc)
 * - Notes are added (notes)
 *
 * ⚠️ SECURITY TODO (before production):
 * This endpoint currently accepts ANY POST with no auth verification.
 * The Frontdoor onboarding spec supports three auth methods:
 *   1. Bearer Token in Authorization header
 *   2. HMAC signature via shared secret in a custom header
 *   3. Basic Auth (TBD)
 * Before going live on production, add signature/token verification at
 * the top of this handler using a shared secret stored in an env var
 * (e.g. AHS_WEBHOOK_SECRET) or in tenant_integrations.encrypted_keys.
 * Sandbox testing is fine without it.
 */

// Map AHS status codes to Field Boss statuses
const AHS_STATUS_MAP: Record<number, string> = {
  10: "Complete",        // Job Completed
  20: "New",             // In Progress (initial)
  30: "Scheduled",       // Initial Appointment Scheduled
  40: "New",             // Cancel Job — we keep as New, let admin handle
  50: "New",             // Automated Dispatch Load Successful
  60: "New",             // Unable to contact customer
  70: "Scheduled",       // On My Way
  80: "Scheduled",       // Running Behind
  90: "Scheduled",       // Arrived
  100: "Parts Ordered",  // In Progress With Parts on Order
  110: "New",            // In Progress With Need To Replace
  120: "New",            // Customer was not home
  130: "New",            // Possible Denial
  140: "New",            // Incomplete
  150: "New",            // On Hold
  160: "Parts Ordered",  // Parts/Equipment Status
  200: "Scheduled",      // Customer Appointment Set
  210: "Complete",       // Customer Complete
  220: "Complete",       // Appointment Complete
  230: "New",            // Appointment Cancelled
  240: "Complete",       // Survey Complete
  250: "New",            // Dispatch Assigned
  260: "New",            // Dispatch Accepted
  270: "Scheduled",      // Rescheduled appointment
  280: "New",            // Left Customer a Message to Schedule
  290: "New",            // Authorization Reported
  300: "New",            // Appliance Options Offered
  310: "Complete",       // Appliance Replaced
  320: "New",            // CIL Offered
  330: "New",            // CIL Accepted
  340: "New",            // CIL Declined
  350: "Parts Ordered",  // Parts Ordered
  360: "Parts Ordered",  // Equipment Ordered
  370: "Parts Have Arrived", // Parts Have Arrived
  380: "Parts Have Arrived", // Equipment Arrived
  390: "Scheduled",      // Installation Appointment Set
  400: "Scheduled",      // Return appointment
  410: "Complete",       // Job Invoiced
  420: "New",            // Authorization Awaiting Contractor Input
  430: "New",            // 2nd Opinion has been requested
  440: "New",            // Cash Out Approved
  450: "New",            // NCC Accepted
  460: "New",            // NCC Rejected
  500: "New",            // Quote Started
  510: "New",            // Quote Submitted
  520: "New",            // Quote Approved
  530: "New",            // Quote Expired
  540: "New",            // Quote Cancelled
  550: "New",            // Equipment Availability Verified
  560: "Parts Ordered",  // Equipment Shipped
};

// AHS status code descriptions
const AHS_STATUS_DESC: Record<number, string> = {
  10: "Job Completed", 20: "In Progress", 30: "Initial Appointment Scheduled",
  40: "Cancel Job", 50: "Automated Dispatch Load Successful",
  60: "Unable to contact customer", 70: "On My Way", 80: "Running Behind",
  90: "Arrived", 100: "In Progress With Parts on Order",
  110: "In Progress With Need To Replace", 120: "Customer was not home",
  130: "Possible Denial", 140: "Incomplete", 150: "On Hold",
  160: "Parts/Equipment Status", 200: "Customer Appointment Set",
  210: "Customer Complete", 220: "Appointment Complete",
  230: "Appointment Cancelled", 240: "Survey Complete",
  250: "Dispatch Assigned", 260: "Dispatch Accepted",
  270: "Rescheduled appointment", 280: "Left Customer a Message to Schedule",
  290: "Authorization Reported", 300: "Appliance Options Offered",
  310: "Appliance Replaced", 320: "CIL Offered", 330: "CIL Accepted",
  340: "CIL Declined", 350: "Parts Ordered", 360: "Equipment Ordered",
  370: "Parts Have Arrived", 380: "Equipment Arrived",
  390: "Installation Appointment Set", 400: "Return appointment",
  410: "Job Invoiced", 420: "Authorization Awaiting Contractor Input",
  430: "2nd Opinion requested", 440: "Cash Out Approved",
  450: "NCC Accepted", 460: "NCC Rejected",
  500: "Quote Started", 510: "Quote Submitted", 520: "Quote Approved",
  530: "Quote Expired", 540: "Quote Cancelled",
  550: "Equipment Availability Verified", 560: "Equipment Shipped",
};

export async function POST(request: NextRequest) {
  try {
    const rawPayload = await request.json();
    const sb = supabaseAdmin();

    // AHS sends an array of operations
    const operations = Array.isArray(rawPayload) ? rawPayload : [rawPayload];
    const results: any[] = [];

    for (const op of operations) {
      const externalOrg = op.external_organization_id || "AHS";
      const operation = op.operation || "";
      const vendorId = op.vendor?.external_id?.toString() || "";

      // ── Resolve tenant from vendor_id in tenant_integrations ──
      let tenantId: number | null = null;
      if (vendorId) {
        const { data: allAhs } = await sb
          .from("tenant_integrations")
          .select("tenant_id, encrypted_keys")
          .eq("integration_type", "ahs")
          .eq("is_configured", true);

        const match = (allAhs || []).find((row: any) => {
          const keys = row.encrypted_keys || {};
          return keys.vendor_id?.toString() === vendorId;
        });
        if (match) tenantId = match.tenant_id;
      }

      if (!tenantId) {
        console.error(`[AHS] No tenant found for vendor_id: ${vendorId}`);
        results.push({ operation, error: "Vendor not configured", vendor_id: vendorId });
        continue;
      }

      console.log(`[AHS] tenant=${tenantId}, operation=${operation}, dispatch=${op.dispatch?.external_id}`);

      try {
        let result: any;
        switch (operation.toLowerCase()) {
          case "schedule":
            result = await handleSchedule(sb, tenantId, externalOrg, op);
            break;
          case "status":
            result = await handleStatus(sb, tenantId, externalOrg, op);
            break;
          case "ncc":
            result = await handleNCC(sb, tenantId, externalOrg, op);
            break;
          case "notes":
            result = await handleNotes(sb, tenantId, externalOrg, op);
            break;
          default:
            result = { error: `Unknown operation: ${operation}` };
        }

        // Log the webhook
        await sb.from("ahs_dispatch_log").insert({
          tenant_id: tenantId,
          dispatch_id: op.dispatch?.external_id || 0,
          external_org: externalOrg,
          operation,
          status_code: op.status?.code || null,
          status_description: op.status?.description || null,
          raw_payload: op,
          work_order_id: result?.work_order_id || null,
          processed: !result?.error,
          error_message: result?.error || null,
        });

        results.push(result);
      } catch (opError) {
        console.error(`[AHS] Error processing ${operation}:`, opError);

        await sb.from("ahs_dispatch_log").insert({
          tenant_id: tenantId,
          dispatch_id: op.dispatch?.external_id || 0,
          external_org: externalOrg,
          operation,
          raw_payload: op,
          processed: false,
          error_message: (opError as Error).message,
        });

        results.push({ operation, error: (opError as Error).message });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("[AHS] Webhook error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// ── Schedule: New dispatch created/assigned ──
async function handleSchedule(sb: any, tenantId: number, externalOrg: string, op: any) {
  const dispatch = op.dispatch || {};
  const dispatchId = dispatch.external_id;
  const customers = dispatch.customers || [];
  const items = dispatch.items || [];
  const coverage = op.coverage || {};
  const payments = op.payments || {};
  const contract = op.contract || {};

  if (!dispatchId) return { error: "Missing dispatch.external_id" };

  // Check for duplicate dispatch
  const { data: existing } = await sb
    .from("work_orders")
    .select("id, work_order_number")
    .eq("tenant_id", tenantId)
    .eq("ahs_dispatch_id", dispatchId)
    .limit(1);

  if (existing && existing.length > 0) {
    // Update existing WO with latest info
    return {
      work_order_id: existing[0].id,
      work_order_number: existing[0].work_order_number,
      status: "already_exists",
    };
  }

  // Parse customer info from dispatch
  const custInfo = customers[0] || {};
  const custAddress = custInfo.address || {};
  const custPhone = custInfo.phone?.[0]?.number || "";
  const custPhone2 = custInfo.phone?.[1]?.number || "";
  const custName = custInfo.name || "";
  const custEmail = custInfo.email || "";

  const serviceAddress = [custAddress.streetNumber, custAddress.streetDirection, custAddress.streetName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const unitPart = custAddress.unitNumber
    ? `${custAddress.unitType || "Unit"} ${custAddress.unitNumber}`
    : "";
  const fullAddress = [serviceAddress, unitPart].filter(Boolean).join(", ");

  // Find or create customer
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

  if (!customerId && fullAddress) {
    const { data: addrMatch } = await sb
      .from("customers")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("service_address", `%${serviceAddress}%`)
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
        phone2: custPhone2 || null,
        email: custEmail || null,
        service_address: fullAddress || null,
        city: custAddress.city || null,
        state: custAddress.state || null,
        zip: custAddress.zip || null,
      })
      .select("id")
      .single();

    if (custErr) return { error: `Customer creation failed: ${custErr.message}` };
    customerId = newCust.id;
  }

  // Parse appliance/item info
  const primaryItem = items[0] || {};
  const applianceType = primaryItem.description || "";
  const symptoms = primaryItem.symptoms?.join(", ") || "";
  const brand = primaryItem.attributes?.Brand || "";
  const location = primaryItem.attributes?.Location || "";

  // Build description from coverage notes and symptoms
  const descParts: string[] = [];
  if (symptoms) descParts.push(`Symptoms: ${symptoms}`);
  if (brand) descParts.push(`Brand: ${brand}`);
  if (location) descParts.push(`Location: ${location}`);
  if (dispatch.dispatchType && dispatch.dispatchType !== "Original") {
    descParts.push(`Dispatch type: ${dispatch.dispatchType}`);
  }
  if (dispatch.priority === "Expedited") descParts.push("EXPEDITED");

  // Add coverage notes (important instructions like "DO NOT COLLECT TRADE SERVICE FEE")
  const coverageNotes = coverage.notes || [];
  const importantNotes = coverageNotes.filter((n: string) =>
    n.includes("***") || n.includes("DO NOT") || n.includes("REMINDER") || n.includes("CONCESSION")
  );
  if (importantNotes.length > 0) {
    descParts.push("Coverage notes: " + importantNotes.join(" | "));
  }

  // Determine job type from dispatch type
  // Continuation / Vendor Transfer = transferred to us = NEW first visit (Diagnosis)
  // Recall = follow-up to our prior work, tracked separately
  let jobType = "Diagnosis";
  if (dispatch.dispatchType === "Recall") jobType = "Recall";

  // Parse coverage notes and payment info
  const allCoverageNotes = (coverage.notes || []).join("\n");
  const doNotCollect = allCoverageNotes.toLowerCase().includes("do not collect") ||
    allCoverageNotes.toLowerCase().includes("concession");
  const serviceFee = payments.remaining ?? payments.total ?? null;

  // Create work order
  const woNumber = `WO-${dispatchId.toString().slice(-6)}`;
  const { data: wo, error: woErr } = await sb
    .from("work_orders")
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      work_order_number: woNumber,
      appliance_type: applianceType || null,
      job_type: jobType,
      status: "New",
      description: descParts.join("\n") || null,
      source: externalOrg,
      ahs_dispatch_id: dispatchId,
      ahs_external_org: externalOrg,
      warranty_company: externalOrg,
      warranty_wo_number: dispatchId.toString(),
      service_fee: serviceFee,
      do_not_collect_fee: doNotCollect,
      priority: dispatch.priority || "Normal",
      authorization_required: dispatch.isAuthoRequired || false,
      dispatch_type: dispatch.dispatchType || "Original",
      coverage_notes: allCoverageNotes || null,
    })
    .select("id, work_order_number")
    .single();

  if (woErr) return { error: `Work order creation failed: ${woErr.message}` };

  // Add appliance details with full info from AHS
  for (let i = 0; i < items.length && i < 4; i++) {
    const itm = items[i] || {};
    await sb.from("appliance_details").insert({
      work_order_id: wo.id,
      tenant_id: tenantId,
      item: itm.description || `Item ${i + 1}`,
      sort_order: i + 1,
      make: itm.attributes?.Brand || null,
      symptoms: itm.symptoms?.join(", ") || null,
    });
  }

  // If no items but we have an appliance type, create one detail row
  if (items.length === 0 && applianceType) {
    await sb.from("appliance_details").insert({
      work_order_id: wo.id,
      tenant_id: tenantId,
      item: applianceType,
      sort_order: 1,
      make: brand || null,
      symptoms: symptoms || null,
    });
  }

  return {
    work_order_id: wo.id,
    work_order_number: wo.work_order_number,
    customer_id: customerId,
    dispatch_id: dispatchId,
    appliance_type: applianceType,
    status: "created",
    payment_total: payments.total || 0,
    payment_remaining: payments.remaining || 0,
  };
}

// ── Status: Dispatch status changed ──
async function handleStatus(sb: any, tenantId: number, externalOrg: string, op: any) {
  const dispatchId = op.dispatch?.external_id;
  const statusCode = op.status?.code;
  const statusDesc = op.status?.description || AHS_STATUS_DESC[statusCode] || "";

  if (!dispatchId) return { error: "Missing dispatch.external_id" };

  // Find work order by AHS dispatch ID
  const { data: wo } = await sb
    .from("work_orders")
    .select("id, status, work_order_number, notes")
    .eq("tenant_id", tenantId)
    .eq("ahs_dispatch_id", dispatchId)
    .single();

  if (!wo) return { error: `Work order not found for dispatch ${dispatchId}` };

  const newStatus = AHS_STATUS_MAP[statusCode] || wo.status;
  const oldStatus = wo.status;

  // Build note entry
  const noteEntry = `[${new Date().toISOString()}] AHS status ${statusCode}: ${statusDesc}`;
  const updatedNotes = wo.notes ? `${wo.notes}\n${noteEntry}` : noteEntry;

  // Update work order
  const updateData: any = {
    status: newStatus,
    notes: updatedNotes,
  };

  // Set job type for specific status transitions
  if (statusCode === 370 || statusCode === 380) {
    // Parts/Equipment arrived → Repair Follow-up
    updateData.job_type = "Repair Follow-up";
  }

  await sb.from("work_orders").update(updateData).eq("id", wo.id);

  // If transitioning to "Parts Have Arrived", trigger outreach notification
  if (newStatus === "Parts Have Arrived" && oldStatus !== "Parts Have Arrived") {
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://field-boss-pro.vercel.app";
      await fetch(`${appUrl}/api/notifications/status-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          work_order_id: wo.id,
          tenant_id: tenantId,
          old_status: oldStatus,
          new_status: newStatus,
        }),
      });
    } catch {}
  }

  return {
    work_order_id: wo.id,
    work_order_number: wo.work_order_number,
    old_status: oldStatus,
    new_status: newStatus,
    ahs_status_code: statusCode,
    ahs_status_description: statusDesc,
  };
}

// ── NCC: Non-covered cost created/accepted ──
async function handleNCC(sb: any, tenantId: number, externalOrg: string, op: any) {
  const dispatchId = op.dispatch?.external_id;
  const nccStatus = op.ncc?.status || "";

  if (!dispatchId) return { error: "Missing dispatch.external_id" };

  const { data: wo } = await sb
    .from("work_orders")
    .select("id, work_order_number, notes")
    .eq("tenant_id", tenantId)
    .eq("ahs_dispatch_id", dispatchId)
    .single();

  if (!wo) return { error: `Work order not found for dispatch ${dispatchId}` };

  const noteEntry = `[${new Date().toISOString()}] AHS NCC ${nccStatus}`;
  const updatedNotes = wo.notes ? `${wo.notes}\n${noteEntry}` : noteEntry;

  await sb.from("work_orders").update({ notes: updatedNotes }).eq("id", wo.id);

  return {
    work_order_id: wo.id,
    work_order_number: wo.work_order_number,
    ncc_status: nccStatus,
  };
}

// ── Notes: Note added in AHS system ──
async function handleNotes(sb: any, tenantId: number, externalOrg: string, op: any) {
  const dispatchId = op.dispatch?.external_id;
  const noteText = op.note?.text || "";
  const noteType = op.note?.type || "note";
  const createdBy = op.note?.created_by || "";
  const application = op.note?.application || "";

  if (!dispatchId) return { error: "Missing dispatch.external_id" };

  const { data: wo } = await sb
    .from("work_orders")
    .select("id, work_order_number, notes")
    .eq("tenant_id", tenantId)
    .eq("ahs_dispatch_id", dispatchId)
    .single();

  if (!wo) return { error: `Work order not found for dispatch ${dispatchId}` };

  const source = [createdBy, application].filter(Boolean).join(" via ");
  const noteEntry = `[${new Date().toISOString()}] AHS note${source ? ` (${source})` : ""}: ${noteText}`;
  const updatedNotes = wo.notes ? `${wo.notes}\n${noteEntry}` : noteEntry;

  await sb.from("work_orders").update({ notes: updatedNotes }).eq("id", wo.id);

  return {
    work_order_id: wo.id,
    work_order_number: wo.work_order_number,
    note_added: true,
  };
}
