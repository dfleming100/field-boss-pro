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

    // Match flow runs whenever we have at least one identifier (phone, name,
    // or address). If we end with no customerId we'll either create or 400.
    {
      // 1) Try to match by phone (matches phone OR phone2)
      const phoneDigits = (phone || "").replace(/\D/g, "");
      if (!customerId && phoneDigits.length >= 7) {
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

      // 2) Fallback to ADDRESS match if phone didn't hit. Address is the
      // unambiguous identifier — customers often text from spouse/work
      // phones not on file, but the service address is stable.
      if (!customerId && service_address) {
        const addrLower = service_address.toLowerCase().trim();
        const tokens: string[] = addrLower.match(/\d+|[a-z]{3,}/g) || [];
        const streetNum = tokens.find((t: string) => /^\d+$/.test(t));
        const streetWord = tokens.find(
          (t: string) => !/^\d+$/.test(t) && !["st","dr","ave","blvd","rd","ln","ct","cir","pkwy","apt","suite","unit"].includes(t)
        );
        if (streetNum && streetWord) {
          const { data: addrMatches } = await sb
            .from("customers")
            .select("id, customer_name, phone, phone2")
            .eq("tenant_id", tenant_id || 1)
            .ilike("service_address", `%${streetNum}%${streetWord}%`)
            .limit(10);

          let chosen: any = null;
          if (addrMatches && addrMatches.length === 1) {
            // Single match — accept it. Use this when caller didn't supply
            // a name (existing-customer SMS flow asks for address only).
            chosen = addrMatches[0];
          } else if (addrMatches && addrMatches.length > 1) {
            // Multiple records at same address (apt/duplex/etc). Need a
            // name to disambiguate. If we have one, find the share-a-word
            // match. Otherwise return ambiguous so the SMS handler asks
            // for name.
            if (customer_name) {
              const nameWords = customer_name.toLowerCase().split(/\s+/).filter((w: string) => w.length >= 3);
              chosen = addrMatches.find((c: any) => {
                const existingWords = (c.customer_name || "").toLowerCase().split(/\s+/).filter((w: string) => w.length >= 3);
                return existingWords.some((w: string) => nameWords.includes(w));
              });
            }
            if (!chosen && !customer_name) {
              // Ambiguous — let the caller ask for a name.
              return NextResponse.json({
                success: false,
                ambiguous: true,
                reason: "multiple_customers_at_address",
                match_count: addrMatches.length,
              });
            }
          }

          if (chosen) {
            customerId = chosen.id;
            // Save the inbound phone as phone2 if it isn't already on file
            const inboundLast10 = phoneDigits.slice(-10);
            const onFile1 = (chosen.phone || "").replace(/\D/g, "").slice(-10);
            const onFile2 = (chosen.phone2 || "").replace(/\D/g, "").slice(-10);
            if (
              inboundLast10.length === 10 &&
              inboundLast10 !== onFile1 &&
              inboundLast10 !== onFile2 &&
              !chosen.phone2
            ) {
              await sb.from("customers").update({ phone2: phone }).eq("id", customerId);
            }
          }
        }
      }

      // 3) Still no match — only create a NEW customer if we have a name.
      // Without a name (e.g. address didn't match anything), the SMS
      // handler should ask for one before we commit a record.
      if (!customerId && !customer_name) {
        return NextResponse.json({
          success: false,
          needs_name: true,
          reason: "no_match_and_no_name",
        });
      }
      if (!customerId && customer_name) {
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

    // If this customer already has an ACTIVE WO, reuse it instead of creating
    // a duplicate. Only "open" statuses count — Complete/canceled don't.
    // Saves us from spawning a new WO when an existing customer (recognized
    // by phone or address+name) texts in about a job already in flight.
    const ACTIVE_STATUSES = ["New Hold", "New", "Parts Needed", "Parts Ordered", "Parts Have Arrived", "Scheduled"];
    const { data: activeWo } = await sb
      .from("work_orders")
      .select("id, work_order_number, appliance_type")
      .eq("tenant_id", tenant_id || 1)
      .eq("customer_id", customerId)
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeWo) {
      // If the AI extracted an appliance and the existing WO doesn't have one,
      // backfill it now so routing/SMS templates work.
      if (appliance_type && !activeWo.appliance_type) {
        await sb
          .from("work_orders")
          .update({ appliance_type })
          .eq("id", activeWo.id);
      }
      return NextResponse.json({
        success: true,
        customer_id: customerId,
        work_order_id: activeWo.id,
        work_order_number: activeWo.work_order_number,
        reused_existing_wo: true,
      });
    }

    // No active WO — create a new one
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
