"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Plus, Trash2, Save } from "lucide-react";

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  item_type: string;
}

function NewInvoiceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenantUser } = useAuth();
  const woId = searchParams.get("wo");

  const [customers, setCustomers] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [workOrderId, setWorkOrderId] = useState(woId || "");
  const [diagnosisFee, setDiagnosisFee] = useState(75);
  const [diagnosisWaived, setDiagnosisWaived] = useState(false);
  const [laborFee, setLaborFee] = useState(125);
  const [items, setItems] = useState<LineItem[]>([]);
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxRate, setTaxRate] = useState(0);
  const [taxLabel, setTaxLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    if (!tenantUser) return;

    const [custRes, woRes, tenantRes] = await Promise.all([
      supabase.from("customers").select("id, customer_name, state").eq("tenant_id", tenantUser.tenant_id).order("customer_name"),
      supabase.from("work_orders").select("id, work_order_number, customer_id, appliance_type, job_type, status").eq("tenant_id", tenantUser.tenant_id).order("created_at", { ascending: false }),
      supabase.from("tenants").select("custom_tax_rate, tax_enabled_default").eq("id", tenantUser.tenant_id).single(),
    ]);

    if (custRes.data) setCustomers(custRes.data);
    if (woRes.data) setWorkOrders(woRes.data);
    if (tenantRes.data) {
      setTaxEnabled(tenantRes.data.tax_enabled_default || false);
      if (tenantRes.data.custom_tax_rate) {
        setTaxRate(Number(tenantRes.data.custom_tax_rate));
        setTaxLabel("Custom rate");
      }
    }

    // Auto-fill from WO if provided
    if (woId && woRes.data) {
      const wo = woRes.data.find((w: any) => String(w.id) === woId);
      if (wo) {
        setCustomerId(String(wo.customer_id));
        if (wo.job_type === "Repair Follow-up") {
          setDiagnosisWaived(true);
        }
      }
    }
  }, [tenantUser, woId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // When WO changes, auto-set customer
  useEffect(() => {
    if (workOrderId) {
      const wo = workOrders.find((w) => String(w.id) === workOrderId);
      if (wo) setCustomerId(String(wo.customer_id));
    }
  }, [workOrderId, workOrders]);

  // When customer changes, look up state tax rate
  useEffect(() => {
    if (!customerId) return;
    const cust = customers.find((c) => String(c.id) === customerId);
    if (cust?.state) {
      supabase
        .from("state_tax_rates")
        .select("rate, state_name")
        .eq("state_code", cust.state.toUpperCase())
        .single()
        .then(({ data }) => {
          if (data) {
            setTaxRate(Number(data.rate));
            setTaxLabel(`${data.state_name} (${(Number(data.rate) * 100).toFixed(2)}%)`);
          }
        });
    }
  }, [customerId, customers]);

  const addItem = () => {
    setItems([...items, { id: Date.now().toString(), description: "", quantity: 1, unit_price: 0, item_type: "part" }]);
  };

  const removeItem = (id: string) => {
    setItems(items.filter((i) => i.id !== id));
  };

  const updateItem = (id: string, field: string, value: any) => {
    setItems(items.map((i) => i.id === id ? { ...i, [field]: value } : i));
  };

  const partsTotal = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
  const diagnosisAmount = diagnosisWaived ? 0 : diagnosisFee;
  const subtotal = diagnosisAmount + laborFee + partsTotal;
  const taxAmount = taxEnabled ? subtotal * taxRate : 0;
  const total = subtotal + taxAmount;

  const formatCurrency = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  const handleSave = async () => {
    if (!customerId) { setError("Select a customer"); return; }
    setIsSaving(true);
    setError("");

    try {
      const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;

      const { data: invoice, error: invErr } = await supabase
        .from("invoices")
        .insert({
          tenant_id: tenantUser?.tenant_id,
          work_order_id: workOrderId ? parseInt(workOrderId) : null,
          customer_id: parseInt(customerId),
          invoice_number: invoiceNumber,
          status: "draft",
          diagnosis_fee: diagnosisAmount,
          labor_fee: laborFee,
          diagnosis_waived: diagnosisWaived,
          subtotal,
          tax_enabled: taxEnabled,
          tax_rate: taxEnabled ? taxRate : 0,
          tax_amount: taxAmount,
          total,
          notes,
        })
        .select("id")
        .single();

      if (invErr) throw invErr;

      // Insert line items
      if (items.length > 0) {
        const lineItems = items.map((i) => ({
          invoice_id: invoice.id,
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unit_price,
          total: i.quantity * i.unit_price,
          item_type: i.item_type,
        }));

        await supabase.from("invoice_items").insert(lineItems);
      }

      router.push(`/invoices/${invoice.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Create Invoice</h1>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      <div className="space-y-6">
        {/* Customer & Work Order */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Customer & Work Order</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Work Order</label>
              <select
                value={workOrderId}
                onChange={(e) => setWorkOrderId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
              >
                <option value="">None (standalone invoice)</option>
                {workOrders.map((wo) => (
                  <option key={wo.id} value={wo.id}>{wo.work_order_number} — {wo.appliance_type}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer *</label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                required
              >
                <option value="">Select customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.customer_name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Fees */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Service Fees</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700">Diagnosis Fee</label>
                <label className="flex items-center gap-2 text-sm text-gray-500">
                  <input
                    type="checkbox"
                    checked={diagnosisWaived}
                    onChange={(e) => setDiagnosisWaived(e.target.checked)}
                    className="rounded border-gray-300 text-indigo-600"
                  />
                  Waived (repair follow-up)
                </label>
              </div>
              <input
                type="number"
                value={diagnosisFee}
                onChange={(e) => setDiagnosisFee(parseFloat(e.target.value) || 0)}
                disabled={diagnosisWaived}
                className="w-24 px-3 py-2 text-sm border border-gray-300 rounded-lg text-right disabled:bg-gray-100"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Labor</label>
              <input
                type="number"
                value={laborFee}
                onChange={(e) => setLaborFee(parseFloat(e.target.value) || 0)}
                className="w-24 px-3 py-2 text-sm border border-gray-300 rounded-lg text-right"
              />
            </div>
          </div>
        </div>

        {/* Parts / Items */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Parts & Materials</h2>
            <button onClick={addItem} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100">
              <Plus size={14} />
              Add Item
            </button>
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No parts added. Click &quot;Add Item&quot; to add parts.</p>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => updateItem(item.id, "description", e.target.value)}
                    placeholder="Part description"
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg"
                  />
                  <input
                    type="number"
                    value={item.quantity}
                    onChange={(e) => updateItem(item.id, "quantity", parseInt(e.target.value) || 1)}
                    className="w-16 px-3 py-2 text-sm border border-gray-300 rounded-lg text-center"
                    min={1}
                  />
                  <input
                    type="number"
                    value={item.unit_price}
                    onChange={(e) => updateItem(item.id, "unit_price", parseFloat(e.target.value) || 0)}
                    placeholder="Price"
                    className="w-24 px-3 py-2 text-sm border border-gray-300 rounded-lg text-right"
                    step="0.01"
                  />
                  <span className="w-20 text-sm text-right text-gray-600">{formatCurrency(item.quantity * item.unit_price)}</span>
                  <button onClick={() => removeItem(item.id)} className="p-1.5 text-gray-400 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Additional notes for the customer..."
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
          />
        </div>

        {/* Tax Toggle */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-900">Sales Tax</h2>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={taxEnabled}
                onChange={(e) => setTaxEnabled(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 w-5 h-5"
              />
              <span className="text-sm font-medium text-gray-700">{taxEnabled ? "On" : "Off"}</span>
            </label>
          </div>
          {taxEnabled && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">{taxLabel || "Tax rate"}</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={(taxRate * 100).toFixed(2)}
                  onChange={(e) => setTaxRate(parseFloat(e.target.value) / 100 || 0)}
                  className="w-20 px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-right"
                  step="0.01"
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
            </div>
          )}
        </div>

        {/* Total */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Diagnosis</span>
              <span className={diagnosisWaived ? "line-through text-gray-400" : "text-gray-900"}>{formatCurrency(diagnosisFee)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Labor</span>
              <span className="text-gray-900">{formatCurrency(laborFee)}</span>
            </div>
            {partsTotal > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">Parts ({items.length} item{items.length !== 1 ? "s" : ""})</span>
                <span className="text-gray-900">{formatCurrency(partsTotal)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-gray-200 pt-2">
              <span className="text-gray-500">Subtotal</span>
              <span className="text-gray-900 font-medium">{formatCurrency(subtotal)}</span>
            </div>
            {taxEnabled && (
              <div className="flex justify-between">
                <span className="text-gray-500">Tax ({(taxRate * 100).toFixed(2)}%)</span>
                <span className="text-gray-900">{formatCurrency(taxAmount)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-gray-200 pt-2 text-lg font-bold">
              <span className="text-gray-900">Total</span>
              <span className="text-indigo-600">{formatCurrency(total)}</span>
            </div>
          </div>
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          <Save size={16} />
          {isSaving ? "Creating..." : "Create Invoice"}
        </button>
      </div>
    </div>
  );
}

export default function NewInvoicePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="text-sm text-gray-500">Loading...</div></div>}>
      <NewInvoiceContent />
    </Suspense>
  );
}
