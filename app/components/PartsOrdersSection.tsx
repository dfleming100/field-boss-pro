"use client";

import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Plus, Package, X, Trash2, CheckCircle2, Search, RefreshCw, ExternalLink, AlertTriangle } from "lucide-react";

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
  delivery_charge: number | null;
  sales_tax: number | null;
  notes: string | null;
  submitted_at: string | null;
  delivered_at: string | null;
  last_status_check_at: string | null;
  marcone_po_number: string | null;
  items: PartsOrderItem[];
}

interface PartsOrderItem {
  id: number;
  part_number: string;
  description: string | null;
  quantity: number;
  unit_price: number | null;
  line_total: number | null;
  marcone_make: string | null;
  marcone_warehouse_number: string | null;
  marcone_warehouse_name: string | null;
  dealer_price: number | null;
  list_price: number | null;
  is_hazmat: boolean | null;
  is_oversize: boolean | null;
  is_discontinued: boolean | null;
}

interface DraftItem {
  // Marcone-sourced fields
  marcone_make?: string;
  marcone_warehouse_number?: string;
  marcone_warehouse_name?: string;
  dealer_price?: number;
  list_price?: number;
  is_hazmat?: boolean;
  is_oversize?: boolean;
  is_discontinued?: boolean;
  weight?: number;
  // Common fields
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
  return `$${Number(n).toFixed(2)}`;
}

function trackingUrl(carrier: string | null, tracking: string | null): string | null {
  if (!tracking) return null;
  const c = (carrier || "").toLowerCase();
  if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${tracking}`;
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${tracking}`;
  return null;
}

export default function PartsOrdersSection({ workOrderId, tenantId, workOrderStatus, onWorkOrderStatusChange }: Props) {
  const [orders, setOrders] = useState<PartsOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);

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

  const refreshStatus = async (orderId: number) => {
    setRefreshingId(orderId);
    try {
      const res = await fetch("/api/marcone/orders/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts_order_id: orderId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`Couldn't refresh: ${data.error || "Unknown error"}`);
      } else if (data.status === "delivered") {
        await flipWorkOrderStatus("Parts Have Arrived");
      }
      await fetchOrders();
    } finally {
      setRefreshingId(null);
    }
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
            const trackUrl = trackingUrl(order.carrier, order.tracking_number);
            const isMarcone = order.supplier === "marcone";
            const canRefresh = isMarcone && order.external_order_id && !["delivered", "canceled"].includes(order.status);
            return (
              <div key={order.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1">
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
                        trackUrl ? (
                          <a href={trackUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-1">
                            {order.carrier ? `${order.carrier} ` : ""}#{order.tracking_number}
                            <ExternalLink size={10} />
                          </a>
                        ) : (
                          <span>{order.carrier ? `${order.carrier} ` : ""}#{order.tracking_number}</span>
                        )
                      )}
                      {order.total != null && <span>Total {fmt(order.total)}</span>}
                      {order.last_status_check_at && (
                        <span>Synced {new Date(order.last_status_check_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {canRefresh && (
                      <button
                        onClick={() => refreshStatus(order.id)}
                        disabled={refreshingId === order.id}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 rounded hover:bg-indigo-100 disabled:opacity-50"
                        title="Pull latest status from Marcone"
                      >
                        <RefreshCw size={12} className={refreshingId === order.id ? "animate-spin" : ""} />
                        {refreshingId === order.id ? "..." : "Sync"}
                      </button>
                    )}
                    {order.status !== "delivered" && order.status !== "canceled" && (
                      <button
                        onClick={() => markArrived(order.id)}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-teal-700 bg-teal-50 rounded hover:bg-teal-100"
                      >
                        <CheckCircle2 size={12} />
                        Arrived
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
                        <div className="flex-1">
                          <span className="font-mono text-gray-900">{item.part_number}</span>
                          {item.marcone_make && <span className="text-gray-400 text-xs ml-2">{item.marcone_make}</span>}
                          {item.description && <span className="text-gray-500 ml-2">{item.description}</span>}
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {item.is_hazmat && <span className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-700 rounded font-semibold">HAZMAT</span>}
                            {item.is_oversize && <span className="text-[10px] px-1.5 py-0.5 bg-orange-50 text-orange-700 rounded font-semibold">OVERSIZE</span>}
                            {item.is_discontinued && <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-semibold">DISCONTINUED</span>}
                            {item.marcone_warehouse_name && <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">{item.marcone_warehouse_name}</span>}
                          </div>
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

// ───────────────────────────────────────────────────────────────────────────
// New Order Modal — Marcone search-driven flow + manual entry for others
// ───────────────────────────────────────────────────────────────────────────

const COMMON_MAKES = [
  "Whirlpool", "GE", "Samsung", "LG", "Frigidaire", "Maytag",
  "Bosch", "KitchenAid", "Amana", "Kenmore", "Electrolux",
];

interface MarconePartResult {
  make: string;
  partNumber: string;
  description: string;
  price: number;
  dealer?: number;
  retail?: number;
  list?: number;
  isDiscontinued?: boolean;
  isDropShipOnly?: boolean;
  isHazMat?: boolean;
  isOversize?: boolean;
  totalWarehouseQty?: number;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  inventory?: Array<{ warehouseNumber?: string; warehouseName?: string; quantityAvailable?: number; timeInTransitDays?: number | null }>;
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
  const [items, setItems] = useState<DraftItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Marcone search state
  const [searchPart, setSearchPart] = useState("");
  const [searchMake, setSearchMake] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<MarconePartResult[]>([]);
  const [searchErr, setSearchErr] = useState("");

  const isMarcone = supplier === "marcone";

  // Add a blank manual line for non-Marcone suppliers
  useEffect(() => {
    if (!isMarcone && items.length === 0) {
      setItems([{ part_number: "", description: "", quantity: "1", unit_price: "" }]);
    }
  }, [isMarcone, items.length]);

  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: keyof DraftItem, value: string) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  const addBlankItem = () =>
    setItems((prev) => [...prev, { part_number: "", description: "", quantity: "1", unit_price: "" }]);

  const runSearch = async () => {
    if (!searchPart.trim()) { setSearchErr("Enter a part number"); return; }
    setSearchErr("");
    setSearching(true);
    setSearchResults([]);
    try {
      const params = new URLSearchParams({ part_number: searchPart.trim() });
      if (searchMake.trim()) params.set("make", searchMake.trim());
      const res = await fetch(`/api/marcone/parts/search?${params}`);
      const data = await res.json();
      if (!data.ok) {
        setSearchErr(data.error || "Search failed");
      } else {
        setSearchResults(data.results || []);
        if ((data.results || []).length === 0) setSearchErr("No results");
      }
    } catch (e: any) {
      setSearchErr(e.message);
    } finally {
      setSearching(false);
    }
  };

  const addFromSearch = (part: MarconePartResult) => {
    // With ByZipCode lookup, Marcone returns warehouses already sorted by
    // transit time to our shop ZIP — first stocked entry is the closest.
    const stocked = (part.inventory || []).filter((w) => (w.quantityAvailable || 0) > 0);
    const warehouse = stocked[0];

    setItems((prev) => [
      ...prev,
      {
        part_number: part.partNumber,
        description: part.description,
        quantity: "1",
        unit_price: String(part.dealer ?? part.price ?? ""),
        marcone_make: part.make,
        marcone_warehouse_number: warehouse?.warehouseNumber,
        marcone_warehouse_name: warehouse?.warehouseName,
        dealer_price: part.dealer,
        list_price: part.list,
        is_hazmat: part.isHazMat,
        is_oversize: part.isOversize,
        is_discontinued: part.isDiscontinued,
        weight: part.weight,
      },
    ]);
  };

  // Save to DB; returns parts_order_id
  const saveDraft = async (): Promise<number | null> => {
    setErr("");
    const validItems = items.filter((it) => it.part_number.trim());
    if (validItems.length === 0) {
      setErr("Add at least one part.");
      return null;
    }

    const subtotal = validItems.reduce((sum, it) => {
      const qty = parseInt(it.quantity) || 0;
      const price = parseFloat(it.unit_price) || 0;
      return sum + qty * price;
    }, 0);

    // For Marcone, default to most-common warehouse across items so we have one
    const orderWarehouse = validItems.find((it) => it.marcone_warehouse_number)?.marcone_warehouse_number;

    const { data: order, error: orderErr } = await supabase
      .from("parts_orders")
      .insert({
        tenant_id: tenantId,
        work_order_id: workOrderId,
        supplier,
        external_order_id: isMarcone ? null : (externalOrderId.trim() || null),
        status: isMarcone ? "draft" : "submitted",
        submitted_at: isMarcone ? null : new Date().toISOString(),
        eta_date: etaDate || null,
        notes: notes.trim() || null,
        subtotal: subtotal || null,
        total: subtotal || null,
        marcone_warehouse_number: isMarcone ? orderWarehouse : null,
      })
      .select("id")
      .single();

    if (orderErr || !order) {
      setErr(orderErr?.message || "Failed to create order");
      return null;
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
        marcone_make: it.marcone_make || null,
        marcone_warehouse_number: it.marcone_warehouse_number || null,
        marcone_warehouse_name: it.marcone_warehouse_name || null,
        dealer_price: it.dealer_price ?? null,
        list_price: it.list_price ?? null,
        is_hazmat: it.is_hazmat ?? false,
        is_oversize: it.is_oversize ?? false,
        is_discontinued: it.is_discontinued ?? false,
        weight: it.weight ?? null,
      };
    });

    const { error: itemsErr } = await supabase.from("parts_order_items").insert(itemRows);
    if (itemsErr) {
      setErr(itemsErr.message);
      return null;
    }
    return order.id;
  };

  const submitMarconeOrder = async () => {
    setSaving(true);
    setErr("");
    const orderId = await saveDraft();
    if (!orderId) { setSaving(false); return; }

    try {
      const res = await fetch("/api/marcone/orders/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts_order_id: orderId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(`Marcone rejected order: ${data.error}`);
        // Order row is saved as draft so user can retry without losing items
        setSaving(false);
        return;
      }
      onCreated();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const submitManual = async () => {
    setSaving(true);
    const orderId = await saveDraft();
    setSaving(false);
    if (orderId) onCreated();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 sticky top-0 bg-white z-10">
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
                onChange={(e) => { setSupplier(e.target.value); setItems([]); setSearchResults([]); }}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
              >
                {SUPPLIERS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            {!isMarcone && (
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
            )}
          </div>

          {/* Marcone search panel */}
          {isMarcone && (
            <div className="border border-indigo-100 bg-indigo-50/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Search size={14} className="text-indigo-600" />
                <span className="text-sm font-semibold text-indigo-900">Search Marcone Inventory</span>
              </div>
              <div className="grid grid-cols-12 gap-2">
                <input
                  value={searchPart}
                  onChange={(e) => setSearchPart(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runSearch()}
                  placeholder="Part number"
                  className="col-span-5 px-3 py-2 text-sm border border-gray-300 rounded-lg"
                />
                <input
                  list="makes-datalist"
                  value={searchMake}
                  onChange={(e) => setSearchMake(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runSearch()}
                  placeholder="Make (optional)"
                  className="col-span-4 px-3 py-2 text-sm border border-gray-300 rounded-lg"
                />
                <datalist id="makes-datalist">
                  {COMMON_MAKES.map((m) => <option key={m} value={m} />)}
                </datalist>
                <button
                  onClick={runSearch}
                  disabled={searching}
                  className="col-span-3 px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-60"
                >
                  {searching ? "Searching…" : "Search"}
                </button>
              </div>
              {searchErr && <div className="text-xs text-red-600 mt-2">{searchErr}</div>}

              {searchResults.length > 0 && (
                <div className="mt-3 space-y-2">
                  {searchResults.map((p) => (
                    <SearchResultCard key={`${p.make}-${p.partNumber}`} part={p} onAdd={() => addFromSearch(p)} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Cart / line items */}
          {items.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-gray-500 uppercase">
                  {isMarcone ? "Items in Cart" : "Parts"}
                </label>
                {!isMarcone && (
                  <button onClick={addBlankItem} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                    + Add line
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {items.map((it, idx) => (
                  <div key={idx} className={`grid grid-cols-12 gap-2 items-start ${it.marcone_make ? "p-2 bg-gray-50 rounded" : ""}`}>
                    {it.marcone_make ? (
                      <>
                        <div className="col-span-7">
                          <div className="font-mono text-sm text-gray-900">{it.part_number}</div>
                          <div className="text-xs text-gray-600">{it.description}</div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            <span className="text-[10px] px-1.5 py-0.5 bg-white border border-gray-200 rounded">{it.marcone_make}</span>
                            {it.marcone_warehouse_name && <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">{it.marcone_warehouse_name}</span>}
                            {it.is_hazmat && <span className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-700 rounded font-semibold">HAZMAT</span>}
                            {it.is_oversize && <span className="text-[10px] px-1.5 py-0.5 bg-orange-50 text-orange-700 rounded font-semibold">OVERSIZE</span>}
                            {it.is_discontinued && <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">DISCONTINUED</span>}
                          </div>
                        </div>
                        <input
                          value={it.quantity}
                          onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                          inputMode="numeric"
                          className="col-span-2 px-2 py-1.5 text-sm border border-gray-300 rounded text-center"
                        />
                        <input
                          value={it.unit_price}
                          onChange={(e) => updateItem(idx, "unit_price", e.target.value)}
                          inputMode="decimal"
                          className="col-span-2 px-2 py-1.5 text-sm border border-gray-300 rounded"
                        />
                        <button
                          onClick={() => removeItem(idx)}
                          className="col-span-1 p-1.5 text-gray-400 hover:text-red-600"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : (
                      <>
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
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isMarcone && (
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
          )}

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

          {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 flex items-start gap-2">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /> {err}
          </div>}
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-200 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">
            Cancel
          </button>
          {isMarcone ? (
            <button
              onClick={submitMarconeOrder}
              disabled={saving || items.length === 0}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? "Placing…" : "Place Order with Marcone"}
            </button>
          ) : (
            <button
              onClick={submitManual}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Submit Order"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SearchResultCard({ part, onAdd }: { part: MarconePartResult; onAdd: () => void }) {
  const stocked = (part.inventory || []).filter((w) => (w.quantityAvailable || 0) > 0);
  const totalQty = part.totalWarehouseQty ?? stocked.reduce((s, w) => s + (w.quantityAvailable || 0), 0);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-gray-900">{part.partNumber}</span>
            <span className="text-xs text-gray-500">{part.make}</span>
            {part.isHazMat && <span className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-700 rounded font-semibold">HAZMAT</span>}
            {part.isOversize && <span className="text-[10px] px-1.5 py-0.5 bg-orange-50 text-orange-700 rounded font-semibold">OVERSIZE</span>}
            {part.isDiscontinued && <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-semibold">DISCONTINUED</span>}
            {part.isDropShipOnly && <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded">DROP SHIP</span>}
          </div>
          <div className="text-sm text-gray-700 mt-0.5">{part.description}</div>
          <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {part.dealer != null && <span>Cost <strong className="text-gray-900">${part.dealer.toFixed(2)}</strong></span>}
            {part.list != null && part.list > 0 && <span>List ${part.list.toFixed(2)}</span>}
            <span>{totalQty > 0 ? `${totalQty} in stock` : "Out of stock"}</span>
            {part.weight != null && part.weight > 0 && <span>{part.weight} lb</span>}
          </div>
          {stocked.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {stocked.map((w) => (
                <span key={w.warehouseNumber} className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">
                  {w.warehouseName} · {w.quantityAvailable}
                </span>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={onAdd}
          disabled={part.isDiscontinued}
          className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
