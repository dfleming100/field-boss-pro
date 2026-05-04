import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// POST /api/admin/techs/delete
// Body: { tenant_id, technician_id }
// Deletes the auth user, the tenant_users row, and soft-deletes the technician
// (we keep the technicians row for historical work_order references).
export async function POST(request: NextRequest) {
  try {
    const { tenant_id, technician_id } = await request.json();
    if (!tenant_id || !technician_id) {
      return NextResponse.json({ ok: false, error: "tenant_id and technician_id required" }, { status: 400 });
    }

    const authHeader = request.headers.get("authorization") || "";
    const callerJwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!callerJwt) {
      return NextResponse.json({ ok: false, error: "Auth required" }, { status: 401 });
    }

    const sb = supabaseAdmin();
    const { data: { user: caller } } = await sb.auth.getUser(callerJwt);
    if (!caller) {
      return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 });
    }
    const { data: callerTu } = await sb
      .from("tenant_users")
      .select("role, tenant_id")
      .eq("auth_uid", caller.id)
      .eq("tenant_id", tenant_id)
      .single();
    if (!callerTu || (callerTu.role !== "admin" && callerTu.role !== "manager")) {
      return NextResponse.json({ ok: false, error: "Admin access required" }, { status: 403 });
    }

    // Look up tenant_users row for this technician (if any) so we can delete the auth user
    const { data: tu } = await sb
      .from("tenant_users")
      .select("auth_uid")
      .eq("technician_id", technician_id)
      .eq("tenant_id", tenant_id)
      .maybeSingle();

    // Soft-delete the technician (keep the row so historical WOs still reference a name)
    await sb.from("tech_skills").delete().eq("technician_id", technician_id);
    const { error: techErr } = await sb
      .from("technicians")
      .update({ is_active: false })
      .eq("id", technician_id)
      .eq("tenant_id", tenant_id);
    if (techErr) {
      return NextResponse.json({ ok: false, error: techErr.message }, { status: 500 });
    }

    // Delete the tenant_users row + auth user (full revoke of login access)
    if (tu?.auth_uid) {
      await sb.from("tenant_users").delete().eq("auth_uid", tu.auth_uid).eq("tenant_id", tenant_id);
      const { error: authErr } = await sb.auth.admin.deleteUser(tu.auth_uid);
      if (authErr) {
        // Non-fatal — the technician is deactivated and the tenant_users row is gone
        return NextResponse.json({
          ok: true,
          warning: `Auth user delete failed (${authErr.message}) but login access is revoked`,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
