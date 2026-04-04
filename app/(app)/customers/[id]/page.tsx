"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  ArrowLeft,
  User,
  MapPin,
  Phone,
  Mail,
  ClipboardList,
  CalendarDays,
  Save,
  Plus,
  Pencil,
} from "lucide-react";

interface CustomerData {
  id: string;
  customer_name: string;
  phone: string;
  email: string;
  service_address: string;
  city: string;
  state: string;
  zip: string;
  created_at: string;
}

interface WorkOrder {
  id: string;
  work_order_number: string;
  job_type: string;
  status: string;
  service_date: string | null;
  created_at: string;
  assigned_tech_name?: string;
}

interface Appointment {
  id: number;
  appointment_date: string;
  start_time: string | null;
  status: string;
  work_order_number?: string;
  tech_name?: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  ready_to_schedule: "bg-blue-100 text-blue-700",
  scheduled: "bg-purple-100 text-purple-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  canceled: "bg-red-100 text-red-700",
};

export default function CustomerPage() {
  const router = useRouter();
  const params = useParams();
  const customerId = params.id as string;
  const isNew = customerId === "new";

  const { tenantUser } = useAuth();
  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(!isNew);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [isEditing, setIsEditing] = useState(isNew);

  const [form, setForm] = useState({
    customer_name: "", phone: "", email: "",
    service_address: "", city: "", state: "", zip: "",
  });

  const fetchCustomer = useCallback(async () => {
    if (!tenantUser || isNew) return;
    try {
      const { data, error: fetchErr } = await supabase
        .from("customers")
        .select("*")
        .eq("id", customerId)
        .eq("tenant_id", tenantUser.tenant_id)
        .single();
      if (fetchErr) throw fetchErr;
      setCustomer(data);
      setForm({
        customer_name: data.customer_name || "",
        phone: data.phone || "",
        email: data.email || "",
        service_address: data.service_address || "",
        city: data.city || "",
        state: data.state || "",
        zip: data.zip || "",
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }, [tenantUser, customerId, isNew]);

  const fetchWorkOrders = useCallback(async () => {
    if (!tenantUser || isNew) return;
    const { data } = await supabase
      .from("work_orders")
      .select("*, technician:technicians(tech_name)")
      .eq("tenant_id", tenantUser.tenant_id)
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });

    if (data) {
      setWorkOrders(
        data.map((wo: any) => ({
          ...wo,
          assigned_tech_name: wo.technician?.tech_name,
        }))
      );
    }
  }, [tenantUser, customerId, isNew]);

  const fetchAppointments = useCallback(async () => {
    if (!tenantUser || isNew) return;
    const { data } = await supabase
      .from("appointments")
      .select(`
        *,
        work_order:work_orders!inner(work_order_number, customer_id),
        technician:technicians(tech_name)
      `)
      .eq("tenant_id", tenantUser.tenant_id)
      .eq("work_order.customer_id", customerId)
      .order("appointment_date", { ascending: false })
      .limit(10);

    if (data) {
      setAppointments(
        data.map((a: any) => ({
          ...a,
          work_order_number: a.work_order?.work_order_number,
          tech_name: a.technician?.tech_name,
        }))
      );
    }
  }, [tenantUser, customerId, isNew]);

  useEffect(() => {
    const load = async () => {
      await Promise.all([fetchCustomer(), fetchWorkOrders(), fetchAppointments()]);
      setIsLoading(false);
    };
    load();
  }, [fetchCustomer, fetchWorkOrders, fetchAppointments]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customer_name.trim()) { setError("Name is required"); return; }
    setIsSaving(true);
    setError("");

    try {
      if (isNew) {
        const { data, error: insertErr } = await supabase
          .from("customers")
          .insert({ tenant_id: tenantUser?.tenant_id, ...form })
          .select()
          .single();
        if (insertErr) throw insertErr;
        router.push(`/customers/${data.id}`);
      } else {
        const { error: updateErr } = await supabase
          .from("customers")
          .update(form)
          .eq("id", customerId)
          .eq("tenant_id", tenantUser?.tenant_id);
        if (updateErr) throw updateErr;
        setIsEditing(false);
        setSuccessMsg("Saved");
        setTimeout(() => setSuccessMsg(""), 2000);
        await fetchCustomer();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const formatStatus = (s: string) =>
    s.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── New Customer Form ──
  if (isNew) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => router.back()} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Add Customer</h1>
        </div>
        <form onSubmit={handleSave} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input type="text" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} required className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="John Smith" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="(555) 123-4567" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="john@example.com" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <input type="text" value={form.service_address} onChange={(e) => setForm({ ...form, service_address: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="123 Main St" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
              <input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
              <input type="text" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} maxLength={2} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ZIP</label>
              <input type="text" value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={isSaving} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {isSaving ? "Creating..." : "Create Customer"}
            </button>
            <button type="button" onClick={() => router.back()} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          </div>
        </form>
      </div>
    );
  }

  // ── Customer Profile ──
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{customer?.customer_name}</h1>
            <p className="text-sm text-gray-500">
              Customer since {customer?.created_at ? new Date(customer.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "—"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/work-orders/new?customerId=${customerId}`}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
          >
            <Plus size={16} />
            New Work Order
          </Link>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {successMsg && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{successMsg}</div>}

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <User size={16} className="text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-500 uppercase">Contact</h3>
          </div>
          {customer?.phone && (
            <a href={`tel:${customer.phone}`} className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700">
              <Phone size={14} /> {customer.phone}
            </a>
          )}
          {customer?.email && (
            <a href={`mailto:${customer.email}`} className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700 mt-1">
              <Mail size={14} /> {customer.email}
            </a>
          )}
          {!customer?.phone && !customer?.email && <p className="text-sm text-gray-400">No contact info</p>}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <MapPin size={16} className="text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-500 uppercase">Service Address</h3>
          </div>
          <p className="text-sm text-gray-900 font-medium">{customer?.service_address || "—"}</p>
          <p className="text-sm text-gray-500">{[customer?.city, customer?.state, customer?.zip].filter(Boolean).join(", ")}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardList size={16} className="text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-500 uppercase">Summary</h3>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-gray-500">Work Orders</p>
              <p className="text-lg font-bold text-gray-900">{workOrders.length}</p>
            </div>
            <div>
              <p className="text-gray-500">Completed</p>
              <p className="text-lg font-bold text-green-600">{workOrders.filter((w) => w.status === "completed").length}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Work Orders + Appointments */}
        <div className="lg:col-span-2 space-y-6">
          {/* Work Orders */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">Work Orders</h2>
              <span className="text-xs text-gray-400">{workOrders.length} total</span>
            </div>
            {workOrders.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">No work orders yet</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {workOrders.map((wo) => (
                  <Link
                    key={wo.id}
                    href={`/work-orders/${wo.id}`}
                    className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition"
                  >
                    <div className="flex items-center gap-3">
                      <ClipboardList size={16} className="text-gray-400" />
                      <div>
                        <p className="text-sm font-semibold text-indigo-600">{wo.work_order_number}</p>
                        <p className="text-xs text-gray-500 capitalize">{wo.job_type} &middot; {wo.assigned_tech_name || "Unassigned"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[wo.status] || "bg-gray-100 text-gray-700"}`}>
                        {formatStatus(wo.status)}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(wo.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Appointments */}
          {appointments.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="px-5 py-4 border-b border-gray-200">
                <h2 className="text-base font-semibold text-gray-900">Recent Appointments</h2>
              </div>
              <div className="divide-y divide-gray-100">
                {appointments.map((appt) => (
                  <div key={appt.id} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-3">
                      <CalendarDays size={16} className="text-purple-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {new Date(appt.appointment_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                          {appt.start_time && ` at ${appt.start_time.slice(0, 5)}`}
                        </p>
                        <p className="text-xs text-gray-500">
                          {appt.work_order_number} &middot; {appt.tech_name || "Unassigned"}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs capitalize text-gray-500">{appt.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Edit Form */}
        <div>
          <div className="bg-white rounded-xl border border-gray-200 p-5 sticky top-24">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">Details</h2>
              {!isEditing && (
                <button onClick={() => setIsEditing(true)} className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700">
                  <Pencil size={14} /> Edit
                </button>
              )}
            </div>

            {isEditing ? (
              <form onSubmit={handleSave} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Name *</label>
                  <input type="text" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} required className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
                  <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Address</label>
                  <input type="text" value={form.service_address} onChange={(e) => setForm({ ...form, service_address: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City" className="px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                  <input type="text" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="ST" maxLength={2} className="px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                  <input type="text" value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} placeholder="ZIP" className="px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="submit" disabled={isSaving} className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                    <Save size={14} /> {isSaving ? "Saving..." : "Save"}
                  </button>
                  <button type="button" onClick={() => { setIsEditing(false); fetchCustomer(); }} className="px-3 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400">Name</p>
                  <p className="text-gray-900 font-medium">{customer?.customer_name}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Phone</p>
                  <p className="text-gray-900">{customer?.phone || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Email</p>
                  <p className="text-gray-900">{customer?.email || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Address</p>
                  <p className="text-gray-900">{customer?.service_address || "—"}</p>
                  <p className="text-gray-500">{[customer?.city, customer?.state, customer?.zip].filter(Boolean).join(", ")}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
