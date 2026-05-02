import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/regression-tests
 * Body: { tenant_id }
 * Runs a battery of scheduling-rules tests end-to-end against the real
 * production code path (creates temp data, exercises endpoints, verifies, cleans up).
 */

type TestResult = {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  message: string;
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://field-boss-pro.vercel.app";

export async function POST(request: NextRequest) {
  try {
    const { tenant_id } = await request.json();
    if (!tenant_id) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });

    const sb = supabaseAdmin();
    const results: TestResult[] = [];
    const cleanup: (() => Promise<void>)[] = [];

    // ── Helpers ──
    const getSlots = async (woNumber: string) => {
      const res = await fetch(`${APP_URL}/api/vapi/get-available-slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ work_order_number: woNumber }),
      });
      return await res.json();
    };

    const createTempCustomerAndWO = async (zip: string, applianceType: string, jobType: string) => {
      const { data: customer, error: custErr } = await sb
        .from("customers")
        .insert({
          tenant_id,
          customer_name: "TEST_HARNESS",
          phone: "+15555550000",
          email: "test@regression.local",
          service_address: "999 Regression Ln",
          city: "Test",
          state: "TX",
          zip,
        })
        .select("id")
        .single();
      if (custErr || !customer) throw new Error("Failed to create test customer: " + (custErr?.message || "unknown"));

      const { data: wo } = await sb
        .from("work_orders")
        .insert({
          tenant_id,
          customer_id: customer.id,
          work_order_number: `TEST-${Date.now()}`,
          status: "New",
          job_type: jobType,
          appliance_type: applianceType,
        })
        .select("id, work_order_number")
        .single();
      if (!wo) throw new Error("Failed to create test WO");

      cleanup.push(async () => {
        await sb.from("appointments").delete().eq("work_order_id", wo.id);
        await sb.from("work_orders").delete().eq("id", wo.id);
        await sb.from("customers").delete().eq("id", customer.id);
      });

      return { customerId: customer.id, woId: wo.id, woNumber: wo.work_order_number };
    };

    const fillCapacity = async (techId: number, date: string, appointments: number, repairs: number) => {
      // Insert real placeholder appointment rows for this tech/date so
      // get-available-slots (which now COUNTs actual appointments rather than
      // reading tech_daily_capacity.current_appointments) sees the tech as full.
      // The DB capacity trigger enforces max_daily_appointments, so callers
      // should not exceed the tech's max here.
      const diagCount = Math.max(0, appointments - repairs);
      const repairCount = Math.max(0, repairs);

      const createPlaceholderWo = async (jobType: "Diagnosis" | "Repair Follow-up") => {
        const { data: cust } = await sb.from("customers").insert({
          tenant_id, customer_name: "TEST_CAP_FILL", phone: "+15555550001",
          service_address: "1 Cap St", city: "Test", state: "TX", zip: "00000",
        }).select("id").single();
        const { data: wo } = await sb.from("work_orders").insert({
          tenant_id, customer_id: cust!.id,
          work_order_number: `CAPFILL-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
          status: "Scheduled", job_type: jobType, appliance_type: "Dishwasher",
          assigned_technician_id: techId,
        }).select("id").single();
        cleanup.push(async () => {
          await sb.from("appointments").delete().eq("work_order_id", wo!.id);
          await sb.from("work_orders").delete().eq("id", wo!.id);
          await sb.from("customers").delete().eq("id", cust!.id);
        });
        return wo!.id;
      };

      const insertN = async (woId: number, n: number) => {
        if (n <= 0) return;
        const rows = Array.from({ length: n }, () => ({
          tenant_id, work_order_id: woId, technician_id: techId,
          appointment_date: date, start_time: "09:00", end_time: "12:00",
          status: "scheduled", created_by_source: "regression-test",
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
    };

    const addDayOff = async (techId: number, date: string) => {
      const { data: dof } = await sb
        .from("days_off")
        .insert({ tenant_id, technician_id: techId, date_off: date, reason: "regression-test" })
        .select("id")
        .single();
      if (dof) cleanup.push(async () => { await sb.from("days_off").delete().eq("id", dof.id); });
    };

    const tomorrow = (offset = 1) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return d.toISOString().slice(0, 10);
    };

    // ── Get techs for assertions ──
    const { data: techs } = await sb
      .from("technicians")
      .select("id, tech_name, max_daily_appointments, max_daily_repairs")
      .eq("tenant_id", tenant_id)
      .eq("is_active", true);
    if (!techs || techs.length === 0) {
      return NextResponse.json({ error: "No active technicians found" }, { status: 400 });
    }
    const darryl = techs.find((t) => t.tech_name.toLowerCase().includes("darryl"));
    const jessy = techs.find((t) => t.tech_name.toLowerCase().includes("jessy"));

    try {
      // ─── TEST 1: ZIP in service area returns time window ───
      {
        const { woId, woNumber } = await createTempCustomerAndWO("75034", "Dishwasher", "Diagnosis");
        const slots = await getSlots(woNumber);
        const passed = !!(slots?.window_start && slots?.window_end);
        results.push({
          name: "ZIP 75034 (Zone 1) returns a time window",
          passed,
          expected: "window_start and window_end populated",
          actual: `window=${slots?.window_start || "(empty)"} - ${slots?.window_end || "(empty)"}`,
          message: passed ? "OK" : "Service zone lookup failed for in-service ZIP",
        });
      }

      // ─── TEST 2: ZIP outside service area returns no slots ───
      {
        const { woId, woNumber } = await createTempCustomerAndWO("99999", "Dishwasher", "Diagnosis");
        const slots = await getSlots(woNumber);
        const passed = (slots?.available_dates || []).length === 0;
        results.push({
          name: "ZIP 99999 (out of area) returns no available dates",
          passed,
          expected: "0 available dates",
          actual: `${(slots?.available_dates || []).length} dates returned`,
          message: passed ? "OK" : "Out-of-area ZIP wrongly returned schedule slots",
        });
      }

      // ─── TEST 3: Skill filter — Microwave should go to Jessy not Darryl ───
      if (jessy) {
        const { woId, woNumber } = await createTempCustomerAndWO("75034", "Microwave", "Diagnosis");
        const slots = await getSlots(woNumber);
        const passed = slots?.tech_id === jessy.id || slots?.tech_name === jessy.tech_name;
        results.push({
          name: "Microwave routes to Jessy (skill match)",
          passed,
          expected: `tech_id=${jessy.id} (Jessy)`,
          actual: `tech_id=${slots?.tech_id} tech_name=${slots?.tech_name}`,
          message: passed ? "OK" : "Skill filter did not route to expected tech",
        });
      }

      // ─── TEST 4: Skill filter — Dishwasher should go to Darryl ───
      if (darryl) {
        const { woId, woNumber } = await createTempCustomerAndWO("75034", "Dishwasher", "Diagnosis");
        const slots = await getSlots(woNumber);
        const passed = slots?.tech_id === darryl.id || slots?.tech_name === darryl.tech_name;
        results.push({
          name: "Dishwasher routes to Darryl (skill match)",
          passed,
          expected: `tech_id=${darryl.id} (Darryl)`,
          actual: `tech_id=${slots?.tech_id} tech_name=${slots?.tech_name}`,
          message: passed ? "OK" : "Skill filter did not route to expected tech",
        });
      }

      // ─── TEST 5: Diagnosis capacity cap — fill Darryl 8 appts tomorrow → tomorrow blocked ───
      if (darryl) {
        const blockDate = tomorrow(1);
        await fillCapacity(darryl.id, blockDate, darryl.max_daily_appointments || 8, 0);
        const { woId, woNumber } = await createTempCustomerAndWO("75034", "Dishwasher", "Diagnosis");
        const slots = await getSlots(woNumber);
        const dates = slots?.available_dates || [];
        const passed = !dates.includes(blockDate);
        results.push({
          name: `Darryl capped at ${darryl.max_daily_appointments} diagnosis appts → ${blockDate} blocked`,
          passed,
          expected: `${blockDate} NOT in available dates`,
          actual: `available_dates=${JSON.stringify(dates.slice(0, 5))}`,
          message: passed ? "OK" : "Diagnosis cap was not enforced",
        });
      }

      // ─── TEST 6: Repair capacity cap — fill Darryl 4 repairs tomorrow → blocked for repair ───
      if (darryl) {
        const blockDate = tomorrow(2);
        await fillCapacity(darryl.id, blockDate, darryl.max_daily_repairs || 4, darryl.max_daily_repairs || 4);
        const { woId, woNumber } = await createTempCustomerAndWO("75034", "Dishwasher", "Repair Follow-up");
        // Repair Follow-up requires assigned_technician_id — set it manually
        await sb.from("work_orders").update({ assigned_technician_id: darryl.id }).eq("id", woId);
        const slots = await getSlots(woNumber);
        const dates = slots?.available_dates || [];
        const passed = !dates.includes(blockDate);
        results.push({
          name: `Darryl capped at ${darryl.max_daily_repairs} repairs → ${blockDate} blocked for repair`,
          passed,
          expected: `${blockDate} NOT in available dates`,
          actual: `available_dates=${JSON.stringify(dates.slice(0, 5))}`,
          message: passed ? "OK" : "Repair cap was not enforced",
        });
      }

      // ─── TEST 7: Day off blocks the date ───
      if (darryl) {
        const offDate = tomorrow(3);
        await addDayOff(darryl.id, offDate);
        const { woId, woNumber } = await createTempCustomerAndWO("75034", "Dishwasher", "Diagnosis");
        const slots = await getSlots(woNumber);
        const dates = slots?.available_dates || [];
        const passed = !dates.includes(offDate);
        results.push({
          name: `Darryl day off on ${offDate} → date excluded`,
          passed,
          expected: `${offDate} NOT in available dates`,
          actual: `available_dates=${JSON.stringify(dates.slice(0, 5))}`,
          message: passed ? "OK" : "Day off was not honored",
        });
      }

      // ─── TEST 8a: "Range Hood" must NOT match "Range" skill (false positive guard) ───
      {
        const { woNumber } = await createTempCustomerAndWO("75034", "Range Hood", "Diagnosis");
        const slots = await getSlots(woNumber);
        const passed = (slots?.available_dates || []).length === 0;
        results.push({
          name: "Range Hood does NOT match Range skill",
          passed,
          expected: "0 available dates (Range Hood is a different appliance)",
          actual: `${(slots?.available_dates || []).length} dates returned, tech=${slots?.tech_name || "(none)"}`,
          message: passed ? "OK" : "Substring matching false positive — Range Hood wrongly matched Range skill",
        });
      }

      // ─── TEST 8c: "Built In Microwave" SHOULD match Microwave skill (true positive) ───
      {
        const { woNumber } = await createTempCustomerAndWO("75034", "Built In Microwave", "Diagnosis");
        const slots = await getSlots(woNumber);
        const passed = (slots?.available_dates || []).length > 0 && slots?.tech_name?.toLowerCase().includes("jessy");
        results.push({
          name: "Built In Microwave matches Microwave skill (Jessy)",
          passed,
          expected: "Routes to Jessy with available dates",
          actual: `tech=${slots?.tech_name || "(none)"}, dates=${(slots?.available_dates || []).length}`,
          message: passed ? "OK" : "Modifier+appliance match failed",
        });
      }

      // ─── TEST 8b: Unserviced appliance (Refrigerator) returns no slots ───
      {
        const { woNumber } = await createTempCustomerAndWO("75034", "Refrigerator", "Diagnosis");
        const slots = await getSlots(woNumber);
        const passed = (slots?.available_dates || []).length === 0;
        results.push({
          name: "Unserviced appliance (Refrigerator) returns no slots",
          passed,
          expected: "0 available dates (no tech has skill)",
          actual: `${(slots?.available_dates || []).length} dates returned, tech=${slots?.tech_name || "(none)"}`,
          message: passed ? "OK" : "Unserviced appliance was wrongly scheduled to a tech without the skill",
        });
      }

      // ─── TEST 8: ZIP in different zone returns different window ───
      {
        const { woId, woNumber } = await createTempCustomerAndWO("75056", "Dishwasher", "Diagnosis");
        const slots = await getSlots(woNumber);
        const passed = slots?.window_start === "11:00am" && slots?.window_end === "2:00pm";
        results.push({
          name: "ZIP 75056 (Zone 4) returns 11:00am-2:00pm window",
          passed,
          expected: "11:00am - 2:00pm",
          actual: `${slots?.window_start || "?"} - ${slots?.window_end || "?"}`,
          message: passed ? "OK" : "Zone 4 window not returned correctly",
        });
      }

    } finally {
      // Cleanup in reverse order
      for (const fn of cleanup.reverse()) {
        try { await fn(); } catch (e) { console.error("[cleanup]", e); }
      }
    }

    const passedCount = results.filter((r) => r.passed).length;
    return NextResponse.json({
      total: results.length,
      passed: passedCount,
      failed: results.length - passedCount,
      results,
    });
  } catch (error) {
    console.error("[regression-tests] error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
