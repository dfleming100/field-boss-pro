"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Send, CheckCircle2, Printer, Pencil, Save, Plus, Trash2, X, MessageSquare, Mail, Link2, DollarSign } from "lucide-react";

interface LineItem {
  id: number | string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  item_type: string;
  isNew?: boolean;
}

export default function InvoiceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const invoiceId = params.id as string;
  const { tenantUser } = useAuth();

  const [invoice, setInvoice] = useState<any>(null);
  const [items, setItems] = useState<LineItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Edit form state
  const [diagnosisFee, setDiagnosisFee] = useState(0);
  const [diagnosisWaived, setDiagnosisWaived] = useState(false);
  const [laborFee, setLaborFee] = useState(0);
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxRate, setTaxRate] = useState(0);
  const [notes, setNotes] = useState("");
  const [editItems, setEditItems] = useState<LineItem[]>([]);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "check" | "other">("cash");
  const [paymentAmount, setPaymentAmount] = useState<string>("");
  const [paymentNote, setPaymentNote] = useState("");
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);

  const recordPayment = async () => {
    const amt = Number(paymentAmount);
    if (!amt || amt <= 0) {
      setError("Enter a valid amount");
      return;
    }
    setIsRecordingPayment(true);
    setError("");
    try {
      const res = await fetch("/api/invoices/mark-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: invoiceId, amount: amt, method: paymentMethod, note: paymentNote || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to record payment");
        return;
      }
      setSuccessMsg(data.fullyPaid ? "Invoice paid in full" : `Payment recorded — $${Number(data.amount_paid).toFixed(2)} of total`);
      setTimeout(() => setSuccessMsg(""), 4000);
      setPaymentModalOpen(false);
      setPaymentNote("");
      await fetchInvoice();
    } finally {
      setIsRecordingPayment(false);
    }
  };

  const fetchInvoice = useCallback(async () => {
    if (!tenantUser) return;

    const [invRes, itemsRes] = await Promise.all([
      supabase
        .from("invoices")
        .select(`*, customer:customers(*), work_order:work_orders(work_order_number, appliance_type), tenant:tenants(name, contact_phone, contact_email)`)
        .eq("id", invoiceId)
        .single(),
      supabase
        .from("invoice_items")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("created_at"),
    ]);

    if (invRes.data) {
      setInvoice(invRes.data);
      setDiagnosisFee(Number(invRes.data.diagnosis_fee) || 75);
      setDiagnosisWaived(invRes.data.diagnosis_waived || false);
      setLaborFee(Number(invRes.data.labor_fee) || 125);
      setTaxEnabled(invRes.data.tax_enabled || false);
      setTaxRate(Number(invRes.data.tax_rate) || 0);
      setNotes(invRes.data.notes || "");
    }
    if (itemsRes.data) {
      setItems(itemsRes.data);
      setEditItems(itemsRes.data.map((i: any) => ({ ...i })));
    }
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

  const sendInvoice = async (method: "sms" | "email" | "both") => {
    setIsSending(true);
    setError("");
    try {
      const res = await fetch("/api/invoices/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: invoiceId, method }),
      });
      const data = await res.json();
      if (data.success) {
        const msgs = [];
        if (data.sms) msgs.push("SMS sent");
        if (data.email) msgs.push("Email sent");
        if (msgs.length === 0) msgs.push("Invoice link ready");
        setSuccessMsg(`${msgs.join(" & ")} — ${data.invoice_url}`);
      } else {
        setError(data.error || "Failed to send");
      }
      setTimeout(() => setSuccessMsg(""), 8000);
      await fetchInvoice();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSending(false);
    }
  };

  const copyLink = () => {
    const url = `${window.location.origin}/invoice/${invoiceId}`;
    navigator.clipboard.writeText(url);
    setSuccessMsg("Invoice link copied!");
    setTimeout(() => setSuccessMsg(""), 3000);
  };

  // Edit functions
  const startEdit = () => {
    setEditItems(items.map((i) => ({ ...i })));
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setDiagnosisFee(Number(invoice.diagnosis_fee) || 75);
    setDiagnosisWaived(invoice.diagnosis_waived || false);
    setLaborFee(Number(invoice.labor_fee) || 125);
    setTaxEnabled(invoice.tax_enabled || false);
    setTaxRate(Number(invoice.tax_rate) || 0);
    setNotes(invoice.notes || "");
    setEditItems(items.map((i) => ({ ...i })));
    setIsEditing(false);
  };

  const addItem = () => {
    setEditItems([...editItems, { id: `new-${Date.now()}`, description: "", quantity: 1, unit_price: 0, total: 0, item_type: "part", isNew: true }]);
  };

  const removeItem = (id: number | string) => {
    setEditItems(editItems.filter((i) => i.id !== id));
  };

  const updateItem = (id: number | string, field: string, value: any) => {
    setEditItems(editItems.map((i) => {
      if (i.id !== id) return i;
      const updated = { ...i, [field]: value };
      updated.total = updated.quantity * updated.unit_price;
      return updated;
    }));
  };

  const partsTotal = editItems.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
  const diagnosisAmount = diagnosisWaived ? 0 : diagnosisFee;
  const subtotal = diagnosisAmount + laborFee + partsTotal;
  const taxAmount = taxEnabled ? subtotal * taxRate : 0;
  const total = subtotal + taxAmount;

  const saveEdit = async () => {
    setIsSaving(true);
    setError("");

    try {
      // Update invoice
      await supabase.from("invoices").update({
        diagnosis_fee: diagnosisAmount,
        labor_fee: laborFee,
        diagnosis_waived: diagnosisWaived,
        tax_enabled: taxEnabled,
        tax_rate: taxEnabled ? taxRate : 0,
        tax_amount: taxAmount,
        subtotal,
        total,
        notes,
      }).eq("id", invoiceId);

      // Delete old items and insert new ones
      await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId);

      const validItems = editItems.filter((i) => i.description.trim());
      if (validItems.length > 0) {
        await supabase.from("invoice_items").insert(
          validItems.map((i) => ({
            invoice_id: parseInt(invoiceId),
            description: i.description,
            quantity: i.quantity,
            unit_price: i.unit_price,
            total: i.quantity * i.unit_price,
            item_type: i.item_type,
          }))
        );
      }

      setIsEditing(false);
      setSuccessMsg("Invoice updated");
      setTimeout(() => setSuccessMsg(""), 3000);
      await fetchInvoice();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const formatCurrency = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

  if (isLoading) {
    return <div className="flex items-center justify-center py-24"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (!invoice) {
    return <div className="flex items-center justify-center py-24"><p className="text-gray-500">Invoice not found.</p></div>;
  }

  const customer = invoice.customer;
  const wo = invoice.work_order;
  const tenant = invoice.tenant;

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
          {!isEditing && (
            <>
              <button onClick={startEdit} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100">
                <Pencil size={14} /> Edit
              </button>
              <button
                onClick={() => sendInvoice("sms")}
                disabled={isSending}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100 disabled:opacity-50"
              >
                <MessageSquare size={14} /> Text
              </button>
              <button
                onClick={() => sendInvoice("email")}
                disabled={isSending}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-purple-700 bg-purple-50 rounded-lg hover:bg-purple-100 disabled:opacity-50"
              >
                <Mail size={14} /> Email
              </button>
              <button onClick={copyLink} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100">
                <Link2 size={14} /> Copy Link
              </button>
              {invoice.status !== "paid" && (
                <button
                  onClick={() => {
                    const outstanding = Math.max(0, Number(invoice.total || 0) - Number(invoice.amount_paid || 0));
                    setPaymentAmount(outstanding.toFixed(2));
                    setPaymentModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100"
                >
                  <DollarSign size={14} /> Record Payment
                </button>
              )}
              <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100">
                <Printer size={14} /> Print
              </button>
            </>
          )}
          {isEditing && (
            <>
              <button onClick={cancelEdit} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                <X size={14} /> Cancel
              </button>
              <button onClick={saveEdit} disabled={isSaving} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                <Save size={14} /> {isSaving ? "Saving..." : "Save"}
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {successMsg && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{successMsg}</div>}

      <div className="bg-white rounded-xl border border-gray-200 p-8">
        {/* From / To */}
        <div className="grid grid-cols-2 gap-8 mb-8 pb-8 border-b border-gray-200">
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">From</h3>
            <p className="text-sm font-semibold text-gray-900">{tenant?.name || "Company"}</p>
            {tenant?.contact_phone && <p className="text-sm text-gray-500">{tenant.contact_phone}</p>}
            {tenant?.contact_email && <p className="text-sm text-gray-500">{tenant.contact_email}</p>}
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

        {wo && (
          <div className="mb-6 p-3 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">
              Work Order: <Link href={`/work-orders/${invoice.work_order_id}`} className="font-medium text-indigo-600 hover:text-indigo-700">{wo.work_order_number}</Link>
              {wo.appliance_type && ` — ${wo.appliance_type}`}
            </p>
          </div>
        )}

        {/* Line Items */}
        {isEditing ? (
          <div className="mb-6">
            {/* Editable fees */}
            <div className="space-y-3 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-700">Diagnosis Fee</span>
                  <label className="flex items-center gap-1 text-xs text-gray-500">
                    <input type="checkbox" checked={diagnosisWaived} onChange={(e) => setDiagnosisWaived(e.target.checked)} className="rounded border-gray-300 text-indigo-600" />
                    Waived
                  </label>
                </div>
                <input type="number" value={diagnosisFee} onChange={(e) => setDiagnosisFee(parseFloat(e.target.value) || 0)} disabled={diagnosisWaived} className="w-24 px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-right disabled:bg-gray-100" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Labor</span>
                <input type="number" value={laborFee} onChange={(e) => setLaborFee(parseFloat(e.target.value) || 0)} className="w-24 px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-right" />
              </div>
            </div>

            {/* Editable parts */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Parts & Materials</h3>
              <button onClick={addItem} className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 rounded hover:bg-indigo-100">
                <Plus size={12} /> Add
              </button>
            </div>
            {editItems.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-3">No parts</p>
            ) : (
              <div className="space-y-2">
                {editItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <input type="text" value={item.description} onChange={(e) => updateItem(item.id, "description", e.target.value)} placeholder="Description" className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg" />
                    <input type="number" value={item.quantity} onChange={(e) => updateItem(item.id, "quantity", parseInt(e.target.value) || 1)} className="w-14 px-2 py-1.5 text-sm border border-gray-300 rounded-lg text-center" min={1} />
                    <input type="number" value={item.unit_price} onChange={(e) => updateItem(item.id, "unit_price", parseFloat(e.target.value) || 0)} className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded-lg text-right" step="0.01" />
                    <span className="w-16 text-sm text-right text-gray-600">{formatCurrency(item.quantity * item.unit_price)}</span>
                    <button onClick={() => removeItem(item.id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}

            {/* Tax toggle */}
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={taxEnabled} onChange={(e) => setTaxEnabled(e.target.checked)} className="rounded border-gray-300 text-indigo-600 w-4 h-4" />
                  Sales Tax
                </label>
                {taxEnabled && (
                  <div className="flex items-center gap-1">
                    <input type="number" value={(taxRate * 100).toFixed(2)} onChange={(e) => setTaxRate(parseFloat(e.target.value) / 100 || 0)} className="w-16 px-2 py-1 text-sm border border-gray-300 rounded-lg text-right" step="0.01" />
                    <span className="text-sm text-gray-500">%</span>
                  </div>
                )}
              </div>
            </div>

            {/* Edit totals */}
            <div className="mt-4 pt-4 border-t border-gray-200 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
              {taxEnabled && <div className="flex justify-between"><span className="text-gray-500">Tax ({(taxRate * 100).toFixed(2)}%)</span><span>{formatCurrency(taxAmount)}</span></div>}
              <div className="flex justify-between text-lg font-bold pt-1"><span>Total</span><span className="text-indigo-600">{formatCurrency(total)}</span></div>
            </div>
          </div>
        ) : (
          <>
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
                  <td className="py-3 text-sm text-gray-900">Diagnosis Fee {invoice.diagnosis_waived && <span className="text-gray-400 ml-1">(waived)</span>}</td>
                  <td className="py-3 text-sm text-center text-gray-600">1</td>
                  <td className="py-3 text-sm text-right text-gray-600">{formatCurrency(invoice.diagnosis_waived ? 0 : Number(invoice.diagnosis_fee))}</td>
                  <td className="py-3 text-sm text-right font-medium text-gray-900">{formatCurrency(invoice.diagnosis_waived ? 0 : Number(invoice.diagnosis_fee))}</td>
                </tr>
                <tr>
                  <td className="py-3 text-sm text-gray-900">Labor</td>
                  <td className="py-3 text-sm text-center text-gray-600">1</td>
                  <td className="py-3 text-sm text-right text-gray-600">{formatCurrency(Number(invoice.labor_fee))}</td>
                  <td className="py-3 text-sm text-right font-medium text-gray-900">{formatCurrency(Number(invoice.labor_fee))}</td>
                </tr>
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
          </>
        )}

        {/* Notes */}
        {isEditing ? (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="Additional notes..." />
          </div>
        ) : invoice.notes ? (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-1">Notes</h3>
            <p className="text-sm text-gray-600">{invoice.notes}</p>
          </div>
        ) : null}
      </div>

      {paymentModalOpen && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setPaymentModalOpen(false)}
        >
          <div
            className="bg-white rounded-xl w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900 mb-1">Record Payment</h3>
            <p className="text-xs text-gray-500 mb-4">
              Log a cash, check, or other manual payment against this invoice.
            </p>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Method</label>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {(["cash", "check", "other"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={`px-3 py-2 text-sm font-medium rounded-lg border capitalize ${
                    paymentMethod === m
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Amount</label>
            <input
              type="number"
              step="0.01"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg mb-3"
              placeholder="0.00"
              autoFocus
            />
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Note (optional)</label>
            <input
              type="text"
              value={paymentNote}
              onChange={(e) => setPaymentNote(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg mb-4"
              placeholder="Check #1234, tip included, etc."
            />
            <div className="flex gap-2">
              <button
                onClick={() => setPaymentModalOpen(false)}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={recordPayment}
                disabled={isRecordingPayment}
                className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {isRecordingPayment ? "Recording..." : "Record Payment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
