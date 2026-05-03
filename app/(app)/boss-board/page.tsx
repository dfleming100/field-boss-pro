"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { ClipboardList, Flame, CalendarDays, MessageCircle, Gauge, Package, RefreshCw } from "lucide-react";
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

type TodayApptByTech = {
  tech_id: number;
  tech_name: string;
  max_daily: number;
  appts: { id: number; start_time: string | null; customer_name: string; wo_id: number; wo_number: string }[];
};

type OutreachBuckets = {
  never: number;
  cold: number;
  replied_unbooked: number;
  booked: number;
};

type CapacityRow = {
  tech_id: number;
  tech_name: string;
  today_booked: number;
  today_max: number;
  week_booked: number;
  week_max: number;
};

type PartsRow = {
  ordered_count: number;
  ordered_avg_days: number;
  arrived_count: number;
  arrived_avg_days: number;
};

const HOT_DAYS_THRESHOLD = 3;

function daysAgo(iso: string | null): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 86400000);
}

function todayCT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function plusDaysCT(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function fmtTime(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hh = parseInt(h, 10);
  const ampm = hh >= 12 ? "PM" : "AM";
  const hh12 = hh % 12 || 12;
  return `${hh12}:${m} ${ampm}`;
}

export default function BossBoardPage() {
  const { tenantUser } = useAuth();

  const [unscheduled, setUnscheduled] = useState<WORow[]>([]);
  const [hotList, setHotList] = useState<WORow[]>([]);
  const [todaySched, setTodaySched] = useState<TodayApptByTech[]>([]);
  const [outreach, setOutreach] = useState<OutreachBuckets>({ never: 0, cold: 0, replied_unbooked: 0, booked: 0 });
  const [capacity, setCapacity] = useState<CapacityRow[]>([]);
  const [parts, setParts] = useState<PartsRow>({ ordered_count: 0, ordered_avg_days: 0, arrived_count: 0, arrived_avg_days: 0 });

  const [loading, setLoading] = useState({ u: true, h: true, t: true, o: true, c: true, p: true });
  const [errors, setErrors] = useState<{ [k: string]: string | null }>({});
  const [refreshedAt, setRefreshedAt] = useState<Date>(new Date());

  // ── Tile 1: Unscheduled New WOs ──────────────────────────────────────────
  const fetchUnscheduled = useCallback(async () => {
    if (!tenantUser) return;
    setLoading((s) => ({ ...s, u: true }));
    try {
      const { data, error } = await supabase
        .from("work_orders")
        .select(`id, work_order_number, appliance_type, status, status_changed_at, created_at, outreach_count,
          customer:customers(customer_name), appointments(id, status)`)
        .eq("tenant_id", tenantUser.tenant_id)
        .in("status", ["New", "New Hold"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      const filtered: WORow[] = (data || [])
        .filter((wo: any) => !(wo.appointments || []).some((a: any) => a.status === "scheduled"))
        .map((wo: any) => ({
          id: wo.id, work_order_number: wo.work_order_number,
          customer_name: wo.customer?.customer_name || "—",
          appliance_type: wo.appliance_type, status: wo.status,
          status_changed_at: wo.status_changed_at, created_at: wo.created_at,
          outreach_count: wo.outreach_count,
        }));
      setUnscheduled(filtered);
      setErrors((e) => ({ ...e, u: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, u: (e as Error).message }));
    } finally {
      setLoading((s) => ({ ...s, u: false }));
    }
  }, [tenantUser]);

  // ── Tile 2: Hot List ────────────────────────────────────────────────────
  const fetchHotList = useCallback(async () => {
    if (!tenantUser) return;
    setLoading((s) => ({ ...s, h: true }));
    try {
      const cutoff = new Date(Date.now() - HOT_DAYS_THRESHOLD * 86400000).toISOString();
      const { data, error } = await supabase
        .from("work_orders")
        .select(`id, work_order_number, appliance_type, status, status_changed_at, created_at, outreach_count,
          customer:customers(customer_name), appointments(id, status)`)
        .eq("tenant_id", tenantUser.tenant_id)
        .eq("status", "Parts Have Arrived")
        .lte("status_changed_at", cutoff)
        .gt("outreach_count", 0)
        .order("status_changed_at", { ascending: true });
      if (error) throw error;
      const filtered: WORow[] = (data || [])
        .filter((wo: any) => !(wo.appointments || []).some((a: any) => a.status === "scheduled"))
        .map((wo: any) => ({
          id: wo.id, work_order_number: wo.work_order_number,
          customer_name: wo.customer?.customer_name || "—",
          appliance_type: wo.appliance_type, status: wo.status,
          status_changed_at: wo.status_changed_at, created_at: wo.created_at,
          outreach_count: wo.outreach_count,
        }));
      setHotList(filtered);
      setErrors((e) => ({ ...e, h: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, h: (e as Error).message }));
    } finally {
      setLoading((s) => ({ ...s, h: false }));
    }
  }, [tenantUser]);

  // ── Tile 3: Today's Schedule by Tech ────────────────────────────────────
  const fetchTodaySchedule = useCallback(async () => {
    if (!tenantUser) return;
    setLoading((s) => ({ ...s, t: true }));
    try {
      const today = todayCT();
      const [techRes, apptRes] = await Promise.all([
        supabase.from("technicians")
          .select("id, tech_name, max_daily_appointments")
          .eq("tenant_id", tenantUser.tenant_id)
          .eq("is_active", true)
          .order("tech_name"),
        supabase.from("appointments")
          .select(`id, technician_id, start_time, status,
            work_order:work_orders!inner(id, work_order_number, customer:customers(customer_name))`)
          .eq("tenant_id", tenantUser.tenant_id)
          .eq("appointment_date", today)
          .eq("status", "scheduled")
          .order("start_time"),
      ]);
      if (techRes.error) throw techRes.error;
      if (apptRes.error) throw apptRes.error;

      const techs = (techRes.data || []).map((t: any) => ({
        tech_id: t.id,
        tech_name: t.tech_name,
        max_daily: t.max_daily_appointments || 12,
        appts: [] as TodayApptByTech["appts"],
      }));
      const byId: Record<number, TodayApptByTech> = Object.fromEntries(techs.map((t) => [t.tech_id, t]));

      for (const a of (apptRes.data as any[]) || []) {
        const wo = Array.isArray(a.work_order) ? a.work_order[0] : a.work_order;
        const cust = wo && (Array.isArray(wo.customer) ? wo.customer[0] : wo.customer);
        if (byId[a.technician_id]) {
          byId[a.technician_id].appts.push({
            id: a.id,
            start_time: a.start_time,
            customer_name: cust?.customer_name || "—",
            wo_id: wo?.id,
            wo_number: wo?.work_order_number || "",
          });
        }
      }
      setTodaySched(techs);
      setErrors((e) => ({ ...e, t: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, t: (e as Error).message }));
    } finally {
      setLoading((s) => ({ ...s, t: false }));
    }
  }, [tenantUser]);

  // ── Tile 4: Outreach Pipeline ───────────────────────────────────────────
  const fetchOutreach = useCallback(async () => {
    if (!tenantUser) return;
    setLoading((s) => ({ ...s, o: true }));
    try {
      // Outreach is meaningful for WOs that should be talking to the customer:
      // status in ('New','Parts Have Arrived'). Anything completed/scheduled
      // is moved out of the funnel.
      const { data: wos, error } = await supabase
        .from("work_orders")
        .select(`id, status, outreach_count, last_outreach_date, customer_id,
          appointments(id, status)`)
        .eq("tenant_id", tenantUser.tenant_id)
        .in("status", ["New", "Parts Have Arrived"]);
      if (error) throw error;

      // Pull recent inbound SMS (last 30d) once and group by customer_id.
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: inbound } = await supabase
        .from("sms_conversations")
        .select("customer_id, created_at")
        .eq("tenant_id", tenantUser.tenant_id)
        .eq("direction", "inbound")
        .gte("created_at", since);
      const repliedCustomers = new Set((inbound || []).map((m: any) => m.customer_id).filter(Boolean));

      const buckets: OutreachBuckets = { never: 0, cold: 0, replied_unbooked: 0, booked: 0 };

      for (const wo of (wos as any[]) || []) {
        const hasScheduled = (wo.appointments || []).some((a: any) => a.status === "scheduled");
        if (hasScheduled) { buckets.booked++; continue; }

        if (repliedCustomers.has(wo.customer_id)) {
          buckets.replied_unbooked++;
          continue;
        }

        const count = wo.outreach_count || 0;
        if (count === 0) buckets.never++;
        else buckets.cold++;
      }

      setOutreach(buckets);
      setErrors((e) => ({ ...e, o: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, o: (e as Error).message }));
    } finally {
      setLoading((s) => ({ ...s, o: false }));
    }
  }, [tenantUser]);

  // ── Tile 5: Tech Capacity (today + 7-day rolling) ───────────────────────
  const fetchCapacity = useCallback(async () => {
    if (!tenantUser) return;
    setLoading((s) => ({ ...s, c: true }));
    try {
      const today = todayCT();
      const weekEnd = plusDaysCT(7);
      const [techRes, apptRes] = await Promise.all([
        supabase.from("technicians")
          .select("id, tech_name, max_daily_appointments")
          .eq("tenant_id", tenantUser.tenant_id)
          .eq("is_active", true)
          .order("tech_name"),
        supabase.from("appointments")
          .select("technician_id, appointment_date, status")
          .eq("tenant_id", tenantUser.tenant_id)
          .eq("status", "scheduled")
          .gte("appointment_date", today)
          .lt("appointment_date", weekEnd),
      ]);
      if (techRes.error) throw techRes.error;
      if (apptRes.error) throw apptRes.error;

      const rows: CapacityRow[] = (techRes.data || []).map((t: any) => {
        const max = t.max_daily_appointments || 12;
        const techAppts = ((apptRes.data as any[]) || []).filter((a) => a.technician_id === t.id);
        const todayBooked = techAppts.filter((a) => a.appointment_date === today).length;
        const weekBooked = techAppts.length;
        return {
          tech_id: t.id, tech_name: t.tech_name,
          today_booked: todayBooked, today_max: max,
          week_booked: weekBooked, week_max: max * 7,
        };
      });
      setCapacity(rows);
      setErrors((e) => ({ ...e, c: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, c: (e as Error).message }));
    } finally {
      setLoading((s) => ({ ...s, c: false }));
    }
  }, [tenantUser]);

  // ── Tile 6: Parts Pipeline ──────────────────────────────────────────────
  const fetchParts = useCallback(async () => {
    if (!tenantUser) return;
    setLoading((s) => ({ ...s, p: true }));
    try {
      const { data, error } = await supabase
        .from("work_orders")
        .select("id, status, status_changed_at")
        .eq("tenant_id", tenantUser.tenant_id)
        .in("status", ["Parts Ordered", "Parts Have Arrived"]);
      if (error) throw error;

      const ordered = (data || []).filter((w: any) => w.status === "Parts Ordered");
      const arrived = (data || []).filter((w: any) => w.status === "Parts Have Arrived");
      const avgDays = (rows: any[]) =>
        rows.length === 0 ? 0 :
          Math.round(rows.reduce((sum, r) => sum + daysAgo(r.status_changed_at), 0) / rows.length);

      setParts({
        ordered_count: ordered.length, ordered_avg_days: avgDays(ordered),
        arrived_count: arrived.length, arrived_avg_days: avgDays(arrived),
      });
      setErrors((e) => ({ ...e, p: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, p: (e as Error).message }));
    } finally {
      setLoading((s) => ({ ...s, p: false }));
    }
  }, [tenantUser]);

  const refreshAll = useCallback(() => {
    fetchUnscheduled(); fetchHotList(); fetchTodaySchedule();
    fetchOutreach(); fetchCapacity(); fetchParts();
    setRefreshedAt(new Date());
  }, [fetchUnscheduled, fetchHotList, fetchTodaySchedule, fetchOutreach, fetchCapacity, fetchParts]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  useEffect(() => {
    if (!tenantUser) return;
    const tid = tenantUser.tenant_id;
    const channel = supabase
      .channel(`boss-board-${tid}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "work_orders", filter: `tenant_id=eq.${tid}` },
        () => refreshAll())
      .on("postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `tenant_id=eq.${tid}` },
        () => refreshAll())
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "sms_conversations", filter: `tenant_id=eq.${tid}` },
        () => fetchOutreach())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenantUser, refreshAll, fetchOutreach]);

  const totalTodayBooked = capacity.reduce((s, r) => s + r.today_booked, 0);
  const totalTodayMax = capacity.reduce((s, r) => s + r.today_max, 0);
  const todayPct = totalTodayMax === 0 ? 0 : Math.round((totalTodayBooked / totalTodayMax) * 100);
  const totalWeekBooked = capacity.reduce((s, r) => s + r.week_booked, 0);
  const totalWeekMax = capacity.reduce((s, r) => s + r.week_max, 0);
  const weekPct = totalWeekMax === 0 ? 0 : Math.round((totalWeekBooked / totalWeekMax) * 100);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Boss Board</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Live ops view · refreshed {refreshedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </p>
        </div>
        <button onClick={refreshAll}
          className="text-slate-500 hover:text-slate-800 p-2 rounded-lg hover:bg-slate-100 transition"
          aria-label="Refresh">
          <RefreshCw size={18} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* Unscheduled */}
        <BossTile
          title="Unscheduled New WOs" icon={ClipboardList} accent="blue"
          count={unscheduled.length} loading={loading.u} error={errors.u}
          empty={unscheduled.length === 0} emptyText="All new work orders are scheduled."
        >
          <ul className="text-sm divide-y divide-slate-100">
            {unscheduled.slice(0, 5).map((wo) => (
              <li key={wo.id} className="py-2 flex items-center justify-between gap-2">
                <Link href={`/jobs/${wo.id}`} className="min-w-0 flex-1 hover:text-blue-700">
                  <div className="font-medium text-slate-800 truncate">{wo.customer_name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    #{wo.work_order_number}{wo.appliance_type && ` · ${wo.appliance_type}`}
                  </div>
                </Link>
                <div className="text-right shrink-0">
                  <div className="text-xs font-medium text-slate-700">{daysAgo(wo.created_at)}d</div>
                  <div className="text-[10px] text-slate-400">old</div>
                </div>
              </li>
            ))}
          </ul>
          {unscheduled.length > 5 && <div className="text-xs text-slate-500 mt-2">+ {unscheduled.length - 5} more</div>}
        </BossTile>

        {/* Hot List */}
        <BossTile
          title="Hot List" icon={Flame} accent="rose"
          count={hotList.length} loading={loading.h} error={errors.h}
          empty={hotList.length === 0} emptyText="No stuck parts-arrived jobs."
          footer={`Parts arrived ${HOT_DAYS_THRESHOLD}+ days ago, outreached, still unbooked`}
        >
          <ul className="text-sm divide-y divide-slate-100">
            {hotList.slice(0, 5).map((wo) => (
              <li key={wo.id} className="py-2 flex items-center justify-between gap-2">
                <Link href={`/jobs/${wo.id}`} className="min-w-0 flex-1 hover:text-rose-700">
                  <div className="font-medium text-slate-800 truncate">{wo.customer_name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    #{wo.work_order_number}{wo.appliance_type && ` · ${wo.appliance_type}`}
                  </div>
                </Link>
                <div className="text-right shrink-0">
                  <div className="text-xs font-medium text-rose-700">{daysAgo(wo.status_changed_at)}d</div>
                  <div className="text-[10px] text-slate-400">stuck · {wo.outreach_count}x out</div>
                </div>
              </li>
            ))}
          </ul>
          {hotList.length > 5 && <div className="text-xs text-slate-500 mt-2">+ {hotList.length - 5} more</div>}
        </BossTile>

        {/* Today's Schedule by Tech */}
        <BossTile
          title="Today's Schedule" icon={CalendarDays} accent="violet"
          count={todaySched.reduce((s, t) => s + t.appts.length, 0)}
          loading={loading.t} error={errors.t}
          empty={todaySched.length === 0} emptyText="No active technicians."
        >
          <ul className="text-sm divide-y divide-slate-100">
            {todaySched.map((t) => (
              <li key={t.tech_id} className="py-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-slate-800">{t.tech_name}</div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    {t.appts.length}/{t.max_daily}
                  </div>
                </div>
                {t.appts.length > 0 ? (
                  <div className="text-xs text-slate-500 mt-0.5 truncate">
                    First: {fmtTime(t.appts[0].start_time)} · {t.appts[0].customer_name}
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 italic mt-0.5">No appointments</div>
                )}
              </li>
            ))}
          </ul>
        </BossTile>

        {/* Outreach Pipeline */}
        <BossTile
          title="Outreach Pipeline" icon={MessageCircle} accent="amber"
          loading={loading.o} error={errors.o}
        >
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <div className="text-2xl font-bold text-slate-800 tabular-nums">{outreach.never}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Never outreached</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-700 tabular-nums">{outreach.cold}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Cold (no reply)</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-700 tabular-nums">{outreach.replied_unbooked}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Replied, unbooked</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-700 tabular-nums">{outreach.booked}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Booked</div>
            </div>
          </div>
        </BossTile>

        {/* Tech Capacity */}
        <BossTile
          title="Tech Capacity" icon={Gauge} accent="emerald"
          count={`${todayPct}%`} loading={loading.c} error={errors.c}
          empty={capacity.length === 0} emptyText="No active technicians."
          footer={`7-day rolling: ${totalWeekBooked} / ${totalWeekMax} (${weekPct}%)`}
        >
          <ul className="text-sm space-y-1.5">
            {capacity.map((r) => {
              const pct = r.today_max === 0 ? 0 : Math.round((r.today_booked / r.today_max) * 100);
              const barColor = pct >= 100 ? "bg-rose-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500";
              return (
                <li key={r.tech_id}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-700 font-medium truncate">{r.tech_name}</span>
                    <span className="text-slate-500 tabular-nums">{r.today_booked}/{r.today_max}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-0.5">
                    <div className={`h-full ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </BossTile>

        {/* Parts Pipeline */}
        <BossTile
          title="Parts Pipeline" icon={Package} accent="slate"
          loading={loading.p} error={errors.p}
        >
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <div className="text-2xl font-bold text-amber-700 tabular-nums">{parts.ordered_count}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Ordered</div>
              <div className="text-xs text-slate-500 mt-0.5">avg {parts.ordered_avg_days}d stuck</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-teal-700 tabular-nums">{parts.arrived_count}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Arrived</div>
              <div className="text-xs text-slate-500 mt-0.5">avg {parts.arrived_avg_days}d in shop</div>
            </div>
          </div>
        </BossTile>
      </div>

      <div className="mt-6 text-center text-xs text-slate-400">
        Phase 3 will add: Revenue, A/R aging, AI Quality Watchlist, Alt-Contact Handoffs, New WO Velocity by source.
      </div>
    </div>
  );
}
