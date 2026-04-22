import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/invoices/mark-paid
 * Body: { invoice_id, amount, method: "cash"|"check"|"other", note? }
 * Admin manual-entry for cash/check payments. Adds to amount_paid; sets status=paid when fully covered.
 */
export async function POST(request: NextRequest) {
  try {
    const { invoice_id, amount, method, note } = await request.json();
    if (!invoice_id || typeof amount !== "number" || amount <= 0) {
      return NextResponse.json({ error: "invoice_id and positive amount required" }, { status: 400 });
    }
    if (!["cash", "check", "other"].includes(method)) {
      return NextResponse.json({ error: "method must be cash|check|other" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const { data: inv } = await sb
      .from("invoices")
      .select("id, total, amount_paid, status, notes")
      .eq("id", invoice_id)
      .maybeSingle();

    if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    if (inv.status === "paid") return NextResponse.json({ error: "Already paid" }, { status: 400 });

    const newPaid = Number(inv.amount_paid || 0) + amount;
    const total = Number(inv.total) || 0;
    const fullyPaid = newPaid + 0.005 >= total;
    const newNote = note
      ? `${inv.notes ? inv.notes + "\n" : ""}Payment (${method}): $${amount.toFixed(2)} — ${note}`
      : inv.notes;

    await sb
      .from("invoices")
      .update({
        amount_paid: newPaid,
        paid_via: method,
        status: fullyPaid ? "paid" : "partial",
        paid_at: fullyPaid ? new Date().toISOString() : null,
        notes: newNote,
      })
      .eq("id", invoice_id);

    return NextResponse.json({ success: true, fullyPaid, amount_paid: newPaid });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "unknown error" }, { status: 500 });
  }
}
