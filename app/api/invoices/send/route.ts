import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/invoices/send
 * Sends invoice to customer via SMS and/or email.
 * Body: { invoice_id, method: "sms" | "email" | "both" }
 */
export async function POST(request: NextRequest) {
  try {
    const { invoice_id, method } = await request.json();
    const sb = supabaseAdmin();

    const { data: invoice } = await sb
      .from("invoices")
      .select(`
        *,
        customer:customers(customer_name, phone, email),
        tenant:tenants(name, contact_phone)
      `)
      .eq("id", invoice_id)
      .single();

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const customer = invoice.customer as any;
    const tenant = invoice.tenant as any;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://field-boss-pro.vercel.app";
    const invoiceUrl = `${appUrl}/invoice/${invoice_id}`;
    const firstName = customer?.customer_name?.split(" ")[0] || "there";
    const total = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(invoice.total));
    const tenantName = tenant?.name || "Fleming Appliance Repair";

    const results: any = { sms: false, email: false };

    // Send SMS
    if ((method === "sms" || method === "both") && customer?.phone) {
      const { data: integration } = await sb
        .from("tenant_integrations")
        .select("encrypted_keys")
        .eq("tenant_id", invoice.tenant_id)
        .eq("integration_type", "twilio")
        .eq("is_configured", true)
        .single();

      if (integration) {
        const creds = integration.encrypted_keys as any;
        const phoneDigits = customer.phone.replace(/\D/g, "");
        const toPhone = phoneDigits.length === 10 ? `+1${phoneDigits}` : `+${phoneDigits}`;
        const basicAuth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");

        const smsBody = `Hi ${firstName}, here is your invoice from ${tenantName} for ${total}. View and pay online: ${invoiceUrl}`;

        const smsRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`,
          {
            method: "POST",
            headers: { Authorization: `Basic ${basicAuth}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ From: creds.phoneNumber, To: toPhone, Body: smsBody }),
          }
        );

        results.sms = smsRes.ok;

        // Store in conversation history
        await sb.from("sms_conversations").insert({
          tenant_id: invoice.tenant_id, phone: toPhone, direction: "outbound", body: smsBody,
        });

        await sb.from("sms_logs").insert({
          tenant_id: invoice.tenant_id, recipient_phone: toPhone,
          message_type: "invoice", status: smsRes.ok ? "sent" : "failed",
        });
      }
    }

    // Send Email (using Resend or similar — for now, log it)
    if ((method === "email" || method === "both") && customer?.email) {
      // Check if we have an email provider configured
      // For now, we'll use a simple approach — this can be upgraded to Resend/SendGrid later
      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY || ""}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `${tenantName} <noreply@fieldbosspro.com>`,
            to: customer.email,
            subject: `Invoice ${invoice.invoice_number} — ${total}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
                <h2 style="color: #1e293b;">Invoice from ${tenantName}</h2>
                <p>Hi ${firstName},</p>
                <p>Here is your invoice for <strong>${total}</strong>.</p>
                <p><strong>Invoice #:</strong> ${invoice.invoice_number}</p>
                <a href="${invoiceUrl}" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; margin: 16px 0;">
                  View & Pay Invoice
                </a>
                <p style="color: #64748b; font-size: 12px; margin-top: 24px;">
                  ${tenantName}${tenant?.contact_phone ? ` • ${tenant.contact_phone}` : ""}${tenant?.contact_email ? ` • ${tenant.contact_email}` : ""}
                </p>
              </div>
            `,
          }),
        });
        results.email = emailRes.ok;
      } catch {
        // Email provider not configured — that's ok
        results.email = false;
        results.email_note = "Email provider not configured. Add RESEND_API_KEY to enable.";
      }
    }

    // Update invoice status to sent
    if (invoice.status === "draft") {
      await sb.from("invoices").update({ status: "sent" }).eq("id", invoice_id);
    }

    return NextResponse.json({ success: true, invoice_url: invoiceUrl, ...results });
  } catch (error) {
    console.error("Send invoice error:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
