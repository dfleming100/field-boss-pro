"use client";

import React, { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Clock,
  MapPin,
  AlertCircle,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────
interface Technician {
  id: number;
  tech_name: string;
}

interface Appointment {
  id: number;
  work_order_id: number;
  technician_id: number | null;
  appointment_date: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
  work_order?: {
    work_order_number: string;
    job_type: string;
    customer_id: number;
    status: string;
  };
  customer_name?: string;
  service_address?: string;
  city?: string;
}

interface PendingWO {
  id: number;
  work_order_number: string;
  customer_name: string;
  service_address: string;
  city: string;
  state: string;
  job_type: string;
  status: string;
}

type ViewMode = "day" | "week" | "month";

// ── Colors per technician ──────────────────────────────
const TECH_COLORS = [
  { bg: "bg-blue-50", border: "border-blue-300", text: "text-blue-800", header: "bg-blue-600", light: "bg-blue-100" },
  { bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-800", header: "bg-emerald-600", light: "bg-emerald-100" },
  { bg: "bg-purple-50", border: "border-purple-300", text: "text-purple-800", header: "bg-purple-600", light: "bg-purple-100" },
  { bg: "bg-orange-50", border: "border-orange-300", text: "text-orange-800", header: "bg-orange-600", light: "bg-orange-100" },
  { bg: "bg-pink-50", border: "border-pink-300", text: "text-pink-800", header: "bg-pink-600", light: "bg-pink-100" },
  { bg: "bg-teal-50", border: "border-teal-300", text: "text-teal-800", header: "bg-teal-600", light: "bg-teal-100" },
  { bg: "bg-amber-50", border: "border-amber-300", text: "text-amber-800", header: "bg-amber-600", light: "bg-amber-100" },
  { bg: "bg-rose-50", border: "border-rose-300", text: "text-rose-800", header: "bg-rose-600", light: "bg-rose-100" },
];

// ── Helpers ────────────────────────────────────────────
function dateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  r.setDate(r.getDate() - r.getDay());
  return r;
}

function formatTime(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 7); // 7am-6pm

// Assign side-by-side "lanes" so overlapping appts in the same tech column
// render beside each other instead of stacking on top.
function assignLanes(appts: Appointment[]) {
  const toMin = (t: string | null) => {
    if (!t) return 0;
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const items = appts
    .map((a) => ({
      appt: a,
      start: toMin(a.start_time),
      end: a.end_time ? toMin(a.end_time) : toMin(a.start_time) + 120,
      lane: -1,
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const laneEnd: number[] = [];
  for (const it of items) {
    let placed = false;
    for (let l = 0; l < laneEnd.length; l++) {
      if (laneEnd[l] <= it.start) {
        it.lane = l;
        laneEnd[l] = it.end;
        placed = true;
        break;
      }
    }
    if (!placed) {
      it.lane = laneEnd.length;
      laneEnd.push(it.end);
    }
  }

  // Find transitive overlap clusters so each appt knows how many lanes its
  // cluster needs (width = 1 / clusterLanes).
  const cluster: number[] = new Array(items.length).fill(-1);
  let next = 0;
  for (let i = 0; i < items.length; i++) {
    if (cluster[i] !== -1) continue;
    cluster[i] = next;
    const q = [i];
    while (q.length) {
      const c = q.shift()!;
      for (let j = 0; j < items.length; j++) {
        if (cluster[j] !== -1) continue;
        if (items[j].start < items[c].end && items[c].start < items[j].end) {
          cluster[j] = next;
          q.push(j);
        }
      }
    }
    next++;
  }
  const clusterLanes = new Array(next).fill(0);
  for (let i = 0; i < items.length; i++) {
    if (items[i].lane + 1 > clusterLanes[cluster[i]]) {
      clusterLanes[cluster[i]] = items[i].lane + 1;
    }
  }

  return items.map((it, i) => ({
    appt: it.appt,
    lane: it.lane,
    totalLanes: clusterLanes[cluster[i]],
  }));
}

// ── Component ──────────────────────────────────────────
function SchedulingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenantUser } = useAuth();

  const initialDate = searchParams.get("date") || dateStr(new Date());
  const [currentDate, setCurrentDate] = useState(new Date(initialDate + "T12:00:00"));
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [pendingWOs, setPendingWOs] = useState<PendingWO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTechIds, setSelectedTechIds] = useState<Set<number> | null>(null);

  // Date range for fetching
  const dateRange = useMemo(() => {
    if (viewMode === "day") {
      return { start: dateStr(currentDate), end: dateStr(currentDate) };
    } else if (viewMode === "week") {
      const s = startOfWeek(currentDate);
      return { start: dateStr(s), end: dateStr(addDays(s, 6)) };
    } else {
      const y = currentDate.getFullYear();
      const m = currentDate.getMonth();
      return {
        start: dateStr(new Date(y, m, 1)),
        end: dateStr(new Date(y, m + 1, 0)),
      };
    }
  }, [currentDate, viewMode]);

  const fetchData = useCallback(async () => {
    if (!tenantUser) return;
    setIsLoading(true);

    const [techRes, apptRes, woRes] = await Promise.all([
      supabase
        .from("technicians")
        .select("id, tech_name")
        .eq("tenant_id", tenantUser.tenant_id)
        .eq("is_active", true)
        .order("tech_name"),
      supabase
        .from("appointments")
        .select(`
          *,
          work_order:work_orders(work_order_number, job_type, customer_id, status),
          customer:work_orders!inner(customer:customers(customer_name, service_address, city))
        `)
        .eq("tenant_id", tenantUser.tenant_id)
        .eq("status", "scheduled")
        .gte("appointment_date", dateRange.start)
        .lte("appointment_date", dateRange.end)
        .order("start_time"),
      supabase
        .from("work_orders")
        .select(`*, customer:customers(customer_name, service_address, city, state)`)
        .eq("tenant_id", tenantUser.tenant_id)
        .in("status", ["New", "Parts Ordered", "Parts Have Arrived"])
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (techRes.data) {
      setTechnicians(techRes.data);
      setSelectedTechIds((prev) => prev ?? new Set(techRes.data.map((t: Technician) => t.id)));
    }
    if (apptRes.data) {
      const enriched = apptRes.data.map((a: any) => ({
        ...a,
        customer_name: a.customer?.customer?.customer_name,
        service_address: a.customer?.customer?.service_address,
        city: a.customer?.customer?.city,
      }));
      setAppointments(enriched);
    }
    if (woRes.data) {
      const pending = woRes.data.map((wo: any) => ({
        id: wo.id,
        work_order_number: wo.work_order_number,
        customer_name: wo.customer?.customer_name || "—",
        service_address: wo.customer?.service_address || "",
        city: wo.customer?.city || "",
        state: wo.customer?.state || "",
        job_type: wo.job_type,
        status: wo.status,
      }));
      setPendingWOs(pending);
    }

    setIsLoading(false);
  }, [tenantUser, dateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const techColorMap = useMemo(() => {
    const m: Record<number, typeof TECH_COLORS[0]> = {};
    technicians.forEach((t, i) => {
      m[t.id] = TECH_COLORS[i % TECH_COLORS.length];
    });
    return m;
  }, [technicians]);

  const visibleTechnicians = useMemo(
    () => (selectedTechIds ? technicians.filter((t) => selectedTechIds.has(t.id)) : technicians),
    [technicians, selectedTechIds]
  );

  const visibleAppointments = useMemo(
    () =>
      selectedTechIds
        ? appointments.filter(
            (a) => a.technician_id === null || selectedTechIds.has(a.technician_id)
          )
        : appointments,
    [appointments, selectedTechIds]
  );

  const toggleTech = (id: number) => {
    setSelectedTechIds((prev) => {
      const next = new Set(prev ?? technicians.map((t) => t.id));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllTechs = () =>
    setSelectedTechIds(new Set(technicians.map((t) => t.id)));

  // Navigation
  const navigate = (dir: number) => {
    if (viewMode === "day") setCurrentDate(addDays(currentDate, dir));
    else if (viewMode === "week") setCurrentDate(addDays(currentDate, dir * 7));
    else {
      const d = new Date(currentDate);
      d.setMonth(d.getMonth() + dir);
      setCurrentDate(d);
    }
  };

  const goToday = () => setCurrentDate(new Date());

  const dateLabel = () => {
    if (viewMode === "day") {
      return currentDate.toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
      });
    } else if (viewMode === "week") {
      const s = startOfWeek(currentDate);
      const e = addDays(s, 6);
      return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} — ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    } else {
      return currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
  };

  // Get appointments for a specific tech on a specific date
  const getAppts = (techId: number, date: string) =>
    appointments.filter(
      (a) => a.technician_id === techId && a.appointment_date === date
    );

  // Get hour position for an appointment
  const getTimeSlot = (time: string | null): number => {
    if (!time) return 9;
    return parseInt(time.split(":")[0]);
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
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Scheduling</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {visibleTechnicians.length} of {technicians.length} tech
            {technicians.length !== 1 ? "s" : ""} &middot;{" "}
            {visibleAppointments.length} appointment
            {visibleAppointments.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-1">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md capitalize transition ${
                  viewMode === v
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tech Filter */}
      {technicians.length > 0 && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Techs:</span>
          <button
            onClick={selectAllTechs}
            className={`px-3 py-1 text-xs font-medium rounded-full border transition ${
              selectedTechIds && selectedTechIds.size === technicians.length
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
            }`}
          >
            All
          </button>
          {technicians.map((tech) => {
            const isOn = selectedTechIds?.has(tech.id) ?? true;
            const color = techColorMap[tech.id];
            return (
              <button
                key={tech.id}
                onClick={() => toggleTech(tech.id)}
                className={`px-3 py-1 text-xs font-medium rounded-full border flex items-center gap-1.5 transition ${
                  isOn
                    ? `${color.header} text-white border-transparent`
                    : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${isOn ? "bg-white/90" : color.header}`}
                />
                {tech.tech_name}
              </button>
            );
          })}
        </div>
      )}

      {/* Date Navigation */}
      <div className="flex items-center justify-between mb-4 bg-white rounded-xl border border-gray-200 px-4 py-3">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 hover:bg-gray-100 rounded-lg transition"
        >
          <ChevronLeft size={20} className="text-gray-600" />
        </button>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900">{dateLabel()}</h2>
          <button
            onClick={goToday}
            className="px-3 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-full hover:bg-indigo-100"
          >
            Today
          </button>
        </div>
        <button
          onClick={() => navigate(1)}
          className="p-1.5 hover:bg-gray-100 rounded-lg transition"
        >
          <ChevronRight size={20} className="text-gray-600" />
        </button>
      </div>

      {/* Pending Work Orders */}
      {pendingWOs.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle size={16} className="text-orange-500" />
            <h3 className="text-sm font-semibold text-gray-700">
              Pending Work Orders ({pendingWOs.length})
            </h3>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {pendingWOs.map((wo) => (
              <Link
                key={wo.id}
                href={`/work-orders/${wo.id}`}
                className="flex-shrink-0 w-56 bg-orange-50 border border-orange-200 rounded-lg p-3 hover:border-orange-300 hover:shadow-sm transition"
              >
                <p className="text-xs font-semibold text-orange-700">
                  {wo.work_order_number}
                </p>
                <p className="text-sm font-medium text-gray-900 mt-1 truncate">
                  {wo.customer_name}
                </p>
                <p className="text-xs text-gray-500 truncate mt-0.5">
                  {wo.service_address}{wo.city ? `, ${wo.city}` : ""}
                </p>
                <p className="text-xs text-gray-400 mt-1 capitalize">
                  {wo.job_type} &middot; {wo.status.replace(/_/g, " ")}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── DAY VIEW ── */}
      {viewMode === "day" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {visibleTechnicians.length === 0 ? (
            <div className="p-12 text-center">
              <CalendarDays size={48} className="text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">
                {technicians.length === 0
                  ? "Add technicians to see the schedule."
                  : "No techs selected — pick at least one above."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[800px]">
                {/* Tech header columns */}
                <div className="flex border-b border-gray-200">
                  <div className="w-20 flex-shrink-0 bg-gray-50 border-r border-gray-200" />
                  {visibleTechnicians.map((tech) => {
                    const color = techColorMap[tech.id];
                    return (
                      <div
                        key={tech.id}
                        className="flex-1 min-w-[180px] border-r border-gray-200 last:border-r-0"
                      >
                        <div className={`${color.header} px-3 py-2.5 text-center`}>
                          <p className="text-sm font-semibold text-white truncate">
                            {tech.tech_name}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Time grid with spanning appointments */}
                <div className="flex">
                  {/* Time labels column */}
                  <div className="w-20 flex-shrink-0">
                    {HOURS.map((hour) => (
                      <div key={hour} className="h-[60px] border-b border-gray-100 border-r border-gray-200 bg-gray-50 px-2 py-1 text-right">
                        <span className="text-xs text-gray-400">
                          {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Tech columns with positioned appointments */}
                  {visibleTechnicians.map((tech) => {
                    const color = techColorMap[tech.id];
                    const techAppts = getAppts(tech.id, dateStr(currentDate));
                    const laneData = assignLanes(techAppts);

                    return (
                      <div
                        key={tech.id}
                        className="flex-1 min-w-[180px] border-r border-gray-100 last:border-r-0 relative"
                      >
                        {/* Hour grid lines */}
                        {HOURS.map((hour) => (
                          <div key={hour} className="h-[60px] border-b border-gray-100" />
                        ))}

                        {/* Appointment cards — side-by-side lanes for overlaps */}
                        {laneData.map(({ appt, lane, totalLanes }) => {
                          const startHour = getTimeSlot(appt.start_time);
                          const startMin = appt.start_time ? parseInt(appt.start_time.split(":")[1] || "0") : 0;
                          const endHour = appt.end_time ? parseInt(appt.end_time.split(":")[0] || "0") : startHour + 2;
                          const endMin = appt.end_time ? parseInt(appt.end_time.split(":")[1] || "0") : 0;

                          const topPx = (startHour - HOURS[0]) * 60 + startMin;
                          const heightPx = Math.max((endHour - startHour) * 60 + (endMin - startMin), 30);
                          const widthPct = 100 / totalLanes;
                          const leftPct = lane * widthPct;
                          const isNarrow = totalLanes > 1;

                          return (
                            <button
                              key={appt.id}
                              onClick={() => router.push(`/work-orders/${appt.work_order_id}`)}
                              className={`absolute ${color.bg} border ${color.border} rounded-lg p-1.5 hover:shadow-md hover:z-20 transition overflow-hidden z-10 text-left`}
                              style={{
                                top: `${topPx}px`,
                                height: `${heightPx}px`,
                                left: `calc(${leftPct}% + 2px)`,
                                width: `calc(${widthPct}% - 4px)`,
                              }}
                              title={`${appt.work_order?.work_order_number || ""} — ${appt.customer_name || ""}\n${appt.service_address || ""}${appt.city ? ", " + appt.city : ""}\n${formatTime(appt.start_time)}${appt.end_time ? " - " + formatTime(appt.end_time) : ""}`}
                            >
                              <p className={`${isNarrow ? "text-[10px]" : "text-xs"} font-semibold ${color.text} truncate`}>
                                {appt.work_order?.work_order_number || `WO-${appt.work_order_id}`}
                              </p>
                              <p className={`${isNarrow ? "text-[10px]" : "text-xs"} font-medium text-gray-900 truncate`}>
                                {appt.customer_name || "Customer"}
                              </p>
                              {heightPx > 50 && appt.service_address && (
                                <p className="text-[10px] text-gray-500 truncate">
                                  {appt.service_address}
                                </p>
                              )}
                              {heightPx > 70 && (
                                <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                                  {formatTime(appt.start_time)}
                                  {appt.end_time && ` - ${formatTime(appt.end_time)}`}
                                </p>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── WEEK VIEW ── */}
      {viewMode === "week" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              {/* Day headers */}
              <div className="grid grid-cols-7 border-b border-gray-200">
                {Array.from({ length: 7 }, (_, i) => {
                  const day = addDays(startOfWeek(currentDate), i);
                  const isToday = dateStr(day) === dateStr(new Date());
                  return (
                    <div
                      key={i}
                      className={`text-center py-3 border-r border-gray-200 last:border-r-0 ${
                        isToday ? "bg-indigo-50" : "bg-gray-50"
                      }`}
                    >
                      <p className="text-xs text-gray-500 uppercase">
                        {day.toLocaleDateString("en-US", { weekday: "short" })}
                      </p>
                      <p
                        className={`text-lg font-semibold mt-0.5 ${
                          isToday ? "text-indigo-600" : "text-gray-900"
                        }`}
                      >
                        {day.getDate()}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Week grid */}
              <div className="grid grid-cols-7 min-h-[400px]">
                {Array.from({ length: 7 }, (_, i) => {
                  const day = addDays(startOfWeek(currentDate), i);
                  const ds = dateStr(day);
                  const dayAppts = visibleAppointments.filter(
                    (a) => a.appointment_date === ds
                  );
                  const isToday = ds === dateStr(new Date());

                  return (
                    <div
                      key={i}
                      className={`border-r border-gray-100 last:border-r-0 p-2 ${
                        isToday ? "bg-indigo-50/30" : ""
                      }`}
                    >
                      {dayAppts.length === 0 && (
                        <p className="text-xs text-gray-300 text-center mt-4">
                          No appts
                        </p>
                      )}
                      {dayAppts.map((appt) => {
                        const color = appt.technician_id
                          ? techColorMap[appt.technician_id] || TECH_COLORS[0]
                          : TECH_COLORS[0];
                        return (
                          <button
                            key={appt.id}
                            onClick={() =>
                              router.push(`/work-orders/${appt.work_order_id}`)
                            }
                            className={`w-full text-left ${color.bg} border ${color.border} rounded-lg p-2 mb-2 hover:shadow-md transition`}
                          >
                            <p className={`text-[11px] font-bold ${color.text}`}>
                              {appt.work_order?.work_order_number || "WO"}
                            </p>
                            <p className="text-xs font-medium text-gray-900 truncate">
                              {appt.customer_name || "Customer"}
                            </p>
                            <p className="text-[11px] text-gray-500">
                              {formatTime(appt.start_time)}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MONTH VIEW ── */}
      {viewMode === "month" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div
                key={d}
                className="text-center py-2 text-xs font-semibold text-gray-500 uppercase"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7">
            {(() => {
              const y = currentDate.getFullYear();
              const m = currentDate.getMonth();
              const firstDay = new Date(y, m, 1).getDay();
              const daysInMonth = new Date(y, m + 1, 0).getDate();
              const cells = [];

              // Empty cells before first day
              for (let i = 0; i < firstDay; i++) {
                cells.push(
                  <div
                    key={`empty-${i}`}
                    className="min-h-[80px] border-r border-b border-gray-100 bg-gray-50/50"
                  />
                );
              }

              // Days
              for (let d = 1; d <= daysInMonth; d++) {
                const ds = dateStr(new Date(y, m, d));
                const isToday = ds === dateStr(new Date());
                const dayAppts = visibleAppointments.filter(
                  (a) => a.appointment_date === ds
                );

                cells.push(
                  <div
                    key={d}
                    className={`min-h-[80px] border-r border-b border-gray-100 p-1 ${
                      isToday ? "bg-indigo-50/40" : ""
                    }`}
                  >
                    <p
                      className={`text-xs font-medium mb-1 px-1 ${
                        isToday
                          ? "text-indigo-600 font-bold"
                          : "text-gray-500"
                      }`}
                    >
                      {d}
                    </p>
                    {dayAppts.slice(0, 3).map((appt) => {
                      const color = appt.technician_id
                        ? techColorMap[appt.technician_id] || TECH_COLORS[0]
                        : TECH_COLORS[0];
                      return (
                        <button
                          key={appt.id}
                          onClick={() =>
                            router.push(`/work-orders/${appt.work_order_id}`)
                          }
                          className={`w-full text-left ${color.light} rounded px-1.5 py-0.5 mb-0.5 truncate hover:opacity-80`}
                        >
                          <span className={`text-[10px] font-medium ${color.text}`}>
                            {appt.customer_name || appt.work_order?.work_order_number || "Appt"}
                          </span>
                        </button>
                      );
                    })}
                    {dayAppts.length > 3 && (
                      <p className="text-[10px] text-gray-400 px-1">
                        +{dayAppts.length - 3} more
                      </p>
                    )}
                  </div>
                );
              }

              return cells;
            })()}
          </div>
        </div>
      )}

      {/* Tech color legend */}
      {technicians.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          {technicians.map((tech) => {
            const color = techColorMap[tech.id];
            return (
              <div key={tech.id} className="flex items-center gap-1.5">
                <span className={`w-3 h-3 rounded-full ${color.header}`} />
                <span className="text-xs text-gray-600">{tech.tech_name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function SchedulingPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="text-sm text-gray-500">Loading...</div></div>}>
      <SchedulingContent />
    </Suspense>
  );
}
