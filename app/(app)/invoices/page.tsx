"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { FileText, Plus, Search, DollarSign, Clock, CheckCircle2, Send } from "lucide-react";

interface Invoice {
  id: number;
  invoice_number: string;
  status: string;
  total: number;
  created_at: string;
  paid_at: string | null;
  customer_name?: string;
  work_order_number?: string;
  work_order_id?: number;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
};

export default function InvoicesPage() {
  const router = useRouter();
  const { tenantUser } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [hasFetched, setHasFetched] = useState(false);

  const fetchInvoices = useCallback(async () => {
    if (!tenantUser) return;
    const { data } = await supabase
      .from("invoices")
      .select(`
        *,
        customer:customers(customer_name),
        work_order:work_orders(work_order_number)
      `)
      .eq("tenant_id", tenantUser.tenant_id)
      .order("created_at", { ascending: false });

    if (data) {
      setInvoices(data.map((inv: any) => ({
        ...inv,
        customer_name: inv.customer?.customer_name,
        work_order_number: inv.work_order?.work_order_number,
      })));
    }
    setIsLoading(false);
  }, [tenantUser]);

  useEffect(() => {
    if (!tenantUser || hasFetched) return;
    setIsLoading(true);
    setHasFetched(true);
    fetchInvoices();
  }, [tenantUser, hasFetched, fetchInvoices]);

  const filtered = invoices
    .filter((inv) => statusFilter === "all" || inv.status === statusFilter)
    .filter((inv) => {
      if (!search) return true;
      const term = search.toLowerCase();
      return (
        inv.invoice_number.toLowerCase().includes(term) ||
        inv.customer_name?.toLowerCase().includes(term) ||
        inv.work_order_number?.toLowerCase().includes(term)
      );
    });

  const totalRevenue = invoices.filter((i) => i.status === "paid").reduce((sum, i) => sum + Number(i.total), 0);
  const totalOutstanding = invoices.filter((i) => i.status === "sent").reduce((sum, i) => sum + Number(i.total), 0);
  const totalDraft = invoices.filter((i) => i.status === "draft").reduce((sum, i) => sum + Number(i.total), 0);

  const formatCurrency = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
          <p className="text-gray-500 text-sm mt-1">Create and manage customer invoices</p>
        </div>
        <Link
          href="/invoices/new"
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 shadow-sm"
        >
          <Plus size={16} />
          New Invoice
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 size={16} className="text-green-500" />
            <span className="text-sm text-gray-500">Paid</span>
          </div>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(totalRevenue)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Send size={16} className="text-blue-500" />
            <span className="text-sm text-gray-500">Outstanding</span>
          </div>
          <p className="text-2xl font-bold text-blue-600">{formatCurrency(totalOutstanding)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={16} className="text-gray-400" />
            <span className="text-sm text-gray-500">Draft</span>
          </div>
          <p className="text-2xl font-bold text-gray-600">{formatCurrency(totalDraft)}</p>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search invoices..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 text-sm border border-gray-300 rounded-lg"
        >
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <FileText size={48} className="text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {invoices.length === 0 ? "No invoices yet" : "No matching invoices"}
            </h3>
            <p className="text-gray-500 text-sm mb-4">
              {invoices.length === 0 ? "Create an invoice from a completed work order." : "Try a different search."}
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Invoice #</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Customer</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Work Order</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Total</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => router.push(`/invoices/${inv.id}`)}
                  className="hover:bg-gray-50 cursor-pointer transition"
                >
                  <td className="px-4 py-3 text-sm font-semibold text-indigo-600">{inv.invoice_number}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">{inv.customer_name || "—"}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{inv.work_order_number || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[inv.status] || "bg-gray-100 text-gray-700"}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 text-right">{formatCurrency(Number(inv.total))}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(inv.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
