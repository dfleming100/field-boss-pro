import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/sms/create-customer-wo
 * Creates a new customer and/or work order from SMS conversation.
 * Called by the SMS AI when it collects enough info from a new caller.
 *
 * Body: {
 *   tenant_id, phone,
 *   customer_name, service_address, city, state, zip, email,
 *   appliance_type, existing_customer_id (optional)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      tenant_id, phone, customer_name, service_address, city, state, zip, email,
      appliance_type, existing_customer_id,
    } = body;

    const sb = supabaseAdmin();
    let customerId = existing_customer_id;

    // Create customer if no existing ID
    if (!customerId && customer_name) {
      // 1) Try to match by phone (existing behavior)
      const phoneDigits = (phone || "").replace(/\D/g, "");
      if (phoneDigits.length >= 7) {
        const { data: existing } = await sb
          .from("customers")
          .select("id")
          .eq("tenant_id", tenant_id || 1)
          .or(`phone.ilike.%${phoneDigits.slice(-7)}%,phone2.ilike.%${phoneDigits.slice(-7)}%`)
          .limit(1);

        if (existing && existing.length > 0) {
          customerId = existing[0].id;
        }
      }

      // 2) Fallback to ADDRESS match if phone didn't hit. Customers
      // commonly text from a number not on file (spouse, work phone),
      // but the service address is stable. Mirrors Vapi behavior.
      if (!customerId && service_address) {
        const addrLower = service_address.toLowerCase().trim();
        const tokens = addrLower.match(/\d+|[a-z]{3,}/g) || [];
        const streetNum = tokens.find((t) => /^\d+$/.test(t));
        const streetWord = tokens.find(
          (t) => !/^\d+$/.test(t) && !["st","dr","ave","blvd","rd","ln","ct","cir","pkwy","apt","suite","unit"].includes(t)
        );
        if (streetNum && streetWord) {
          const { data: addrMatch } = await sb
            .from("customers")
            .select("id, phone, phone2")
            .eq("tenant_id", tenant_id || 1)
            .ilike("service_address", `%${streetNum}%${streetWord}%`)
            .limit(1)
            .maybeSingle();

          if (addrMatch) {
            customerId = addrMatch.id;
            // Save the inbound phone as phone2 if it isn't already on file,
            // so future texts from this number get recognized immediately.
            const inboundLast10 = phoneDigits.slice(-10);
            const onFile1 = (addrMatch.phone || "").replace(/\D/g, "").slice(-10);
            const onFile2 = (addrMatch.phone2 || "").replace(/\D/g, "").slice(-10);
            if (
              inboundLast10.length === 10 &&
              inboundLast10 !== onFile1 &&
              inboundLast10 !== onFile2 &&
              !addrMatch.phone2
            ) {
              await sb
                .from("customers")
                .update({ phone2: phone })
                .eq("id", customerId);
            }
          }
        }
      }

      // 3) Still no match → create new customer
      if (!customerId) {
        const { data: newCust, error: custErr } = await sb
          .from("customers")
          .insert({
            tenant_id: tenant_id || 1,
            customer_name,
            phone: phone || null,
            email: email || null,
            service_address: service_address || null,
            city: city || null,
            state: state || null,
            zip: zip || null,
          })
          .select("id")
          .single();

        if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 });
        customerId = newCust.id;
      }
    }

    if (!customerId) {
      return NextResponse.json({ error: "Need customer_name or existing_customer_id" }, { status: 400 });
    }

    // Create work order
    const woNumber = `WO-${Date.now().toString().slice(-6)}`;
    const { data: wo, error: woErr } = await sb
      .from("work_orders")
      .insert({
        tenant_id: tenant_id || 1,
        customer_id: customerId,
        work_order_number: woNumber,
        appliance_type: appliance_type || null,
        job_type: "Diagnosis",
        status: "New",
      })
      .select("id, work_order_number")
      .single();

    if (woErr) return NextResponse.json({ error: woErr.message }, { status: 500 });

    // Add appliance detail if provided
    if (appliance_type) {
      await sb.from("appliance_details").insert({
        work_order_id: wo.id,
        tenant_id: tenant_id || 1,
        item: appliance_type,
        sort_order: 1,
      });
    }

    return NextResponse.json({
      success: true,
      customer_id: customerId,
      work_order_id: wo.id,
      work_order_number: wo.work_order_number,
    });
  } catch (error) {
    console.error("Create customer/WO error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
