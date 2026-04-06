"use client";

import React, { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { Plus, ChevronDown, Search, Filter } from "lucide-react";

interface Appointment {
  appointment_date: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
}

interface WorkOrder {
  id: string;
  customer_id: string;
  assigned_technician_id: string | null;
  work_order_number: string;
  job_type: string;
  status: string;
  appliance_type: string[] | string | null;
  service_date: string | null;
  created_at: string;
  customer_name?: string;
  assigned_tech_name?: string;
  service_address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  appointments?: Appointment[];
}

type StatusFilter =
  | "all"
  | "New"
  | "Parts Ordered"
  | "Parts Have Arrived"
  | "Scheduled"
  | "Complete";

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; text: string; dot: string }
> = {
  "New": { label: "New", bg: "bg-blue-100", text: "text-blue-700", dot: "bg-blue-500" },
  "Parts Ordered": { label: "Parts Ordered", bg: "bg-amber-100", text: "text-amber-700", dot: "bg-amber-500" },
  "Parts Have Arrived": { label: "Parts Arrived", bg: "bg-teal-100", text: "text-teal-700", dot: "bg-teal-500" },
  "Scheduled": { label: "Scheduled", bg: "bg-purple-100", text: "text-purple-700", dot: "bg-purple-500" },
  "Complete": { label: "Complete", bg: "bg-green-100", text: "text-green-700", dot: "bg-green-500" },
};

function WorkOrdersContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenantUser } = useAuth();
  const customerFilter = searchParams.get("customerId") || "";

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);

  const fetchWorkOrders = useCallback(async () => {
    if (!tenantUser) return;
    try {
      const { data, error: fetchError } = await supabase
        .from("work_orders")
        .select(
          `
          *,
          customer:customers(customer_name, service_address, city, state, zip, phone, email),
          technician:technicians!assigned_technician_id(tech_name),
          appointments(appointment_date, start_time, end_time, status)
        `
        )
        .eq("tenant_id", tenantUser.tenant_id)
        .order("created_at", { ascending: false });

      if (fetchError) throw fetchError;

      const enriched = (data || []).map((wo: any) => ({
        ...wo,
        customer_name: wo.customer?.customer_name,
        assigned_tech_name: wo.technician?.tech_name,
        service_address: wo.customer?.service_address,
        city: wo.customer?.city,
        state: wo.customer?.state,
        zip: wo.customer?.zip,
        phone: wo.customer?.phone,
        email: wo.customer?.email,
        appointments: wo.appointments || [],
      }));

      setWorkOrders(enriched);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [tenantUser]);

  useEffect(() => {
    fetchWorkOrders();
  }, [fetchWorkOrders]);

  // Filtering
  const filteredOrders = workOrders
    .filter((wo) => statusFilter === "all" || wo.status === statusFilter)
    .filter((wo) => !customerFilter || wo.customer_id === customerFilter)
    .filter((wo) => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return (
        wo.work_order_number?.toLowerCase().includes(term) ||
        wo.customer_name?.toLowerCase().includes(term) ||
        wo.service_address?.toLowerCase().includes(term) ||
        wo.city?.toLowerCase().includes(term) ||
        wo.assigned_tech_name?.toLowerCase().includes(term)
      );
    });

  // Counts
  const newCount = workOrders.filter((wo) =>
    ["New"].includes(wo.status)
  ).length;
  const openCount = workOrders.filter((wo) =>
    ["Parts Ordered", "Parts Have Arrived", "Scheduled"].includes(wo.status)
  ).length;
  const closedCount = workOrders.filter((wo) =>
    ["Complete"].includes(wo.status)
  ).length;

  // Selection
  const allSelected =
    filteredOrders.length > 0 &&
    filteredOrders.every((wo) => selectedIds.has(wo.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredOrders.map((wo) => wo.id)));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  // Helpers
  const getNextAppointment = (wo: WorkOrder): Appointment | null => {
    const appts = wo.appointments?.filter((a) => a.status !== "canceled") || [];
    if (appts.length === 0) return null;
    return appts.sort(
      (a, b) =>
        new Date(a.appointment_date).getTime() -
        new Date(b.appointment_date).getTime()
    )[0];
  };

  const formatAppointment = (appt: Appointment | null): string => {
    if (!appt) return "—";
    const date = new Date(appt.appointment_date + "T00:00:00").toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric" }
    );
    if (appt.start_time) {
      const time = appt.start_time.slice(0, 5);
      return `${date} at ${time}`;
    }
    return date;
  };

  const formatAddress = (wo: WorkOrder): string => {
    const parts = [wo.service_address, wo.city, wo.state].filter(Boolean);
    if (wo.zip) {
      if (wo.state) {
        return [...parts.slice(0, -1), `${wo.state} ${wo.zip}`].join(", ");
      }
      parts.push(wo.zip);
    }
    return parts.join(", ") || "—";
  };

  const getApplianceDisplay = (
    appliance: string[] | string | null
  ): string => {
    if (!appliance) return "—";
    if (Array.isArray(appliance)) return appliance.join(", ") || "—";
    return appliance || "—";
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading work orders...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Work Orders</h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage and track all service work orders
          </p>
        </div>
        <Link
          href="/work-orders/new"
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 shadow-sm"
        >
          <Plus size={16} />
          New Work Order
        </Link>
      </div>

      {/* Status Counters */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <button
          onClick={() => setStatusFilter(statusFilter === "all" ? "New" : "all")}
          className={`bg-white rounded-xl border p-4 text-left transition-all ${
            statusFilter === "New"
              ? "border-blue-300 ring-2 ring-blue-100"
              : "border-gray-200 hover:border-blue-200"
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-gray-500">New</span>
            <span className="w-3 h-3 rounded-full bg-blue-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900">{newCount}</p>
        </button>
        <button
          onClick={() =>
            setStatusFilter(statusFilter === "Scheduled" ? "all" : "Scheduled")
          }
          className={`bg-white rounded-xl border p-4 text-left transition-all ${
            ["Parts Ordered", "Parts Have Arrived", "Scheduled"].includes(statusFilter)
              ? "border-orange-300 ring-2 ring-orange-100"
              : "border-gray-200 hover:border-orange-200"
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-gray-500">Open</span>
            <span className="w-3 h-3 rounded-full bg-orange-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900">{openCount}</p>
        </button>
        <button
          onClick={() =>
            setStatusFilter(statusFilter === "Complete" ? "all" : "Complete")
          }
          className={`bg-white rounded-xl border p-4 text-left transition-all ${
            statusFilter === "Complete"
              ? "border-green-300 ring-2 ring-green-100"
              : "border-gray-200 hover:border-green-200"
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-gray-500">Closed</span>
            <span className="w-3 h-3 rounded-full bg-green-500" />
          </div>
          <p className="text-3xl font-bold text-gray-900">{closedCount}</p>
        </button>
        <button
          onClick={() => setStatusFilter("all")}
          className={`bg-white rounded-xl border p-4 text-left transition-all ${
            statusFilter === "all"
              ? "border-gray-300 ring-2 ring-gray-100"
              : "border-gray-200 hover:border-gray-300"
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-gray-500">Total</span>
            <span className="w-3 h-3 rounded-full bg-gray-400" />
          </div>
          <p className="text-3xl font-bold text-gray-900">
            {workOrders.length}
          </p>
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Toolbar: search + filter */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            placeholder="Search by WO#, customer, address, technician..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg"
          />
        </div>

        {/* Status filter dropdown */}
        <div className="relative">
          <button
            onClick={() => setFilterOpen(!filterOpen)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Filter size={16} className="text-gray-400" />
            {statusFilter === "all"
              ? "All Statuses"
              : STATUS_CONFIG[statusFilter]?.label || statusFilter}
            <ChevronDown size={14} className="text-gray-400" />
          </button>
          {filterOpen && (
            <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
              {(
                [
                  "all",
                  "New",
                  "Parts Ordered",
                  "Parts Have Arrived",
                  "Scheduled",
                  "Complete",
                ] as const
              ).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setStatusFilter(s);
                    setFilterOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 ${
                    statusFilter === s
                      ? "text-indigo-600 font-medium"
                      : "text-gray-700"
                  }`}
                >
                  {s !== "all" && (
                    <span
                      className={`w-2 h-2 rounded-full ${STATUS_CONFIG[s]?.dot}`}
                    />
                  )}
                  {s === "all"
                    ? "All Statuses"
                    : STATUS_CONFIG[s]?.label || s}
                </button>
              ))}
            </div>
          )}
        </div>

        {customerFilter && (
          <Link
            href="/work-orders"
            className="text-sm text-indigo-600 hover:text-indigo-700 whitespace-nowrap"
          >
            Clear filter
          </Link>
        )}
      </div>

      {/* Selected count */}
      {selectedIds.size > 0 && (
        <div className="mb-3 px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center justify-between">
          <span className="text-sm text-indigo-700 font-medium">
            {selectedIds.size} work order{selectedIds.size > 1 ? "s" : ""}{" "}
            selected
          </span>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-indigo-600 hover:text-indigo-700"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  ID
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Assigned / Appt
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Appointment
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Customer
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Service Location
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Item Type
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredOrders.map((wo) => {
                const appt = getNextAppointment(wo);
                const statusCfg = STATUS_CONFIG[wo.status] || STATUS_CONFIG["New"];

                return (
                  <tr
                    key={wo.id}
                    className={`hover:bg-gray-50 cursor-pointer transition ${
                      selectedIds.has(wo.id) ? "bg-indigo-50/50" : ""
                    }`}
                    onClick={() => router.push(`/work-orders/${wo.id}`)}
                  >
                    <td
                      className="w-10 px-4 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(wo.id)}
                        onChange={() => toggleOne(wo.id)}
                        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/work-orders/${wo.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                      >
                        {wo.work_order_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-900">
                        {wo.assigned_tech_name || (
                          <span className="text-gray-400 italic">
                            Unassigned
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${statusCfg.bg} ${statusCfg.text}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`}
                        />
                        {statusCfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {formatAppointment(appt)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/customers/${wo.customer_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                      >
                        {wo.customer_name || "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-[220px] truncate">
                      {formatAddress(wo)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {getApplianceDisplay(wo.appliance_type)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredOrders.length === 0 && (
          <div className="px-6 py-16 text-center">
            <p className="text-gray-400 text-sm mb-4">
              {searchTerm
                ? "No work orders match your search"
                : statusFilter !== "all"
                ? `No ${STATUS_CONFIG[statusFilter]?.label.toLowerCase()} work orders`
                : "No work orders yet"}
            </p>
            {!searchTerm && statusFilter === "all" && (
              <Link
                href="/work-orders/new"
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
              >
                <Plus size={16} />
                Create First Work Order
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Footer count */}
      <div className="mt-3 text-xs text-gray-400">
        Showing {filteredOrders.length} of {workOrders.length} work orders
      </div>
    </div>
  );
}

export default function WorkOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <div className="text-sm text-gray-500">Loading...</div>
        </div>
      }
    >
      <WorkOrdersContent />
    </Suspense>
  );
}
