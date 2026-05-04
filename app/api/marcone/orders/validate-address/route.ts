import { NextRequest, NextResponse } from "next/server";
import { validateAddress } from "@/lib/marcone";
import { supabaseAdmin } from "@/lib/supabase";

// GET /api/marcone/orders/validate-address
// Validates the tenant's shop address against Marcone's Fedex/UPS validator.
// Optional ?tenant_id=... otherwise uses the first tenant row.
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get("tenant_id");

    const sb = supabaseAdmin();
    const q = sb
      .from("tenants")
      .select("name, shop_address, shop_city, shop_state, shop_zip")
      .limit(1);
    if (tenantId) q.eq("id", tenantId);
    const { data, error } = await q.single();
    if (error || !data) {
      return NextResponse.json({ ok: false, error: error?.message || "tenant not found" }, { status: 404 });
    }

    const addr = {
      name: (data as any).name,
      address1: (data as any).shop_address,
      city: (data as any).shop_city,
      state: (data as any).shop_state,
      zip: (data as any).shop_zip,
    };

    const result = await validateAddress(addr);
    return NextResponse.json({ ok: true, sent: addr, result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
