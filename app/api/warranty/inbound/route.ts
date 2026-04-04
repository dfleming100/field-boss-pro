import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/warranty/inbound
 * Receives work orders from AHS (American Home Shield) or other warranty companies.
 * Creates customer if not exists, creates work_order with status "New".
 *
 * Expected payload (flexible — maps common warranty company fields):
 * {
 *   "warranty_company": "AHS",
 *   "warranty_wo_number": "AHS-12345678",
 *   "customer_name": "John Smith",
 *   "customer_phone": "555-123-4567",
 *   "customer_email": "john@example.com",
 *   "service_address": "123 Main St",
 *   "city": "Frisco",
 *   "state": "TX",
 *   "zip": "75034",
 *   "appliance_type": "Refrigerator",
 *   "job_type": "Diagnosis",
 *   "description": "Unit not cooling, customer reports warm temps",
 *   "tenant_id": 1
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    const {
      warranty_company,
      warranty_wo_number,
      customer_name,
      customer_phone,
      service_address,
      city,
      state,
      zip,
      appliance_type,
      job_type,
      description,
      tenant_id,
      customer_email,
    } = body;

    if (!tenant_id) {
      return NextResponse.json(
        { error: "tenant_id is required" },
        { status: 400 }
      );
    }
    if (!customer_name) {
      return NextResponse.json(
        { error: "customer_name is required" },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();

    // Check for duplicate warranty WO number
    if (warranty_wo_number) {
      const { data: existing } = await sb
        .from("work_orders")
        .select("id, work_order_number")
        .eq("tenant_id", tenant_id)
        .eq("warranty_wo_number", warranty_wo_number)
        .limit(1);

      if (existing && existing.length > 0) {
        return NextResponse.json(
          {
            error: "Duplicate warranty work order",
            existing_work_order_id: existing[0].id,
            work_order_number: existing[0].work_order_number,
          },
          { status: 409 }
        );
      }
    }

    // Find or create customer
    let customerId: number;

    // Try to find by phone first (most reliable match)
    const phoneDigits = (customer_phone || "").replace(/\D/g, "");
    let { data: existingCustomer } = phoneDigits.length >= 7
      ? await sb
          .from("customers")
          .select("id")
          .eq("tenant_id", tenant_id)
          .ilike("phone", `%${phoneDigits.slice(-7)}%`)
          .limit(1)
      : { data: null };

    if (!existingCustomer || existingCustomer.length === 0) {
      // Try by address
      if (service_address) {
        const { data: addrMatch } = await sb
          .from("customers")
          .select("id")
          .eq("tenant_id", tenant_id)
          .ilike("service_address", `%${service_address}%`)
          .limit(1);

        existingCustomer = addrMatch;
      }
    }

    if (existingCustomer && existingCustomer.length > 0) {
      customerId = existingCustomer[0].id;
    } else {
      // Create new customer
      const { data: newCustomer, error: custError } = await sb
        .from("customers")
        .insert({
          tenant_id,
          customer_name,
          phone: customer_phone || null,
          email: customer_email || null,
          service_address: service_address || null,
          city: city || null,
          state: state || null,
          zip: zip || null,
        })
        .select("id")
        .single();

      if (custError) {
        return NextResponse.json(
          { error: "Failed to create customer: " + custError.message },
          { status: 500 }
        );
      }
      customerId = newCustomer.id;
    }

    // Generate WO number
    const woNumber = warranty_wo_number
      ? `WO-${warranty_wo_number}`
      : `WO-${Date.now()}`;

    // Create work order
    const { data: workOrder, error: woError } = await sb
      .from("work_orders")
      .insert({
        tenant_id,
        customer_id: customerId,
        work_order_number: woNumber,
        job_type: job_type || "Diagnosis",
        appliance_type: appliance_type || null,
        description: description || null,
        status: "draft",
        warranty_company: warranty_company || null,
        warranty_wo_number: warranty_wo_number || null,
        outreach_count: 0,
      })
      .select("id, work_order_number, status")
      .single();

    if (woError) {
      return NextResponse.json(
        { error: "Failed to create work order: " + woError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      work_order_id: workOrder.id,
      work_order_number: workOrder.work_order_number,
      customer_id: customerId,
      status: workOrder.status,
    });
  } catch (error) {
    console.error("Warranty inbound error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
