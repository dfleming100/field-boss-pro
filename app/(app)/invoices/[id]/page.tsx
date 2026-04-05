"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Send, CheckCircle2, Printer, DollarSign } from "lucide-react";

export default function InvoiceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const invoiceId = params.id as string;
  const { tenantUser } = useAuth();

  const [invoice, setInvoice] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const fetchInvoice = useCallback(async () => {
    if (!tenantUser) return;

    const [invRes, itemsRes] = await Promise.all([
      supabase
        .from("invoices")
        .select(`*, customer:customers(*), work_order:work_orders(work_order_number, appliance_type)`)
        .eq("id", invoiceId)
        .single(),
      supabase
        .from("invoice_items")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("created_at"),
    ]);

    if (invRes.data) setInvoice(invRes.data);
    if (itemsRes.data) setItems(itemsRes.data);
    setIsLoading(false);
  }, [tenantUser, invoiceId]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  const updateStatus = async (newStatus: string) => {
    const updateData: any = { status: newStatus };
    if (newStatus === "paid") updateData.paid_at = new Date().toISOString();

    await supabase.from("invoices").update(updateData).eq("id", invoiceId);
    setSuccessMsg(`Invoice marked as ${newStatus}`);
    setTimeout(() => setSuccessMsg(""), 3000);
    await fetchInvoice();
  };

  const formatCurrency = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!invoice) {
    return <div className="flex items-center justify-center py-24"><p className="text-gray-500">Invoice not found.</p></div>;
  }

  const customer = invoice.customer;
  const wo = invoice.work_order;

  const STATUS_COLORS: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700",
    sent: "bg-blue-100 text-blue-700",
    paid: "bg-green-100 text-green-700",
    overdue: "bg-red-100 text-red-700",
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{invoice.invoice_number}</h1>
              <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[invoice.status] || "bg-gray-100"}`}>
                {invoice.status}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              Created {new Date(invoice.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              {invoice.paid_at && ` — Paid ${new Date(invoice.paid_at).toLocaleDateString("en-US", { month: "long", day: "numeric" })}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {invoice.status === "draft" && (
            <button onClick={() => updateStatus("sent")} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
              <Send size={14} /> Mark Sent
            </button>
          )}
          {(invoice.status === "sent" || invoice.status === "overdue") && (
            <button onClick={() => updateStatus("paid")} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100">
              <CheckCircle2 size={14} /> Mark Paid
            </button>
          )}
          <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100">
            <Printer size={14} /> Print
          </button>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {successMsg && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{successMsg}</div>}

      {/* Invoice Body */}
      <div className="bg-white rounded-xl border border-gray-200 p-8">
        {/* From / To */}
        <div className="grid grid-cols-2 gap-8 mb-8 pb-8 border-b border-gray-200">
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">From</h3>
            <p className="text-sm font-semibold text-gray-900">Fleming Appliance Repair</p>
            <p className="text-sm text-gray-500">(855) 269-3196</p>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Bill To</h3>
            <Link href={`/customers/${customer?.id}`} className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">
              {customer?.customer_name || "—"}
            </Link>
            <p className="text-sm text-gray-500">{customer?.service_address}</p>
            <p className="text-sm text-gray-500">{[customer?.city, customer?.state, customer?.zip].filter(Boolean).join(", ")}</p>
            {customer?.phone && <p className="text-sm text-gray-500 mt-1">{customer.phone}</p>}
          </div>
        </div>

        {/* Work Order Reference */}
        {wo && (
          <div className="mb-6 p-3 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">
              Work Order: <Link href={`/work-orders/${invoice.work_order_id}`} className="font-medium text-indigo-600 hover:text-indigo-700">{wo.work_order_number}</Link>
              {wo.appliance_type && ` — ${wo.appliance_type}`}
            </p>
          </div>
        )}

        {/* Line Items */}
        <table className="w-full mb-6">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase">Description</th>
              <th className="text-center py-2 text-xs font-semibold text-gray-500 uppercase w-16">Qty</th>
              <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase w-24">Price</th>
              <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase w-24">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {/* Diagnosis */}
            <tr>
              <td className="py-3 text-sm text-gray-900">
                Diagnosis Fee {invoice.diagnosis_waived && <span className="text-gray-400 ml-1">(waived)</span>}
              </td>
              <td className="py-3 text-sm text-center text-gray-600">1</td>
              <td className="py-3 text-sm text-right text-gray-600">{formatCurrency(invoice.diagnosis_waived ? 0 : Number(invoice.diagnosis_fee))}</td>
              <td className="py-3 text-sm text-right font-medium text-gray-900">{formatCurrency(invoice.diagnosis_waived ? 0 : Number(invoice.diagnosis_fee))}</td>
            </tr>
            {/* Labor */}
            <tr>
              <td className="py-3 text-sm text-gray-900">Labor</td>
              <td className="py-3 text-sm text-center text-gray-600">1</td>
              <td className="py-3 text-sm text-right text-gray-600">{formatCurrency(Number(invoice.labor_fee))}</td>
              <td className="py-3 text-sm text-right font-medium text-gray-900">{formatCurrency(Number(invoice.labor_fee))}</td>
            </tr>
            {/* Parts */}
            {items.map((item) => (
              <tr key={item.id}>
                <td className="py-3 text-sm text-gray-900">{item.description}</td>
                <td className="py-3 text-sm text-center text-gray-600">{item.quantity}</td>
                <td className="py-3 text-sm text-right text-gray-600">{formatCurrency(Number(item.unit_price))}</td>
                <td className="py-3 text-sm text-right font-medium text-gray-900">{formatCurrency(Number(item.total))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Total */}
        <div className="border-t border-gray-200 pt-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Subtotal</span>
            <span className="text-gray-900">{formatCurrency(Number(invoice.subtotal))}</span>
          </div>
          {invoice.tax_enabled && Number(invoice.tax_amount) > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Tax ({(Number(invoice.tax_rate) * 100).toFixed(2)}%)</span>
              <span className="text-gray-900">{formatCurrency(Number(invoice.tax_amount))}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-100">
            <span className="text-gray-900">Total</span>
            <span className="text-indigo-600">{formatCurrency(Number(invoice.total))}</span>
          </div>
        </div>

        {/* Notes */}
        {invoice.notes && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-1">Notes</h3>
            <p className="text-sm text-gray-600">{invoice.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
