"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Plus, Trash2, CalendarOff } from "lucide-react";
import { useRouter } from "next/navigation";

interface DayOff {
  id: number;
  technician_id: number | null;
  date_off: string;
  reason: string | null;
  tech_name?: string;
}

interface Holiday {
  id: number;
  holiday_date: string;
  name: string;
}

export default function DaysOffPage() {
  const router = useRouter();
  const { tenantUser } = useAuth();
  const [techs, setTechs] = useState<any[]>([]);
  const [daysOff, setDaysOff] = useState<DayOff[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Add form
  const [newTechId, setNewTechId] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newReason, setNewReason] = useState("");
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayName, setNewHolidayName] = useState("");

  const fetchData = useCallback(async () => {
    if (!tenantUser) return;
    const tid = tenantUser.tenant_id;
    const [techRes, daysRes, holRes] = await Promise.all([
      supabase.from("technicians").select("id, tech_name").eq("tenant_id", tid).eq("is_active", true).order("tech_name"),
      supabase.from("days_off").select("*, tech:technicians(tech_name)").eq("tenant_id", tid).order("date_off", { ascending: false }),
      supabase.from("tenant_holidays").select("*").eq("tenant_id", tid).order("holiday_date"),
    ]);
    if (techRes.data) setTechs(techRes.data);
    if (daysRes.data) setDaysOff(daysRes.data.map((d: any) => ({ ...d, tech_name: d.tech?.tech_name })));
    if (holRes.data) setHolidays(holRes.data);
    setIsLoading(false);
  }, [tenantUser]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const addDayOff = async () => {
    if (!newDate || !tenantUser) return;
    await supabase.from("days_off").insert({
      tenant_id: tenantUser.tenant_id,
      technician_id: newTechId ? parseInt(newTechId) : null,
      date_off: newDate,
      reason: newReason || null,
    });
    setNewTechId(""); setNewDate(""); setNewReason("");
    setSuccessMsg("Day off added");
    setTimeout(() => setSuccessMsg(""), 3000);
    await fetchData();
  };

  const deleteDayOff = async (id: number) => {
    await supabase.from("days_off").delete().eq("id", id);
    await fetchData();
  };

  const addHoliday = async () => {
    if (!newHolidayDate || !newHolidayName || !tenantUser) return;
    await supabase.from("tenant_holidays").insert({
      tenant_id: tenantUser.tenant_id,
      holiday_date: newHolidayDate,
      name: newHolidayName,
    });
    setNewHolidayDate(""); setNewHolidayName("");
    setSuccessMsg("Holiday added");
    setTimeout(() => setSuccessMsg(""), 3000);
    await fetchData();
  };

  const deleteHoliday = async (id: number) => {
    await supabase.from("tenant_holidays").delete().eq("id", id);
    await fetchData();
  };

  if (isLoading) return <div className="flex items-center justify-center py-24"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Days Off & Holidays</h1>
          <p className="text-sm text-gray-500">Manage technician time off and company holidays</p>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {successMsg && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{successMsg}</div>}

      {/* Add Day Off */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Tech Days Off</h2>
        <div className="flex gap-3 mb-4">
          <select value={newTechId} onChange={(e) => setNewTechId(e.target.value)} className="px-3 py-2 text-sm border border-gray-300 rounded-lg">
            <option value="">All techs (company-wide)</option>
            {techs.map((t) => <option key={t.id} value={t.id}>{t.tech_name}</option>)}
          </select>
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="px-3 py-2 text-sm border border-gray-300 rounded-lg" />
          <input type="text" value={newReason} onChange={(e) => setNewReason(e.target.value)} placeholder="Reason (optional)" className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg" />
          <button onClick={addDayOff} className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">
            <Plus size={14} /> Add
          </button>
        </div>

        {daysOff.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No days off scheduled</p>
        ) : (
          <div className="space-y-2">
            {daysOff.map((d) => (
              <div key={d.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {new Date(d.date_off + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                  </p>
                  <p className="text-xs text-gray-500">
                    {d.tech_name || "All technicians"}{d.reason ? ` — ${d.reason}` : ""}
                  </p>
                </div>
                <button onClick={() => deleteDayOff(d.id)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Holidays */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Company Holidays</h2>
        <div className="flex gap-3 mb-4">
          <input type="date" value={newHolidayDate} onChange={(e) => setNewHolidayDate(e.target.value)} className="px-3 py-2 text-sm border border-gray-300 rounded-lg" />
          <input type="text" value={newHolidayName} onChange={(e) => setNewHolidayName(e.target.value)} placeholder="Holiday name" className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg" />
          <button onClick={addHoliday} className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">
            <Plus size={14} /> Add
          </button>
        </div>

        {holidays.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No holidays set</p>
        ) : (
          <div className="space-y-2">
            {holidays.map((h) => (
              <div key={h.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-900">{h.name}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(h.holiday_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
                <button onClick={() => deleteHoliday(h.id)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
