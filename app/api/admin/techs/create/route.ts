import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// POST /api/admin/techs/create
// Body: { tenant_id, first_name, last_name, email, password, phone? }
// Atomically creates: auth user (email/password), technicians row, tenant_users row (role=technician).
// Caller must already be an admin of `tenant_id` — we verify by checking the JWT claims.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenant_id, first_name, last_name, email, password, phone } = body || {};

    if (!tenant_id || !first_name?.trim() || !last_name?.trim() || !email?.trim() || !password) {
      return NextResponse.json(
        { ok: false, error: "tenant_id, first_name, last_name, email, password are required" },
        { status: 400 }
      );
    }
    if (password.length < 8) {
      return NextResponse.json({ ok: false, error: "Password must be at least 8 characters" }, { status: 400 });
    }

    // Verify caller is an admin of this tenant
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

    const techName = `${first_name.trim()} ${last_name.trim()}`;
    const cleanEmail = email.trim().toLowerCase();

    // Step 1: create auth user
    const { data: created, error: authErr } = await sb.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: { first_name: first_name.trim(), last_name: last_name.trim(), tech_name: techName },
    });
    if (authErr || !created?.user) {
      return NextResponse.json(
        { ok: false, error: `Auth user create failed: ${authErr?.message || "unknown"}` },
        { status: 400 }
      );
    }
    const authUid = created.user.id;

    // Step 2: create technicians row
    const { data: tech, error: techErr } = await sb
      .from("technicians")
      .insert({
        tenant_id,
        tech_name: techName,
        email: cleanEmail,
        phone: phone || null,
        is_active: true,
        max_daily_appointments: 12,
        max_daily_repairs: 6,
      })
      .select("id")
      .single();

    if (techErr || !tech) {
      // Rollback auth user so we don't leave orphans
      await sb.auth.admin.deleteUser(authUid);
      return NextResponse.json(
        { ok: false, error: `Technician create failed: ${techErr?.message || "unknown"}` },
        { status: 500 }
      );
    }

    // Step 3: create tenant_users row linking auth user → tenant + technician
    const { error: tuErr } = await sb.from("tenant_users").insert({
      tenant_id,
      auth_uid: authUid,
      user_email: cleanEmail,
      role: "technician",
      technician_id: tech.id,
      is_active: true,
    });

    if (tuErr) {
      // Rollback both
      await sb.from("technicians").delete().eq("id", tech.id);
      await sb.auth.admin.deleteUser(authUid);
      return NextResponse.json(
        { ok: false, error: `tenant_user link failed: ${tuErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, technician_id: tech.id, auth_uid: authUid });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
