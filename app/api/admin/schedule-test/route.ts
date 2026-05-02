import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://field-boss-pro.vercel.app";

/**
 * POST /api/admin/schedule-test
 * Body: { tenant_id, zip, appliance_type, job_type, assigned_tech_id?, simulated_capacity?: { tech_id, date, appointments, repairs }[] }
 * Creates a temp customer + WO, calls /api/vapi/get-available-slots, returns the result, cleans up.
 */
export async function POST(request: NextRequest) {
  const sb = supabaseAdmin();
  const cleanup: (() => Promise<void>)[] = [];

  try {
    const body = await request.json();
    const { tenant_id, zip, appliance_type, job_type, assigned_tech_id, simulated_capacity } = body;

    if (!tenant_id || !zip) {
      return NextResponse.json({ error: "tenant_id and zip required" }, { status: 400 });
    }

    // Apply simulated capacity overrides — insert real placeholder appointments
    // because get-available-slots now COUNTs actual rows rather than reading
    // the tech_daily_capacity counter.
    if (Array.isArray(simulated_capacity)) {
      for (const sim of simulated_capacity) {
        const diagCount = Math.max(0, (sim.appointments || 0) - (sim.repairs || 0));
        const repairCount = Math.max(0, sim.repairs || 0);

        const createPlaceholderWo = async (jobType: "Diagnosis" | "Repair Follow-up") => {
          const { data: c } = await sb.from("customers").insert({
            tenant_id, customer_name: "TEST_CAP_FILL", phone: "+15555550001",
            service_address: "1 Cap St", city: "Test", state: "TX", zip: "00000",
          }).select("id").single();
          const { data: w } = await sb.from("work_orders").insert({
            tenant_id, customer_id: c!.id,
            work_order_number: `CAPFILL-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
            status: "Scheduled", job_type: jobType, appliance_type: "Dishwasher",
            assigned_technician_id: sim.tech_id,
          }).select("id").single();
          cleanup.push(async () => {
            await sb.from("appointments").delete().eq("work_order_id", w!.id);
            await sb.from("work_orders").delete().eq("id", w!.id);
            await sb.from("customers").delete().eq("id", c!.id);
          });
          return w!.id;
        };

        const insertN = async (woId: number, n: number) => {
          if (n <= 0) return;
          const rows = Array.from({ length: n }, () => ({
            tenant_id, work_order_id: woId, technician_id: sim.tech_id,
            appointment_date: sim.date, start_time: "09:00", end_time: "12:00",
            status: "scheduled", created_by_source: "schedule-test",
          }));
          await sb.from("appointments").insert(rows);
        };

        if (diagCount > 0) {
          const woId = await createPlaceholderWo("Diagnosis");
          await insertN(woId, diagCount);
        }
        if (repairCount > 0) {
          const woId = await createPlaceholderWo("Repair Follow-up");
          await insertN(woId, repairCount);
        }
      }
    }

    // Create temp customer
    const { data: customer, error: custErr } = await sb
      .from("customers")
      .insert({
        tenant_id,
        customer_name: "TEST_TESTER",
        phone: "+15555550000",
        email: "test@tester.local",
        service_address: "999 Test Ln",
        city: "Test", state: "TX", zip,
      })
      .select("id")
      .single();
    if (custErr || !customer) throw new Error("Failed to create test customer: " + (custErr?.message || "unknown"));
    cleanup.push(async () => { await sb.from("customers").delete().eq("id", customer.id); });

    // Create temp WO
    const { data: wo } = await sb
      .from("work_orders")
      .insert({
        tenant_id,
        customer_id: customer.id,
        work_order_number: `TESTER-${Date.now()}`,
        status: "New",
        job_type: job_type || "Diagnosis",
        appliance_type: appliance_type || null,
        assigned_technician_id: assigned_tech_id || null,
      })
      .select("id, work_order_number")
      .single();
    if (!wo) throw new Error("Failed to create test WO");
    cleanup.push(async () => {
      await sb.from("appointments").delete().eq("work_order_id", wo.id);
      await sb.from("work_orders").delete().eq("id", wo.id);
    });

    // Call get-available-slots
    const res = await fetch(`${APP_URL}/api/vapi/get-available-slots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ work_order_number: wo.work_order_number }),
    });
    const data = await res.json();

    return NextResponse.json({ slots: data });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  } finally {
    for (const fn of cleanup.reverse()) {
      try { await fn(); } catch (e) { console.error("[cleanup]", e); }
    }
  }
}
