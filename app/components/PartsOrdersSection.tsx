"use client";

import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Plus, Package, X, Trash2, CheckCircle2 } from "lucide-react";

interface Props {
  workOrderId: number;
  tenantId: number;
  workOrderStatus: string;
  onWorkOrderStatusChange?: (newStatus: string) => void;
}

interface PartsOrder {
  id: number;
  supplier: string;
  external_order_id: string | null;
  status: string;
  tracking_number: string | null;
  carrier: string | null;
  eta_date: string | null;
  total: number | null;
  notes: string | null;
  submitted_at: string | null;
  delivered_at: string | null;
  items: PartsOrderItem[];
}

interface PartsOrderItem {
  id: number;
  part_number: string;
  description: string | null;
  quantity: number;
  unit_price: number | null;
  line_total: number | null;
}

interface DraftItem {
  part_number: string;
  description: string;
  quantity: string;
  unit_price: string;
}

const SUPPLIERS = [
  { value: "marcone", label: "Marcone" },
  { value: "reliable_parts", label: "Reliable Parts" },
  { value: "other", label: "Other" },
];

const SUPPLIER_LABEL: Record<string, string> = Object.fromEntries(SUPPLIERS.map((s) => [s.value, s.label]));

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: "bg-gray-100", text: "text-gray-700", label: "Draft" },
  submitted: { bg: "bg-amber-100", text: "text-amber-700", label: "Ordered" },
  acknowledged: { bg: "bg-amber-100", text: "text-amber-700", label: "Acknowledged" },
  shipped: { bg: "bg-blue-100", text: "text-blue-700", label: "Shipped" },
  delivered: { bg: "bg-teal-100", text: "text-teal-700", label: "Arrived" },
  canceled: { bg: "bg-red-100", text: "text-red-700", label: "Canceled" },
};

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

export default function PartsOrdersSection({ workOrderId, tenantId, workOrderStatus, onWorkOrderStatusChange }: Props) {
  const [orders, setOrders] = useState<PartsOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const fetchOrders = useCallback(async () => {
    const { data } = await supabase
      .from("parts_orders")
      .select("*, items:parts_order_items(*)")
      .eq("work_order_id", workOrderId)
      .order("created_at", { ascending: false });
    setOrders((data as unknown as PartsOrder[]) || []);
    setLoading(false);
  }, [workOrderId]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const flipWorkOrderStatus = async (newStatus: string) => {
    if (workOrderStatus === newStatus) return;
    await supabase.from("work_orders").update({ status: newStatus }).eq("id", workOrderId);
    onWorkOrderStatusChange?.(newStatus);
  };

  const markArrived = async (orderId: number) => {
    if (!confirm("Mark this order as arrived? Work order will move to 'Parts Have Arrived'.")) return;
    await supabase
      .from("parts_orders")
      .update({ status: "delivered", delivered_at: new Date().toISOString() })
      .eq("id", orderId);
    await flipWorkOrderStatus("Parts Have Arrived");
    fetchOrders();
  };

  const cancelOrder = async (orderId: number) => {
    if (!confirm("Cancel this parts order? This cannot be undone.")) return;
    await supabase.from("parts_orders").update({ status: "canceled" }).eq("id", orderId);
    fetchOrders();
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Package size={18} className="text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">Parts Orders</h2>
          {orders.length > 0 && (
            <span className="text-xs text-gray-500">({orders.length})</span>
          )}
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100"
        >
          <Plus size={14} />
          New Order
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 py-6 text-center">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No parts orders yet.</p>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const style = STATUS_STYLES[order.status] || STATUS_STYLES.draft;
            return (
              <div key={order.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">
                        {SUPPLIER_LABEL[order.supplier] || order.supplier}
                      </span>
                      {order.external_order_id && (
                        <span className="text-xs text-gray-500">#{order.external_order_id}</span>
                      )}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${style.bg} ${style.text}`}>
                        {style.label}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      {order.submitted_at && <span>Ordered {new Date(order.submitted_at).toLocaleDateString()}</span>}
                      {order.eta_date && <span>ETA {new Date(order.eta_date + "T00:00:00").toLocaleDateString()}</span>}
                      {order.tracking_number && (
                        <span>
                          {order.carrier ? `${order.carrier} ` : ""}#{order.tracking_number}
                        </span>
                      )}
                      {order.total != null && <span>Total {fmt(order.total)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {order.status !== "delivered" && order.status !== "canceled" && (
                      <button
                        onClick={() => markArrived(order.id)}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-teal-700 bg-teal-50 rounded hover:bg-teal-100"
                      >
                        <CheckCircle2 size={12} />
                        Mark Arrived
                      </button>
                    )}
                    {order.status !== "canceled" && order.status !== "delivered" && (
                      <button
                        onClick={() => cancelOrder(order.id)}
                        className="p-1 text-gray-400 hover:text-red-600"
                        title="Cancel order"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
                {order.items && order.items.length > 0 && (
                  <div className="divide-y divide-gray-100 border-t border-gray-100 pt-2">
                    {order.items.map((item) => (
                      <div key={item.id} className="py-1.5 flex items-center justify-between text-sm">
                        <div>
                          <span className="font-mono text-gray-900">{item.part_number}</span>
                          {item.description && <span className="text-gray-500 ml-2">{item.description}</span>}
                        </div>
                        <div className="text-gray-600 tabular-nums">
                          ×{item.quantity}
                          {item.unit_price != null && <span className="text-gray-400 ml-2">@ {fmt(item.unit_price)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {order.notes && <p className="text-xs text-gray-500 mt-2 italic">{order.notes}</p>}
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <NewOrderModal
          workOrderId={workOrderId}
          tenantId={tenantId}
          onClose={() => setModalOpen(false)}
          onCreated={async () => {
            setModalOpen(false);
            await flipWorkOrderStatus("Parts Ordered");
            fetchOrders();
          }}
        />
      )}
    </div>
  );
}

function NewOrderModal({
  workOrderId,
  tenantId,
  onClose,
  onCreated,
}: {
  workOrderId: number;
  tenantId: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [supplier, setSupplier] = useState("marcone");
  const [externalOrderId, setExternalOrderId] = useState("");
  const [etaDate, setEtaDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([
    { part_number: "", description: "", quantity: "1", unit_price: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const addItem = () =>
    setItems((prev) => [...prev, { part_number: "", description: "", quantity: "1", unit_price: "" }]);
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: keyof DraftItem, value: string) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));

  const submit = async () => {
    setErr("");
    const validItems = items.filter((it) => it.part_number.trim());
    if (validItems.length === 0) {
      setErr("Add at least one part with a part number.");
      return;
    }

    setSaving(true);

    const subtotal = validItems.reduce((sum, it) => {
      const qty = parseInt(it.quantity) || 0;
      const price = parseFloat(it.unit_price) || 0;
      return sum + qty * price;
    }, 0);

    const { data: order, error: orderErr } = await supabase
      .from("parts_orders")
      .insert({
        tenant_id: tenantId,
        work_order_id: workOrderId,
        supplier,
        external_order_id: externalOrderId.trim() || null,
        status: "submitted",
        submitted_at: new Date().toISOString(),
        eta_date: etaDate || null,
        notes: notes.trim() || null,
        subtotal: subtotal || null,
        total: subtotal || null,
      })
      .select("id")
      .single();

    if (orderErr || !order) {
      setErr(orderErr?.message || "Failed to create order");
      setSaving(false);
      return;
    }

    const itemRows = validItems.map((it) => {
      const qty = parseInt(it.quantity) || 1;
      const price = parseFloat(it.unit_price);
      return {
        parts_order_id: order.id,
        tenant_id: tenantId,
        part_number: it.part_number.trim(),
        description: it.description.trim() || null,
        quantity: qty,
        unit_price: isNaN(price) ? null : price,
        line_total: isNaN(price) ? null : price * qty,
      };
    });

    const { error: itemsErr } = await supabase.from("parts_order_items").insert(itemRows);

    setSaving(false);
    if (itemsErr) {
      setErr(itemsErr.message);
      return;
    }
    onCreated();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 sticky top-0 bg-white">
          <h3 className="text-lg font-semibold text-gray-900">New Parts Order</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Supplier</label>
              <select
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
              >
                {SUPPLIERS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                Supplier Order # <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                value={externalOrderId}
                onChange={(e) => setExternalOrderId(e.target.value)}
                placeholder="e.g. SO-12345"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
              ETA <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="date"
              value={etaDate}
              onChange={(e) => setEtaDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase">Parts</label>
              <button onClick={addItem} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                + Add line
              </button>
            </div>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                  <input
                    value={it.part_number}
                    onChange={(e) => updateItem(idx, "part_number", e.target.value)}
                    placeholder="Part #"
                    className="col-span-3 px-2 py-1.5 text-sm border border-gray-300 rounded"
                  />
                  <input
                    value={it.description}
                    onChange={(e) => updateItem(idx, "description", e.target.value)}
                    placeholder="Description"
                    className="col-span-5 px-2 py-1.5 text-sm border border-gray-300 rounded"
                  />
                  <input
                    value={it.quantity}
                    onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                    placeholder="Qty"
                    inputMode="numeric"
                    className="col-span-1 px-2 py-1.5 text-sm border border-gray-300 rounded text-center"
                  />
                  <input
                    value={it.unit_price}
                    onChange={(e) => updateItem(idx, "unit_price", e.target.value)}
                    placeholder="Price"
                    inputMode="decimal"
                    className="col-span-2 px-2 py-1.5 text-sm border border-gray-300 rounded"
                  />
                  <button
                    onClick={() => removeItem(idx)}
                    disabled={items.length === 1}
                    className="col-span-1 p-1.5 text-gray-400 hover:text-red-600 disabled:opacity-30"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
              Notes <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
            />
          </div>

          {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-200 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Submit Order"}
          </button>
        </div>
      </div>
    </div>
  );
}
