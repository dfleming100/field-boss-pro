"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { ClipboardList, Flame, RefreshCw } from "lucide-react";
import BossTile from "@/app/components/BossTile";

type WORow = {
  id: number;
  work_order_number: string;
  customer_name: string;
  appliance_type: string | null;
  status: string;
  status_changed_at: string | null;
  created_at: string;
  outreach_count: number | null;
};

const HOT_DAYS_THRESHOLD = 3;

function daysAgo(iso: string | null): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 86400000);
}

export default function BossBoardPage() {
  const { tenantUser } = useAuth();
  const [unscheduled, setUnscheduled] = useState<WORow[]>([]);
  const [hotList, setHotList] = useState<WORow[]>([]);
  const [loadingUnsched, setLoadingUnsched] = useState(true);
  const [loadingHot, setLoadingHot] = useState(true);
  const [errorUnsched, setErrorUnsched] = useState<string | null>(null);
  const [errorHot, setErrorHot] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date>(new Date());

  // Unscheduled new WOs: status in ('New','New Hold') with NO scheduled appointment
  const fetchUnscheduled = useCallback(async () => {
    if (!tenantUser) return;
    setLoadingUnsched(true);
    setErrorUnsched(null);
    try {
      const { data, error } = await supabase
        .from("work_orders")
        .select(`
          id, work_order_number, appliance_type, status, status_changed_at, created_at, outreach_count,
          customer:customers(customer_name),
          appointments(id, status)
        `)
        .eq("tenant_id", tenantUser.tenant_id)
        .in("status", ["New", "New Hold"])
        .order("created_at", { ascending: true });

      if (error) throw error;

      const filtered: WORow[] = (data || [])
        .filter((wo: any) => {
          const appts = wo.appointments || [];
          return !appts.some((a: any) => a.status === "scheduled");
        })
        .map((wo: any) => ({
          id: wo.id,
          work_order_number: wo.work_order_number,
          customer_name: wo.customer?.customer_name || "—",
          appliance_type: wo.appliance_type,
          status: wo.status,
          status_changed_at: wo.status_changed_at,
          created_at: wo.created_at,
          outreach_count: wo.outreach_count,
        }));

      setUnscheduled(filtered);
    } catch (e) {
      setErrorUnsched((e as Error).message);
    } finally {
      setLoadingUnsched(false);
    }
  }, [tenantUser]);

  // Hot List: Parts Have Arrived 3+ days ago, outreached, still no scheduled appointment
  const fetchHotList = useCallback(async () => {
    if (!tenantUser) return;
    setLoadingHot(true);
    setErrorHot(null);
    try {
      const cutoff = new Date(Date.now() - HOT_DAYS_THRESHOLD * 86400000).toISOString();
      const { data, error } = await supabase
        .from("work_orders")
        .select(`
          id, work_order_number, appliance_type, status, status_changed_at, created_at, outreach_count,
          customer:customers(customer_name),
          appointments(id, status)
        `)
        .eq("tenant_id", tenantUser.tenant_id)
        .eq("status", "Parts Have Arrived")
        .lte("status_changed_at", cutoff)
        .gt("outreach_count", 0)
        .order("status_changed_at", { ascending: true });

      if (error) throw error;

      const filtered: WORow[] = (data || [])
        .filter((wo: any) => {
          const appts = wo.appointments || [];
          return !appts.some((a: any) => a.status === "scheduled");
        })
        .map((wo: any) => ({
          id: wo.id,
          work_order_number: wo.work_order_number,
          customer_name: wo.customer?.customer_name || "—",
          appliance_type: wo.appliance_type,
          status: wo.status,
          status_changed_at: wo.status_changed_at,
          created_at: wo.created_at,
          outreach_count: wo.outreach_count,
        }));

      setHotList(filtered);
    } catch (e) {
      setErrorHot((e as Error).message);
    } finally {
      setLoadingHot(false);
    }
  }, [tenantUser]);

  const refreshAll = useCallback(() => {
    fetchUnscheduled();
    fetchHotList();
    setRefreshedAt(new Date());
  }, [fetchUnscheduled, fetchHotList]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Realtime: any change to work_orders or appointments for this tenant triggers a refresh.
  // Cheap because we rebuild only the two tiles' queries, not full-page state.
  useEffect(() => {
    if (!tenantUser) return;
    const tid = tenantUser.tenant_id;

    const channel = supabase
      .channel(`boss-board-${tid}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "work_orders", filter: `tenant_id=eq.${tid}` },
        () => refreshAll()
      )
      .on("postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `tenant_id=eq.${tid}` },
        () => refreshAll()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenantUser, refreshAll]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Boss Board</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Live ops view · refreshed {refreshedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </p>
        </div>
        <button
          onClick={refreshAll}
          className="text-slate-500 hover:text-slate-800 p-2 rounded-lg hover:bg-slate-100 transition"
          aria-label="Refresh"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <BossTile
          title="Unscheduled New WOs"
          icon={ClipboardList}
          accent="blue"
          count={unscheduled.length}
          loading={loadingUnsched}
          error={errorUnsched}
          empty={unscheduled.length === 0}
          emptyText="All new work orders are scheduled. 🎯"
        >
          <ul className="text-sm divide-y divide-slate-100">
            {unscheduled.slice(0, 5).map((wo) => (
              <li key={wo.id} className="py-2 flex items-center justify-between gap-2">
                <Link href={`/jobs/${wo.id}`} className="min-w-0 flex-1 hover:text-blue-700">
                  <div className="font-medium text-slate-800 truncate">{wo.customer_name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    #{wo.work_order_number}
                    {wo.appliance_type && ` · ${wo.appliance_type}`}
                  </div>
                </Link>
                <div className="text-right shrink-0">
                  <div className="text-xs font-medium text-slate-700">{daysAgo(wo.created_at)}d</div>
                  <div className="text-[10px] text-slate-400">old</div>
                </div>
              </li>
            ))}
          </ul>
          {unscheduled.length > 5 && (
            <div className="text-xs text-slate-500 mt-2">+ {unscheduled.length - 5} more</div>
          )}
        </BossTile>

        <BossTile
          title="Hot List"
          icon={Flame}
          accent="rose"
          count={hotList.length}
          loading={loadingHot}
          error={errorHot}
          empty={hotList.length === 0}
          emptyText="No stuck parts-arrived jobs. 🔥"
          footer={`Parts arrived ${HOT_DAYS_THRESHOLD}+ days ago, outreached, still unbooked`}
        >
          <ul className="text-sm divide-y divide-slate-100">
            {hotList.slice(0, 5).map((wo) => (
              <li key={wo.id} className="py-2 flex items-center justify-between gap-2">
                <Link href={`/jobs/${wo.id}`} className="min-w-0 flex-1 hover:text-rose-700">
                  <div className="font-medium text-slate-800 truncate">{wo.customer_name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    #{wo.work_order_number}
                    {wo.appliance_type && ` · ${wo.appliance_type}`}
                  </div>
                </Link>
                <div className="text-right shrink-0">
                  <div className="text-xs font-medium text-rose-700">{daysAgo(wo.status_changed_at)}d</div>
                  <div className="text-[10px] text-slate-400">stuck · {wo.outreach_count}x out</div>
                </div>
              </li>
            ))}
          </ul>
          {hotList.length > 5 && (
            <div className="text-xs text-slate-500 mt-2">+ {hotList.length - 5} more</div>
          )}
        </BossTile>
      </div>

      <div className="mt-6 text-center text-xs text-slate-400">
        More tiles coming in Phase 2 — Today's Schedule, Outreach Pipeline, Tech Capacity, Parts Pipeline.
      </div>
    </div>
  );
}
