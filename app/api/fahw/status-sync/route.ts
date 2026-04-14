import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  provideStatus,
  scheduleAppointment,
  onMyWay,
  createNote,
  partsEta as pushPartsEta,
  getWorkOrder,
  type FAHWCredentials,
} from "@/lib/fahw";

/**
 * POST /api/fahw/status-sync
 * Called internally when a work order status changes and the WO has a
 * FAHW warranty_link. Pushes the status update back to FAHW.
 *
 * Body: { work_order_id, tenant_id, new_status, old_status,
 *         appointment_date?, start_time?, end_time?,
 *         service_fee_collected?, note? }
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { work_order_id, tenant_id, new_status, old_status,
      appointment_date, start_time, end_time,
      service_fee_collected, note } = body;

    if (!work_order_id || !tenant_id) {
      return NextResponse.json({ error: "work_order_id and tenant_id required" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // Look up warranty_link for this WO
    const { data: link } = await sb
      .from("warranty_links")
      .select("id, external_id, provider")
      .eq("work_order_id", work_order_id)
      .eq("provider", "FAHW")
      .maybeSingle();

    if (!link) {
      return NextResponse.json({ skipped: true, reason: "Not a FAHW work order" });
    }

    const fahwWorkOrderId = parseInt(link.external_id);
    if (!fahwWorkOrderId) {
      return NextResponse.json({ skipped: true, reason: "Invalid FAHW work order ID" });
    }

    // Get FAHW credentials
    const { data: integration } = await sb
      .from("tenant_integrations")
      .select("encrypted_keys")
      .eq("tenant_id", tenant_id)
      .eq("integration_type", "fahw")
      .eq("is_configured", true)
      .maybeSingle();

    if (!integration) {
      return NextResponse.json({ skipped: true, reason: "FAHW integration not configured" });
    }

    const keys = integration.encrypted_keys as any;
    const creds: FAHWCredentials = {
      username: keys.username,
      password: keys.password,
      apiUrl: keys.apiUrl,
    };

    let result: any = null;

    switch (new_status) {
      case "Scheduled": {
        // Push appointment to FAHW
        if (appointment_date && start_time && end_time) {
          result = await scheduleAppointment(creds, tenant_id, {
            workOrderId: fahwWorkOrderId,
            appointmentDate: appointment_date,
            startTime: start_time,
            endTime: end_time,
          });
        } else {
          // Fetch the latest appointment from our DB
          const { data: appt } = await sb
            .from("appointments")
            .select("appointment_date, start_time, end_time")
            .eq("work_order_id", work_order_id)
            .eq("status", "scheduled")
            .order("appointment_date", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (appt) {
            // Convert 24h time (09:00) to FAHW format (9:00 AM)
            const fmtTime = (t: string) => {
              const [h, m] = t.split(":");
              const hour = parseInt(h);
              const min = m || "00";
              if (hour === 0) return `12:${min} AM`;
              if (hour === 12) return `12:${min} PM`;
              return hour > 12 ? `${hour - 12}:${min} PM` : `${hour}:${min} AM`;
            };

            result = await scheduleAppointment(creds, tenant_id, {
              workOrderId: fahwWorkOrderId,
              appointmentDate: appt.appointment_date,
              startTime: fmtTime(appt.start_time),
              endTime: fmtTime(appt.end_time),
            });
          }
        }
        break;
      }

      case "Parts Ordered": {
        // Use the dedicated parts-eta endpoint per Sergio's guidance.
        // Do NOT use provide-status for this — it causes cross-contamination.
        const defaultEta = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().split("T")[0];
        result = await pushPartsEta(creds, tenant_id, fahwWorkOrderId, body.parts_eta || defaultEta);
        break;
      }

      case "Complete": {
        // Fetch WO detail from FAHW to get the WorkOrderItemId (required)
        const woDetail = await getWorkOrder(creds, tenant_id, fahwWorkOrderId);
        const primaryItemId = woDetail?.workOrderItemDetails?.[0]?.workOrderItemId;

        // CompletionOutcome must be one of: Repair, Replace,
        // Repair with Non-Covered, Replace with Non-Covered,
        // Possible Denial, No Mechanical Failure
        const today = new Date().toISOString().split("T")[0];
        result = await provideStatus(creds, tenant_id, {
          workOrderId: fahwWorkOrderId,
          workOrderItemId: primaryItemId || undefined,
          serviceArrivalDate: body.service_arrival_date || today,
          serviceFeeCollected: true,
          completionOutcome: body.completion_outcome || "Repair",
        });
        break;
      }

      // "New" and "Parts Have Arrived" don't have a direct FAHW push —
      // they're internal Field Boss statuses. FAHW will learn about them
      // indirectly when we schedule an appointment or complete the job.
      default:
        return NextResponse.json({ skipped: true, reason: `No FAHW sync for status: ${new_status}` });
    }

    // Add a note to the FAHW work order if provided
    if (note) {
      try {
        await createNote(creds, tenant_id, fahwWorkOrderId, note);
      } catch {}
    }

    // Update warranty_links last_synced_at
    await sb.from("warranty_links").update({
      last_synced_at: new Date().toISOString(),
      provider_status_code: new_status,
      updated_at: new Date().toISOString(),
    }).eq("id", link.id);

    // Log the sync
    await sb.from("warranty_sync_log").insert({
      tenant_id,
      work_order_id,
      warranty_link_id: link.id,
      provider: "FAHW",
      direction: "outbound",
      operation: `status_${new_status}`,
      external_id: link.external_id,
      status_code: new_status,
      processed: !result?.ErrorCode,
      error_message: result?.ErrorDescription || null,
      raw_payload: result,
    });

    return NextResponse.json({
      success: !result?.ErrorCode,
      fahw_work_order_id: fahwWorkOrderId,
      status_pushed: new_status,
      fahw_response: result,
    });
  } catch (error) {
    console.error("[FAHW Status Sync] Error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
