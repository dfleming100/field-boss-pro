import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/sms/thread-state
 * Upsert per-thread state: ai_paused, last_read_at, assigned_to.
 * Body: { tenant_id, phone, ai_paused?, mark_read?, assigned_to? }
 */
export async function POST(request: NextRequest) {
  try {
    const { tenant_id, phone, ai_paused, mark_read, assigned_to } = await request.json();
    if (!tenant_id || !phone) {
      return NextResponse.json({ error: "tenant_id and phone required" }, { status: 400 });
    }

    const patch: any = { tenant_id, phone, updated_at: new Date().toISOString() };
    if (typeof ai_paused === "boolean") patch.ai_paused = ai_paused;
    if (mark_read) patch.last_read_at = new Date().toISOString();
    if (assigned_to !== undefined) patch.assigned_to = assigned_to;

    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("sms_thread_state")
      .upsert(patch, { onConflict: "tenant_id,phone" })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, state: data });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
