"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  Funnel,
  Plus,
  X,
  Search,
  Phone,
  Mail,
  UserCheck,
  ChevronDown,
} from "lucide-react";

interface Lead {
  id: number;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  service_type: string | null;
  message: string | null;
  status: string;
  created_at: string;
}

type LeadStatus = "all" | "new" | "contacted" | "converted" | "archived";

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  new: { bg: "bg-blue-100", text: "text-blue-700" },
  contacted: { bg: "bg-yellow-100", text: "text-yellow-700" },
  converted: { bg: "bg-green-100", text: "text-green-700" },
  archived: { bg: "bg-gray-100", text: "text-gray-500" },
};

const emptyForm = {
  customer_name: "",
  customer_email: "",
  customer_phone: "",
  service_type: "",
  message: "",
};

export default function LeadsPage() {
  const router = useRouter();
  const { tenantUser } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<LeadStatus>("all");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const fetchLeads = useCallback(async () => {
    if (!tenantUser) return;
    const { data } = await supabase
      .from("leads")
      .select("*")
      .eq("tenant_id", tenantUser.tenant_id)
      .order("created_at", { ascending: false });
    if (data) setLeads(data);
    setIsLoading(false);
  }, [tenantUser]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const filtered = leads
    .filter((l) => statusFilter === "all" || l.status === statusFilter)
    .filter((l) => {
      if (!search) return true;
      const term = search.toLowerCase();
      return (
        l.customer_name?.toLowerCase().includes(term) ||
        l.customer_email?.toLowerCase().includes(term) ||
        l.customer_phone?.includes(term) ||
        l.service_type?.toLowerCase().includes(term)
      );
    });

  const counts = {
    new: leads.filter((l) => l.status === "new").length,
    contacted: leads.filter((l) => l.status === "contacted").length,
    converted: leads.filter((l) => l.status === "converted").length,
    archived: leads.filter((l) => l.status === "archived").length,
  };

  const createLead = async () => {
    if (!form.customer_name.trim()) { setError("Name is required"); return; }
    setIsSaving(true);
    setError("");
    try {
      const { error: insertErr } = await supabase.from("leads").insert({
        tenant_id: tenantUser?.tenant_id,
        customer_name: form.customer_name.trim(),
        customer_email: form.customer_email || null,
        customer_phone: form.customer_phone || null,
        service_type: form.service_type || null,
        message: form.message || null,
        status: "new",
      });
      if (insertErr) throw insertErr;
      setShowModal(false);
      setForm(emptyForm);
      await fetchLeads();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const updateStatus = async (id: number, newStatus: string) => {
    await supabase.from("leads").update({ status: newStatus }).eq("id", id);
    await fetchLeads();
  };

  const convertToCustomer = async (lead: Lead) => {
    if (!window.confirm(`Convert "${lead.customer_name}" to a customer?`)) return;
    try {
      // Create customer
      const { error: custErr } = await supabase.from("customers").insert({
        tenant_id: tenantUser?.tenant_id,
        customer_name: lead.customer_name,
        phone: lead.customer_phone || null,
        email: lead.customer_email || null,
      });
      if (custErr) throw custErr;

      // Mark lead as converted
      await supabase.from("leads").update({ status: "converted" }).eq("id", lead.id);
      await fetchLeads();
    } catch (err) {
      alert("Error: " + (err as Error).message);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-gray-500 text-sm mt-1">Track and convert incoming leads</p>
        </div>
        <button
          onClick={() => { setForm(emptyForm); setError(""); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 shadow-sm"
        >
          <Plus size={16} />
          New Lead
        </button>
      </div>

      {/* Status counters */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {(["new", "contacted", "converted", "archived"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
            className={`bg-white rounded-xl border p-4 text-left transition-all ${
              statusFilter === s ? "border-indigo-300 ring-2 ring-indigo-100" : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <span className="text-sm font-medium text-gray-500 capitalize">{s}</span>
            <p className="text-2xl font-bold text-gray-900 mt-1">{counts[s]}</p>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search leads..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Funnel size={48} className="text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {leads.length === 0 ? "No leads yet" : "No matching leads"}
            </h3>
            <p className="text-gray-500 text-sm">
              {leads.length === 0 ? "Create your first lead or connect a lead form." : "Try a different search or filter."}
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Contact</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Service</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((lead) => {
                const sc = STATUS_COLORS[lead.status] || STATUS_COLORS.new;
                return (
                  <tr key={lead.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{lead.customer_name}</p>
                      {lead.message && (
                        <p className="text-xs text-gray-400 truncate max-w-[200px]">{lead.message}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {lead.customer_phone && (
                        <p className="flex items-center gap-1 text-xs text-gray-600">
                          <Phone size={12} /> {lead.customer_phone}
                        </p>
                      )}
                      {lead.customer_email && (
                        <p className="flex items-center gap-1 text-xs text-gray-600">
                          <Mail size={12} /> {lead.customer_email}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 capitalize">{lead.service_type || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.text} capitalize`}>
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(lead.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {lead.status === "new" && (
                          <button
                            onClick={() => updateStatus(lead.id, "contacted")}
                            className="px-2 py-1 text-xs font-medium text-yellow-700 bg-yellow-50 rounded hover:bg-yellow-100"
                          >
                            Contacted
                          </button>
                        )}
                        {lead.status !== "converted" && lead.status !== "archived" && (
                          <button
                            onClick={() => convertToCustomer(lead)}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 bg-green-50 rounded hover:bg-green-100"
                          >
                            <UserCheck size={12} /> Convert
                          </button>
                        )}
                        {lead.status !== "archived" && lead.status !== "converted" && (
                          <button
                            onClick={() => updateStatus(lead.id, "archived")}
                            className="px-2 py-1 text-xs font-medium text-gray-500 bg-gray-50 rounded hover:bg-gray-100"
                          >
                            Archive
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Lead Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">New Lead</h3>
              <button onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input type="text" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="Jane Doe" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input type="tel" value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input type="email" value={form.customer_email} onChange={(e) => setForm({ ...form, customer_email: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Service Type</label>
                <input type="text" value={form.service_type} onChange={(e) => setForm({ ...form, service_type: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="Appliance repair, HVAC, etc." />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={3} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="Details about the lead..." />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-gray-200">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={createLead} disabled={isSaving} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {isSaving ? "Creating..." : "Create Lead"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
