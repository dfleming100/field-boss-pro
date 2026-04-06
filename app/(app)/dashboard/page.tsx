"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  ClipboardList,
  Users,
  CalendarDays,
  CreditCard,
  Clock,
  CheckCircle2,
  AlertCircle,
  Wrench,
  ArrowRight,
  Plus,
  Funnel,
} from "lucide-react";

interface Stats {
  totalWorkOrders: number;
  openWorkOrders: number;
  scheduledToday: number;
  completedThisWeek: number;
  totalCustomers: number;
  totalTechs: number;
  newLeads: number;
}

interface RecentWO {
  id: string;
  work_order_number: string;
  status: string;
  customer_name: string;
  job_type: string;
  created_at: string;
}

interface TodayAppt {
  id: number;
  appointment_date: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
  tech_name: string;
  work_order_number: string;
  customer_name: string;
  work_order_id: number;
}

const STATUS_COLORS: Record<string, string> = {
  "New": "bg-blue-100 text-blue-700",
  "Parts Ordered": "bg-amber-100 text-amber-700",
  "Parts Have Arrived": "bg-teal-100 text-teal-700",
  "Scheduled": "bg-purple-100 text-purple-700",
  "Complete": "bg-green-100 text-green-700",
};

export default function DashboardPage() {
  const { user, tenantUser } = useAuth();
  const [stats, setStats] = useState<Stats>({
    totalWorkOrders: 0, openWorkOrders: 0, scheduledToday: 0,
    completedThisWeek: 0, totalCustomers: 0, totalTechs: 0, newLeads: 0,
  });
  const [recentWOs, setRecentWOs] = useState<RecentWO[]>([]);
  const [todayAppts, setTodayAppts] = useState<TodayAppt[]>([]);

  const fetchAll = useCallback(async () => {
    if (!tenantUser) return;
    const tid = tenantUser.tenant_id;
    const today = new Date().toISOString().split("T")[0];
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

    const [
      totalWO, openWO, todayCount, completedWO,
      custCount, techCount, leadCount,
      recentRes, apptRes,
    ] = await Promise.all([
      supabase.from("work_orders").select("id", { count: "exact", head: true }).eq("tenant_id", tid),
      supabase.from("work_orders").select("id", { count: "exact", head: true }).eq("tenant_id", tid).in("status", ["New", "Parts Ordered", "Parts Have Arrived", "Scheduled"]),
      supabase.from("appointments").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("appointment_date", today),
      supabase.from("work_orders").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("status", "Complete").gte("updated_at", weekAgo),
      supabase.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", tid),
      supabase.from("technicians").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("is_active", true),
      supabase.from("leads").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("status", "new"),
      supabase.from("work_orders").select("*, customer:customers(customer_name)").eq("tenant_id", tid).order("created_at", { ascending: false }).limit(5),
      supabase.from("appointments").select(`*, technician:technicians!assigned_technician_id(tech_name), work_order:work_orders(work_order_number, customer_id, customer:customers(customer_name))`).eq("tenant_id", tid).eq("appointment_date", today).order("start_time"),
    ]);

    setStats({
      totalWorkOrders: totalWO.count || 0,
      openWorkOrders: openWO.count || 0,
      scheduledToday: todayCount.count || 0,
      completedThisWeek: completedWO.count || 0,
      totalCustomers: custCount.count || 0,
      totalTechs: techCount.count || 0,
      newLeads: leadCount.count || 0,
    });

    if (recentRes.data) {
      setRecentWOs(recentRes.data.map((wo: any) => ({
        ...wo, customer_name: wo.customer?.customer_name || "—",
      })));
    }

    if (apptRes.data) {
      setTodayAppts(apptRes.data.map((a: any) => ({
        ...a,
        tech_name: a.technician?.tech_name || "Unassigned",
        work_order_number: a.work_order?.work_order_number || "",
        customer_name: a.work_order?.customer?.customer_name || "—",
      })));
    }
  }, [tenantUser]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const formatStatus = (s: string) => s;

  const formatTime = (t: string | null) => {
    if (!t) return "";
    const [h, m] = t.split(":");
    const hour = parseInt(h);
    return `${hour > 12 ? hour - 12 : hour}:${m} ${hour >= 12 ? "PM" : "AM"}`;
  };

  const statCards = [
    { label: "Open Work Orders", value: stats.openWorkOrders, icon: ClipboardList, color: "text-orange-600", bg: "bg-orange-50", href: "/work-orders" },
    { label: "Scheduled Today", value: stats.scheduledToday, icon: CalendarDays, color: "text-purple-600", bg: "bg-purple-50", href: "/scheduling" },
    { label: "Completed (7d)", value: stats.completedThisWeek, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50", href: "/work-orders" },
    { label: "New Leads", value: stats.newLeads, icon: Funnel, color: "text-blue-600", bg: "bg-blue-50", href: "/leads" },
    { label: "Customers", value: stats.totalCustomers, icon: Users, color: "text-indigo-600", bg: "bg-indigo-50", href: "/customers" },
    { label: "Technicians", value: stats.totalTechs, icon: Wrench, color: "text-teal-600", bg: "bg-teal-50", href: "/people" },
  ];

  return (
    <div>
      {/* Welcome */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back, {tenantUser?.first_name || user?.email?.split("@")[0] || "User"}
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
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

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              href={card.href}
              className="bg-white rounded-xl border border-gray-200 p-4 hover:border-indigo-200 hover:shadow-sm transition group"
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`w-8 h-8 ${card.bg} rounded-lg flex items-center justify-center`}>
                  <Icon size={16} className={card.color} />
                </div>
              </div>
              <p className="text-2xl font-bold text-gray-900">{card.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{card.label}</p>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Schedule */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <CalendarDays size={18} className="text-purple-500" />
              <h2 className="text-base font-semibold text-gray-900">Today&apos;s Schedule</h2>
            </div>
            <Link href="/scheduling" className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium">
              View All <ArrowRight size={12} />
            </Link>
          </div>
          {todayAppts.length === 0 ? (
            <div className="p-8 text-center">
              <Clock size={32} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No appointments scheduled for today</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {todayAppts.map((appt) => (
                <Link
                  key={appt.id}
                  href={`/work-orders/${appt.work_order_id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 text-center">
                      <p className="text-xs font-bold text-purple-600">
                        {formatTime(appt.start_time) || "TBD"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{appt.customer_name}</p>
                      <p className="text-xs text-gray-500">{appt.work_order_number} &middot; {appt.tech_name}</p>
                    </div>
                  </div>
                  <span className="text-xs capitalize text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                    {appt.status}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent Work Orders */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <ClipboardList size={18} className="text-indigo-500" />
              <h2 className="text-base font-semibold text-gray-900">Recent Work Orders</h2>
            </div>
            <Link href="/work-orders" className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium">
              View All <ArrowRight size={12} />
            </Link>
          </div>
          {recentWOs.length === 0 ? (
            <div className="p-8 text-center">
              <ClipboardList size={32} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No work orders yet</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {recentWOs.map((wo) => (
                <Link
                  key={wo.id}
                  href={`/work-orders/${wo.id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition"
                >
                  <div>
                    <p className="text-sm font-semibold text-indigo-600">{wo.work_order_number}</p>
                    <p className="text-xs text-gray-500">{wo.customer_name} &middot; {wo.job_type}</p>
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
      </div>
    </div>
  );
}
