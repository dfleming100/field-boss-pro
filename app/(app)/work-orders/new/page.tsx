"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";

interface NewJobForm {
  work_order_number: string;
  customer_id: string;
  assigned_technician_id: string;
  job_type: string;
  appliance_type: string;
  notes: string;
  service_date: string;
}

export default function NewWorkOrderPage() {
  const router = useRouter();
  const { user, tenantUser, loading } = useAuth();

  const [form, setForm] = useState<NewJobForm>({
    work_order_number: "",
    customer_id: "",
    assigned_technician_id: "",
    job_type: "repair",
    appliance_type: "",
    notes: "",
    service_date: "",
  });

  const [customers, setCustomers] = useState<any[]>([]);
  const [technicians, setTechnicians] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading) {
      if (!user || !tenantUser) {
        router.push("/login");
        return;
      }
      fetchSupportingData();
    }
  }, [loading, user, tenantUser, router]);

  const fetchSupportingData = async () => {
    try {
      const [custRes, techRes] = await Promise.all([
        supabase
          .from("customers")
          .select("id, customer_name")
          .eq("tenant_id", tenantUser?.tenant_id)
          .order("customer_name", { ascending: true }),
        supabase
          .from("technicians")
          .select("id, tech_name")
          .eq("tenant_id", tenantUser?.tenant_id)
          .eq("is_active", true)
          .order("tech_name", { ascending: true }),
      ]);

      if (custRes.error) throw custRes.error;
      if (techRes.error) throw techRes.error;

      setCustomers(custRes.data || []);
      setTechnicians(techRes.data || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setIsSaving(true);

    try {
      if (!form.customer_id) {
        throw new Error("Customer is required");
      }

      const { error: insertError } = await supabase.from("work_orders").insert({
        tenant_id: tenantUser?.tenant_id,
        work_order_number: form.work_order_number || `WO-${Date.now()}`,
        customer_id: form.customer_id,
        assigned_technician_id: form.assigned_technician_id || null,
        job_type: form.job_type,
        appliance_type: form.appliance_type
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        notes: form.notes || null,
        status: form.service_date ? "scheduled" : "draft",
        service_date: form.service_date || null,
      });

      if (insertError) throw insertError;

      router.push("/work-orders");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700 text-sm">
          {"\u2190"} Back
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Create Work Order</h1>
      </div>

      <div>
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Work Order #</label>
              <input
                type="text"
                value={form.work_order_number}
                onChange={(e) => setForm({ ...form, work_order_number: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="WO-12345"
                disabled={isSaving}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Customer *</label>
              <select
                value={form.customer_id}
                onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                required
                disabled={isSaving}
              >
                <option value="">Select customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.customer_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Assigned Technician</label>
              <select
                value={form.assigned_technician_id}
                onChange={(e) => setForm({ ...form, assigned_technician_id: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                disabled={isSaving}
              >
                <option value="">Unassigned</option>
                {technicians.map((tech) => (
                  <option key={tech.id} value={tech.id}>
                    {tech.tech_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Job Type</label>
              <select
                value={form.job_type}
                onChange={(e) => setForm({ ...form, job_type: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                disabled={isSaving}
              >
                <option value="repair">Repair</option>
                <option value="service">Service</option>
                <option value="maintenance">Maintenance</option>
                <option value="inspection">Inspection</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Appliance Type(s)</label>
              <input
                type="text"
                value={form.appliance_type}
                onChange={(e) => setForm({ ...form, appliance_type: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="Dryer, Refrigerator, Oven"
                disabled={isSaving}
              />
              <p className="text-xs text-gray-500 mt-1">Comma-separated values</p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Service Date</label>
                <input
                  type="date"
                  value={form.service_date}
                  onChange={(e) => setForm({ ...form, service_date: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  disabled={isSaving}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
                <select
                  value={"normal"}
                  disabled
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-100"
                >
                  <option value="normal">Normal</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                rows={4}
                placeholder="Job details, access instructions, etc."
                disabled={isSaving}
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => router.back()}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100"
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Create Work Order"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
