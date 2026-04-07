import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/vapi/create-customer-wo
 * Vapi custom tool — creates a new customer and work order when customer is not found.
 * Called when Vapi's customer-lookup returns not found and the agent has collected info.
 */
export async function POST(request: NextRequest) {
  try {
    const raw = await request.json();

    // Handle Vapi tool call format
    let args = raw;
    let toolCallId = "";
    if (raw.message?.toolCalls?.[0]) {
      const tc = raw.message.toolCalls[0];
      args = tc.function?.arguments || {};
      toolCallId = tc.id || "";
    }

    const customerName = (args.customer_name || args.customerName || "").trim();
    const serviceAddress = (args.service_address || args.serviceAddress || "").trim();
    const city = (args.city || "").trim();
    const state = (args.state || "TX").trim();
    const zip = (args.zip || "").trim();
    const phone = (args.phone || "").trim();
    const applianceType = (args.appliance_type || args.applianceType || "").trim();

    if (!customerName) {
      return wrapResponse(toolCallId, { success: false, error: "Customer name is required" });
    }

    const sb = supabaseAdmin();

    // Check if customer already exists by phone
    let customerId: number | null = null;
    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length >= 7) {
      const { data: existing } = await sb
        .from("customers")
        .select("id")
        .eq("tenant_id", 1)
        .ilike("phone", `%${phoneDigits.slice(-7)}%`)
        .limit(1);

      if (existing && existing.length > 0) {
        customerId = existing[0].id;
      }
    }

    // Create customer if not found
    if (!customerId) {
      const { data: newCust, error: custErr } = await sb
        .from("customers")
        .insert({
          tenant_id: 1,
          customer_name: customerName,
          phone: phone || null,
          service_address: serviceAddress || null,
          city: city || null,
          state: state || null,
          zip: zip || null,
        })
        .select("id")
        .single();

      if (custErr) return wrapResponse(toolCallId, { success: false, error: custErr.message });
      customerId = newCust.id;
    }

    // Create work order
    const woNumber = `WO-${Date.now().toString().slice(-6)}`;
    const { data: wo, error: woErr } = await sb
      .from("work_orders")
      .insert({
        tenant_id: 1,
        customer_id: customerId,
        work_order_number: woNumber,
        appliance_type: applianceType || null,
        job_type: "Diagnosis",
        status: "New",
      })
      .select("id, work_order_number")
      .single();

    if (woErr) return wrapResponse(toolCallId, { success: false, error: woErr.message });

    // Add appliance detail
    if (applianceType) {
      await sb.from("appliance_details").insert({
        work_order_id: wo.id,
        tenant_id: 1,
        item: applianceType,
        sort_order: 1,
      });
    }

    const result = {
      success: true,
      customer_id: customerId,
      work_order_id: wo.id,
      work_order_number: wo.work_order_number,
      customer_name: customerName,
      address: [serviceAddress, city, state, zip].filter(Boolean).join(", "),
      appliance_type: applianceType,
      message: `I have created an account for ${customerName} at ${serviceAddress}. Work order ${wo.work_order_number} is set up for ${applianceType} service. Now let me check available dates.`,
    };

    return wrapResponse(toolCallId, result);
  } catch (error) {
    console.error("Vapi create customer/WO error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

function wrapResponse(toolCallId: string, result: any) {
  if (toolCallId) {
    return NextResponse.json({ results: [{ toolCallId, result: JSON.stringify(result) }] });
  }
  return NextResponse.json(result);
}
