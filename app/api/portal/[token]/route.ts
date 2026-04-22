import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/portal/[token]
 * Public — returns data for the customer portal page based on a signed WO portal_token.
 * Token is an unguessable uuid generated per work order.
 */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token;
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const sb = supabaseAdmin();

  const { data: wo, error: woErr } = await sb
    .from("work_orders")
    .select(`
      id, work_order_number, status, job_type, appliance_type, notes, service_date, created_at, tenant_id,
      customer:customers(id, customer_name, service_address, city, state, zip, phone),
      technician:technicians!assigned_technician_id(id, tech_name, phone, last_lat, last_lng, last_location_at)
    `)
    .eq("portal_token", token)
    .maybeSingle();

  if (woErr || !wo) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: appt } = await sb
    .from("appointments")
    .select("id, appointment_date, start_time, end_time, status")
    .eq("work_order_id", wo.id)
    .neq("status", "canceled")
    .order("appointment_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const customer: any = Array.isArray(wo.customer) ? wo.customer[0] : wo.customer;
  const { data: invoices } = await sb
    .from("invoices")
    .select("id, invoice_number, total, status, created_at")
    .eq("work_order_id", wo.id)
    .is("paid_at", null)
    .order("created_at", { ascending: false })
    .limit(3);

  const { data: tenant } = await sb
    .from("tenants")
    .select("name, contact_phone")
    .eq("id", wo.tenant_id)
    .maybeSingle();

  return NextResponse.json({
    work_order: {
      id: wo.id,
      work_order_number: wo.work_order_number,
      status: wo.status,
      job_type: wo.job_type,
      appliance_type: wo.appliance_type,
      notes: wo.notes,
      created_at: wo.created_at,
    },
    customer: customer
      ? {
          customer_name: customer.customer_name,
          service_address: customer.service_address,
          city: customer.city,
          state: customer.state,
          zip: customer.zip,
        }
      : null,
    technician: wo.technician || null,
    appointment: appt || null,
    invoices: invoices || [],
    tenant: tenant || null,
  });
}
