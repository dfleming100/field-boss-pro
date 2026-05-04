"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { Plus, Search } from "lucide-react";

interface Customer {
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

export default function CustomersPage() {
  const router = useRouter();
  const { tenantUser } = useAuth();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [hasFetched, setHasFetched] = useState(false);

  useEffect(() => {
    if (!tenantUser || hasFetched) return;
    setIsLoading(true);
    setHasFetched(true);
    fetchCustomers();
  }, [tenantUser, hasFetched]);

  const fetchCustomers = async () => {
    try {
      // Tech role: limit to customers tied to their WOs (past or present).
      if (tenantUser?.role === "technician" && tenantUser.technician_id) {
        const { data: wos } = await supabase
          .from("work_orders")
          .select("customer_id")
          .eq("tenant_id", tenantUser.tenant_id)
          .eq("assigned_technician_id", tenantUser.technician_id);
        const ids = Array.from(new Set((wos || []).map((w: any) => w.customer_id))).filter(Boolean);
        if (ids.length === 0) {
          setCustomers([]);
          return;
        }
        const { data, error: fetchError } = await supabase
          .from("customers")
          .select("*")
          .eq("tenant_id", tenantUser.tenant_id)
          .in("id", ids)
          .order("customer_name", { ascending: true });
        if (fetchError) throw fetchError;
        setCustomers(data || []);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from("customers")
        .select("*")
        .eq("tenant_id", tenantUser?.tenant_id)
        .order("customer_name", { ascending: true });

      if (fetchError) throw fetchError;
      setCustomers(data || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredCustomers = customers.filter(
    (c) =>
      c.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone?.includes(searchTerm) ||
      c.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleDelete = async (customerId: string) => {
    if (!window.confirm("Delete this customer?")) return;
    try {
      const { error: deleteError } = await supabase
        .from("customers")
        .delete()
        .eq("id", customerId);
      if (deleteError) throw deleteError;
      await fetchCustomers();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-gray-500">Loading customers...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-gray-500 mt-1">Manage your customer database</p>
        </div>
        <Link
          href="/customers/new"
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
        >
          <Plus size={16} />
          Add Customer
        </Link>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name, phone, or email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Phone</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Email</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Address</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">City/State</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredCustomers.map((customer) => (
                <tr key={customer.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/customers/${customer.id}`}
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                    >
                      {customer.customer_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {customer.phone ? (
                      <a href={`tel:${customer.phone}`} className="text-indigo-600 hover:text-indigo-700">
                        {customer.phone}
                      </a>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {customer.email ? (
                      <a href={`mailto:${customer.email}`} className="text-indigo-600 hover:text-indigo-700">
                        {customer.email}
                      </a>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{customer.service_address || "—"}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {[customer.city, customer.state].filter(Boolean).join(", ")} {customer.zip}
                  </td>
                  <td className="px-4 py-3 text-sm flex gap-3">
                    <Link href={`/customers/${customer.id}`} className="text-indigo-600 hover:text-indigo-700 font-medium">
                      Edit
                    </Link>
                    <button
                      onClick={() => handleDelete(customer.id)}
                      className="text-red-600 hover:text-red-700 font-medium"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredCustomers.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="text-gray-500 mb-4">
              {searchTerm ? "No customers match your search" : "No customers yet"}
            </p>
            {!searchTerm && (
              <Link
                href="/customers/new"
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
              >
                Add First Customer
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="mt-6 flex gap-4 text-sm text-gray-500">
        <span>{customers.length} total customers</span>
        {searchTerm && <span>{filteredCustomers.length} matching</span>}
      </div>
    </div>
  );
}
