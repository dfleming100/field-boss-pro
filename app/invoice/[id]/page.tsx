"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CreditCard, CheckCircle2 } from "lucide-react";

export default function PublicInvoicePage() {
  const params = useParams();
  const invoiceId = params.id as string;
  const [invoice, setInvoice] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaying, setIsPaying] = useState(false);

  useEffect(() => {
    const fetchInvoice = async () => {
      const res = await fetch(`/api/invoices/public/${invoiceId}`);
      const data = await res.json();
      if (data.invoice) {
        setInvoice(data.invoice);
        setItems(data.items || []);
      }
      setIsLoading(false);
    };
    fetchInvoice();
  }, [invoiceId]);

  const handlePay = async () => {
    setIsPaying(true);
    try {
      const res = await fetch("/api/invoices/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: invoiceId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setIsPaying(false);
    }
  };

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Invoice not found.</p>
      </div>
    );
  }

  const customer = invoice.customer;
  const tenant = invoice.tenant;
  const isPaid = invoice.status === "paid";

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{tenant?.name || "Invoice"}</h1>
          {tenant?.contact_phone && <p className="text-sm text-gray-500">{tenant.contact_phone}</p>}
          {tenant?.contact_email && <p className="text-sm text-gray-500">{tenant.contact_email}</p>}
        </div>

        {isPaid && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl flex items-center justify-center gap-2">
            <CheckCircle2 size={20} className="text-green-600" />
            <span className="text-green-700 font-semibold">Paid — Thank you!</span>
          </div>
        )}

        <div className="relative bg-white rounded-xl border border-gray-200 p-8 shadow-sm">
          {isPaid && (
            <div className="pointer-events-none absolute top-8 right-8 sm:top-12 sm:right-12 -rotate-12 border-4 border-green-600 rounded-xl px-6 py-2 bg-green-50/90">
              <div className="text-green-600 text-3xl sm:text-4xl font-black tracking-widest text-center">PAID</div>
              {invoice.paid_at && (
                <div className="text-green-600 text-[10px] font-bold text-center">
                  {new Date(invoice.paid_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </div>
              )}
            </div>
          )}
          {/* Invoice number and date */}
          <div className="flex justify-between mb-6 pb-6 border-b border-gray-200">
            <div>
              <p className="text-xs text-gray-500 uppercase font-semibold">Invoice</p>
              <p className="text-lg font-bold text-gray-900">{invoice.invoice_number}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 uppercase font-semibold">Date</p>
              <p className="text-sm text-gray-900">
                {new Date(invoice.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </p>
            </div>
          </div>

          {/* Bill To */}
          <div className="mb-6 pb-6 border-b border-gray-200">
            <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Bill To</p>
            <p className="text-sm font-semibold text-gray-900">{customer?.customer_name}</p>
            {customer?.service_address && <p className="text-sm text-gray-500">{customer.service_address}</p>}
            <p className="text-sm text-gray-500">{[customer?.city, customer?.state, customer?.zip].filter(Boolean).join(", ")}</p>
          </div>

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
              <tr>
                <td className="py-3 text-sm text-gray-900">
                  Diagnosis Fee {invoice.diagnosis_waived && <span className="text-gray-400">(waived)</span>}
                </td>
                <td className="py-3 text-sm text-center text-gray-600">1</td>
                <td className="py-3 text-sm text-right text-gray-600">{formatCurrency(invoice.diagnosis_waived ? 0 : Number(invoice.diagnosis_fee))}</td>
                <td className="py-3 text-sm text-right font-medium">{formatCurrency(invoice.diagnosis_waived ? 0 : Number(invoice.diagnosis_fee))}</td>
              </tr>
              <tr>
                <td className="py-3 text-sm text-gray-900">Labor</td>
                <td className="py-3 text-sm text-center text-gray-600">1</td>
                <td className="py-3 text-sm text-right text-gray-600">{formatCurrency(Number(invoice.labor_fee))}</td>
                <td className="py-3 text-sm text-right font-medium">{formatCurrency(Number(invoice.labor_fee))}</td>
              </tr>
              {items.map((item: any) => (
                <tr key={item.id}>
                  <td className="py-3 text-sm text-gray-900">{item.description}</td>
                  <td className="py-3 text-sm text-center text-gray-600">{item.quantity}</td>
                  <td className="py-3 text-sm text-right text-gray-600">{formatCurrency(Number(item.unit_price))}</td>
                  <td className="py-3 text-sm text-right font-medium">{formatCurrency(Number(item.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="border-t border-gray-200 pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span>{formatCurrency(Number(invoice.subtotal))}</span>
            </div>
            {invoice.tax_enabled && Number(invoice.tax_amount) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Tax ({(Number(invoice.tax_rate) * 100).toFixed(2)}%)</span>
                <span>{formatCurrency(Number(invoice.tax_amount))}</span>
              </div>
            )}
            <div className="flex justify-between text-xl font-bold pt-2 border-t border-gray-100">
              <span>Total</span>
              <span className="text-indigo-600">{formatCurrency(Number(invoice.total))}</span>
            </div>
          </div>

          {invoice.notes && (
            <div className="mt-6 pt-4 border-t border-gray-200">
              <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Notes</p>
              <p className="text-sm text-gray-600">{invoice.notes}</p>
            </div>
          )}
        </div>

        {/* Pay Button */}
        {!isPaid && (
          <button
            onClick={handlePay}
            disabled={isPaying}
            className="mt-6 w-full flex items-center justify-center gap-2 px-6 py-4 bg-indigo-600 text-white font-bold text-lg rounded-xl hover:bg-indigo-700 disabled:opacity-50 shadow-lg"
          >
            <CreditCard size={22} />
            {isPaying ? "Redirecting to payment..." : `Pay ${formatCurrency(Number(invoice.total))}`}
          </button>
        )}

        <p className="text-center text-xs text-gray-400 mt-4">
          Powered by Field Boss Pro
        </p>
      </div>
    </div>
  );
}
