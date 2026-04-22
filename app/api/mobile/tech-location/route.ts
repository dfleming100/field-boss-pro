import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/mobile/tech-location
 * Body: { auth_uid: string, lat: number, lng: number }
 * Resolves auth_uid → tenant_users.technician_id → updates technicians last_lat/lng.
 */
export async function POST(request: NextRequest) {
  try {
    const { auth_uid, lat, lng } = await request.json();

    if (!auth_uid || typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json({ error: "auth_uid, lat, lng required" }, { status: 400 });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return NextResponse.json({ error: "coords out of range" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    const { data: tu } = await sb
      .from("tenant_users")
      .select("technician_id")
      .eq("auth_uid", auth_uid)
      .maybeSingle();

    if (!tu?.technician_id) {
      return NextResponse.json({ error: "user not linked to a technician" }, { status: 404 });
    }

    const { error } = await sb
      .from("technicians")
      .update({
        last_lat: lat,
        last_lng: lng,
        last_location_at: new Date().toISOString(),
      })
      .eq("id", tu.technician_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "unknown error" }, { status: 500 });
  }
}
