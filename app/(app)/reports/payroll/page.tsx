"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, DollarSign, Calendar, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface VisitRecord {
  id: number;
  work_order_number: string;
  customer_name: string;
  appliance_type: string;
  first_visit_date: string;
  tech_name: string;
}

export default function PayrollReportPage() {
  const router = useRouter();
  const { tenantUser } = useAuth();
  const [techs, setTechs] = useState<any[]>([]);
  const [selectedTech, setSelectedTech] = useState("all");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchTechs = useCallback(async () => {
    if (!tenantUser) return;
    const { data } = await supabase
      .from("technicians")
      .select("id, tech_name")
      .eq("tenant_id", tenantUser.tenant_id)
      .eq("is_active", true)
      .order("tech_name");
    if (data) setTechs(data);
  }, [tenantUser]);

  const fetchVisits = useCallback(async () => {
    if (!tenantUser) return;
    setIsLoading(true);

    let query = supabase
      .from("work_orders")
      .select(`
        id, work_order_number, appliance_type, first_visit_date, first_visit_tech_id,
        customer:customers(customer_name),
        tech:technicians!first_visit_tech_id(tech_name)
      `)
      .eq("tenant_id", tenantUser.tenant_id)
      .eq("first_visit_completed", true)
      .gte("first_visit_date", startDate + "T00:00:00")
      .lte("first_visit_date", endDate + "T23:59:59")
      .order("first_visit_date", { ascending: false });

    if (selectedTech !== "all") {
      query = query.eq("first_visit_tech_id", selectedTech);
    }

    const { data } = await query;

    if (data) {
      setVisits(data.map((v: any) => ({
        ...v,
        customer_name: v.customer?.customer_name || "—",
        tech_name: v.tech?.tech_name || "—",
      })));
    }
    setIsLoading(false);
  }, [tenantUser, startDate, endDate, selectedTech]);

  useEffect(() => { fetchTechs(); }, [fetchTechs]);
  useEffect(() => { fetchVisits(); }, [fetchVisits]);

  // Group by tech for summary
  const techSummary: Record<string, number> = {};
  for (const v of visits) {
    techSummary[v.tech_name] = (techSummary[v.tech_name] || 0) + 1;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tech Payroll Report</h1>
          <p className="text-sm text-gray-500">Completed first visits by technician</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Technician</label>
            <select
              value={selectedTech}
              onChange={(e) => setSelectedTech(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
            >
              <option value="all">All Technicians</option>
              {techs.map((t) => (
                <option key={t.id} value={t.id}>{t.tech_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">From</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">To</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
            />
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={16} className="text-green-500" />
            <span className="text-xs font-semibold text-gray-500 uppercase">Total First Visits</span>
          </div>
          <p className="text-3xl font-bold text-gray-900">{visits.length}</p>
        </div>
        {Object.entries(techSummary).map(([name, count]) => (
          <div key={name} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-2">
              <User size={16} className="text-indigo-500" />
              <span className="text-xs font-semibold text-gray-500 uppercase">{name}</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{count}</p>
          </div>
        ))}
      </div>

      {/* Visit List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">WO #</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Customer</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Appliance</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Tech</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visits.map((v) => (
              <tr key={v.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => window.location.href = `/work-orders/${v.id}`}>
                <td className="px-4 py-3 text-sm text-gray-900">
                  {new Date(v.first_visit_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </td>
                <td className="px-4 py-3">
                  <Link href={`/work-orders/${v.id}`} className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">
                    {v.work_order_number}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">{v.customer_name}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{v.appliance_type || "—"}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{v.tech_name}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {visits.length === 0 && (
          <div className="p-12 text-center">
            <Calendar size={48} className="text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No completed first visits in this date range</p>
          </div>
        )}
      </div>
    </div>
  );
}
