import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/invoices/public/[id]
 * Public endpoint — returns invoice data for the customer-facing invoice page.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sb = supabaseAdmin();

    const { data: invoice } = await sb
      .from("invoices")
      .select(`
        *,
        customer:customers(customer_name, service_address, city, state, zip, phone, email),
        tenant:tenants(name, contact_phone, contact_email),
        work_order:work_orders(work_order_number, appliance_type)
      `)
      .eq("id", params.id)
      .single();

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const { data: items } = await sb
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", params.id)
      .order("created_at");

    return NextResponse.json({ invoice, items: items || [] });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
