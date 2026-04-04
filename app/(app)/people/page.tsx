"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { Users, Wrench, Search, Plus, X, Pencil, ToggleLeft, ToggleRight } from "lucide-react";

interface Technician {
  id: number;
  tech_name: string;
  phone: string | null;
  email: string | null;
  skills: string | null;
  is_active: boolean;
}

interface Customer {
  id: number;
  customer_name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
}

interface TechForm {
  tech_name: string;
  phone: string;
  email: string;
  skills: string;
}

const emptyTechForm: TechForm = { tech_name: "", phone: "", email: "", skills: "" };

export default function PeoplePage() {
  const { tenantUser } = useAuth();
  const [tab, setTab] = useState<"technicians" | "customers">("technicians");
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");

  // Tech modal state
  const [showTechModal, setShowTechModal] = useState(false);
  const [editingTechId, setEditingTechId] = useState<number | null>(null);
  const [techForm, setTechForm] = useState<TechForm>(emptyTechForm);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    if (!tenantUser) return;
    const [techRes, custRes] = await Promise.all([
      supabase
        .from("technicians")
        .select("id, tech_name, phone, email, skills, is_active")
        .eq("tenant_id", tenantUser.tenant_id)
        .order("tech_name"),
      supabase
        .from("customers")
        .select("id, customer_name, phone, email, city, state")
        .eq("tenant_id", tenantUser.tenant_id)
        .order("customer_name"),
    ]);
    if (techRes.data) setTechnicians(techRes.data);
    if (custRes.data) setCustomers(custRes.data);
  }, [tenantUser]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredTechs = technicians.filter((t) =>
    t.tech_name.toLowerCase().includes(search.toLowerCase())
  );
  const filteredCustomers = customers.filter((c) =>
    c.customer_name.toLowerCase().includes(search.toLowerCase())
  );

  // ── Tech CRUD ──
  const openAddTech = () => {
    setEditingTechId(null);
    setTechForm(emptyTechForm);
    setError("");
    setShowTechModal(true);
  };

  const openEditTech = (tech: Technician) => {
    setEditingTechId(tech.id);
    setTechForm({
      tech_name: tech.tech_name,
      phone: tech.phone || "",
      email: tech.email || "",
      skills: tech.skills || "",
    });
    setError("");
    setShowTechModal(true);
  };

  const saveTech = async () => {
    if (!techForm.tech_name.trim()) {
      setError("Name is required");
      return;
    }
    setIsSaving(true);
    setError("");

    try {
      if (editingTechId) {
        const { error: updateErr } = await supabase
          .from("technicians")
          .update({
            tech_name: techForm.tech_name.trim(),
            phone: techForm.phone || null,
            email: techForm.email || null,
            skills: techForm.skills || null,
          })
          .eq("id", editingTechId)
          .eq("tenant_id", tenantUser?.tenant_id);
        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase
          .from("technicians")
          .insert({
            tenant_id: tenantUser?.tenant_id,
            tech_name: techForm.tech_name.trim(),
            phone: techForm.phone || null,
            email: techForm.email || null,
            skills: techForm.skills || null,
            is_active: true,
          });
        if (insertErr) throw insertErr;
      }
      setShowTechModal(false);
      await fetchData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleTechActive = async (tech: Technician) => {
    await supabase
      .from("technicians")
      .update({ is_active: !tech.is_active })
      .eq("id", tech.id)
      .eq("tenant_id", tenantUser?.tenant_id);
    await fetchData();
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Technicians</h1>
          <p className="text-gray-500 text-sm mt-1">Manage your service technicians</p>
        </div>
        {tab === "technicians" && (
          <button
            onClick={openAddTech}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 shadow-sm"
          >
            <Plus size={16} />
            Add Technician
          </button>
        )}
        {tab === "customers" && (
          <Link
            href="/customers/new"
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 shadow-sm"
          >
            <Plus size={16} />
            Add Customer
          </Link>
        )}
      </div>

      {/* Tabs + Search */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setTab("technicians")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === "technicians"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Wrench size={16} />
            Technicians ({technicians.length})
          </button>
          <button
            onClick={() => setTab("customers")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === "customers"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Users size={16} />
            Customers ({customers.length})
          </button>
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm rounded-lg border border-gray-300 w-64"
          />
        </div>
      </div>

      {/* ── Technicians Tab ── */}
      {tab === "technicians" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {filteredTechs.length === 0 ? (
            <div className="p-12 text-center">
              <Wrench size={48} className="text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {search ? "No matching technicians" : "No technicians yet"}
              </h3>
              <p className="text-gray-500 text-sm mb-4">
                {search ? "Try a different search term" : "Add your first technician to start scheduling"}
              </p>
              {!search && (
                <button
                  onClick={openAddTech}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
                >
                  <Plus size={16} />
                  Add Technician
                </button>
              )}
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Phone</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Email</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Skills</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredTechs.map((tech) => (
                  <tr key={tech.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{tech.tech_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {tech.phone ? (
                        <a href={`tel:${tech.phone}`} className="text-indigo-600 hover:text-indigo-700">{tech.phone}</a>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {tech.email ? (
                        <a href={`mailto:${tech.email}`} className="text-indigo-600 hover:text-indigo-700">{tech.email}</a>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{tech.skills || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        tech.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                      }`}>
                        {tech.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditTech(tech)}
                          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => toggleTechActive(tech)}
                          className={`p-1.5 rounded-lg transition ${
                            tech.is_active
                              ? "text-green-500 hover:text-red-500 hover:bg-red-50"
                              : "text-gray-400 hover:text-green-500 hover:bg-green-50"
                          }`}
                          title={tech.is_active ? "Deactivate" : "Activate"}
                        >
                          {tech.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Customers Tab ── */}
      {tab === "customers" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {filteredCustomers.length === 0 ? (
            <div className="p-12 text-center">
              <Users size={48} className="text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No customers</h3>
              <p className="text-gray-500 text-sm mb-4">Add your first customer to get started.</p>
              <Link
                href="/customers/new"
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
              >
                <Plus size={16} />
                Add Customer
              </Link>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Phone</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Email</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Location</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredCustomers.map((cust) => (
                  <tr key={cust.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={`/customers/${cust.id}`} className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
                        {cust.customer_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{cust.phone || "—"}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{cust.email || "—"}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {[cust.city, cust.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/customers/${cust.id}`} className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Technician Add/Edit Modal ── */}
      {showTechModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingTechId ? "Edit Technician" : "Add Technician"}
              </h3>
              <button
                onClick={() => setShowTechModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={techForm.tech_name}
                  onChange={(e) => setTechForm({ ...techForm, tech_name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                  placeholder="John Smith"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={techForm.phone}
                    onChange={(e) => setTechForm({ ...techForm, phone: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                    placeholder="(555) 123-4567"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={techForm.email}
                    onChange={(e) => setTechForm({ ...techForm, email: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                    placeholder="john@example.com"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Skills</label>
                <input
                  type="text"
                  value={techForm.skills}
                  onChange={(e) => setTechForm({ ...techForm, skills: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                  placeholder="HVAC, Plumbing, Electrical"
                />
                <p className="text-xs text-gray-400 mt-1">Comma-separated</p>
              </div>
            </div>

            <div className="flex justify-end gap-3 p-5 border-t border-gray-200">
              <button
                onClick={() => setShowTechModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveTech}
                disabled={isSaving}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {isSaving ? "Saving..." : editingTechId ? "Update" : "Add Technician"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
