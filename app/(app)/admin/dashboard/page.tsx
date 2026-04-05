"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  Building2,
  Plus,
  Search,
  Settings,
  Phone,
  Mail,
  User,
  X,
  Save,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

interface Tenant {
  id: number;
  name: string;
  slug: string;
  plan: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  stripe_connect_account_id: string | null;
  is_active: boolean;
  created_at: string;
}

const emptyTenantForm = {
  name: "",
  slug: "",
  contact_name: "",
  contact_phone: "",
  contact_email: "",
  plan: "professional",
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const { tenantUser } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [form, setForm] = useState(emptyTenantForm);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const fetchTenants = useCallback(async () => {
    const { data } = await supabase
      .from("tenants")
      .select("*")
      .order("name");
    if (data) setTenants(data);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  const filtered = tenants.filter((t) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      t.name.toLowerCase().includes(term) ||
      t.contact_name?.toLowerCase().includes(term) ||
      t.contact_email?.toLowerCase().includes(term) ||
      t.contact_phone?.includes(search)
    );
  });

  const openAdd = () => {
    setEditingTenant(null);
    setForm(emptyTenantForm);
    setError("");
    setShowModal(true);
  };

  const openEdit = (tenant: Tenant) => {
    setEditingTenant(tenant);
    setForm({
      name: tenant.name,
      slug: tenant.slug || "",
      contact_name: tenant.contact_name || "",
      contact_phone: tenant.contact_phone || "",
      contact_email: tenant.contact_email || "",
      plan: tenant.plan || "professional",
    });
    setError("");
    setShowModal(true);
  };

  const saveTenant = async () => {
    if (!form.name.trim()) { setError("Company name is required"); return; }
    setIsSaving(true);
    setError("");

    try {
      const slug = form.slug || form.name.toLowerCase().replace(/[^a-z0-9]/g, "-");

      if (editingTenant) {
        await supabase
          .from("tenants")
          .update({
            name: form.name.trim(),
            slug,
            contact_name: form.contact_name || null,
            contact_phone: form.contact_phone || null,
            contact_email: form.contact_email || null,
            plan: form.plan,
          })
          .eq("id", editingTenant.id);
      } else {
        await supabase.from("tenants").insert({
          name: form.name.trim(),
          slug,
          contact_name: form.contact_name || null,
          contact_phone: form.contact_phone || null,
          contact_email: form.contact_email || null,
          plan: form.plan,
          owner_id: tenantUser?.auth_uid,
          is_active: true,
        });
      }

      setShowModal(false);
      setSuccessMsg(editingTenant ? "Tenant updated" : "Tenant created");
      setTimeout(() => setSuccessMsg(""), 3000);
      await fetchTenants();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
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
          <h1 className="text-2xl font-bold text-gray-900">Super Admin</h1>
          <p className="text-sm text-gray-500">Manage all tenant accounts and integrations</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 shadow-sm"
        >
          <Plus size={16} />
          Add Tenant
        </button>
      </div>

      {successMsg && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
          <CheckCircle2 size={16} className="text-green-500" />
          <p className="text-sm text-green-700">{successMsg}</p>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search tenants..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg"
        />
      </div>

      {/* Tenant Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((tenant) => (
          <div key={tenant.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:border-indigo-200 transition">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <Building2 size={20} className="text-indigo-600" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-gray-900">{tenant.name}</h3>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                    tenant.plan === "professional" ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600"
                  }`}>
                    {tenant.plan}
                  </span>
                </div>
              </div>
              <button onClick={() => openEdit(tenant)} className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg">
                <Settings size={16} />
              </button>
            </div>

            {/* Contact info */}
            <div className="space-y-1.5 mb-4">
              {tenant.contact_name && (
                <p className="flex items-center gap-2 text-sm text-gray-600">
                  <User size={14} className="text-gray-400" /> {tenant.contact_name}
                </p>
              )}
              {tenant.contact_phone && (
                <p className="flex items-center gap-2 text-sm text-gray-600">
                  <Phone size={14} className="text-gray-400" /> {tenant.contact_phone}
                </p>
              )}
              {tenant.contact_email && (
                <p className="flex items-center gap-2 text-sm text-gray-600">
                  <Mail size={14} className="text-gray-400" /> {tenant.contact_email}
                </p>
              )}
              {!tenant.contact_name && !tenant.contact_phone && !tenant.contact_email && (
                <p className="text-sm text-gray-400 italic">No contact info</p>
              )}
            </div>

            {/* Status indicators */}
            <div className="flex items-center gap-3 mb-4">
              <span className={`inline-flex items-center gap-1 text-xs ${
                tenant.stripe_connect_account_id ? "text-green-600" : "text-gray-400"
              }`}>
                {tenant.stripe_connect_account_id ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                Stripe
              </span>
              <span className="text-xs text-gray-400">
                Created {new Date(tenant.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-2">
              <Link
                href={`/admin/tenant/${tenant.id}/integrations`}
                className="text-center px-3 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition"
              >
                Integrations
              </Link>
              <Link
                href={`/admin/tenant/${tenant.id}/zones`}
                className="text-center px-3 py-2 text-sm font-medium text-teal-600 bg-teal-50 rounded-lg hover:bg-teal-100 transition"
              >
                Service Zones
              </Link>
              <Link
                href={`/admin/tenant/${tenant.id}/skills`}
                className="text-center px-3 py-2 text-sm font-medium text-purple-600 bg-purple-50 rounded-lg hover:bg-purple-100 transition"
              >
                Tech Skills
              </Link>
              <button
                onClick={() => openEdit(tenant)}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition"
              >
                Edit Details
              </button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12">
          <Building2 size={48} className="text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">{tenants.length === 0 ? "No tenants yet" : "No matching tenants"}</p>
        </div>
      )}

      {/* Add/Edit Tenant Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingTenant ? "Edit Tenant" : "Add New Tenant"}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg">
                <X size={20} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                  placeholder="Fleming Appliance Repair"
                  autoFocus
                />
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Contact Information</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
                    <input
                      type="text"
                      value={form.contact_name}
                      onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                      placeholder="Darryl Fleming"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                      <input
                        type="tel"
                        value={form.contact_phone}
                        onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                        placeholder="(555) 123-4567"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <input
                        type="email"
                        value={form.contact_email}
                        onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                        placeholder="email@company.com"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Plan</label>
                <select
                  value={form.plan}
                  onChange={(e) => setForm({ ...form, plan: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                >
                  <option value="professional">Professional</option>
                  <option value="starter">Starter</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-3 p-5 border-t border-gray-200">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={saveTenant}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                <Save size={14} />
                {isSaving ? "Saving..." : editingTenant ? "Update" : "Create Tenant"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
