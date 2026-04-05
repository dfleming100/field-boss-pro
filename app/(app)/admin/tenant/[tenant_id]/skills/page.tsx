"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Save, Wrench } from "lucide-react";

const APPLIANCE_TYPES = [
  "Refrigerator", "Washer", "Dryer", "Dishwasher", "Cooktop", "Oven",
  "Range", "Microwave", "Freezer", "Ice Maker", "Garbage Disposal",
  "Range Hood", "Wine Cooler", "Other",
];

interface Tech {
  id: number;
  tech_name: string;
  max_daily_appointments: number;
  max_daily_repairs: number;
}

interface SkillMap {
  [techId: number]: { [appliance: string]: number }; // appliance → priority
}

export default function SkillsPage() {
  const router = useRouter();
  const params = useParams();
  const tenantId = params.tenant_id as string;

  const [tenant, setTenant] = useState<any>(null);
  const [techs, setTechs] = useState<Tech[]>([]);
  const [skills, setSkills] = useState<SkillMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const fetchData = useCallback(async () => {
    const [tenantRes, techRes, skillRes] = await Promise.all([
      supabase.from("tenants").select("name").eq("id", tenantId).single(),
      supabase.from("technicians").select("id, tech_name, max_daily_appointments, max_daily_repairs").eq("tenant_id", tenantId).eq("is_active", true).order("tech_name"),
      supabase.from("tech_skills").select("*").eq("tenant_id", tenantId),
    ]);

    if (tenantRes.data) setTenant(tenantRes.data);
    if (techRes.data) setTechs(techRes.data);

    // Build skill map
    const map: SkillMap = {};
    for (const s of skillRes.data || []) {
      if (!map[s.technician_id]) map[s.technician_id] = {};
      map[s.technician_id][s.appliance_type] = s.priority;
    }
    setSkills(map);
    setIsLoading(false);
  }, [tenantId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleSkill = (techId: number, appliance: string) => {
    const newSkills = { ...skills };
    if (!newSkills[techId]) newSkills[techId] = {};
    if (newSkills[techId][appliance]) {
      delete newSkills[techId][appliance];
    } else {
      newSkills[techId][appliance] = 1;
    }
    setSkills(newSkills);
  };

  const setPriority = (techId: number, appliance: string, priority: number) => {
    const newSkills = { ...skills };
    if (!newSkills[techId]) newSkills[techId] = {};
    newSkills[techId][appliance] = priority;
    setSkills(newSkills);
  };

  const updateCapacity = async (techId: number, field: string, value: number) => {
    await supabase.from("technicians").update({ [field]: value }).eq("id", techId);
    setTechs(techs.map((t) => t.id === techId ? { ...t, [field]: value } : t));
  };

  const saveSkills = async () => {
    setIsSaving(true);
    setError("");
    try {
      // Delete all existing skills for this tenant
      await supabase.from("tech_skills").delete().eq("tenant_id", tenantId);

      // Insert current skills
      const rows: any[] = [];
      for (const [techId, applianceMap] of Object.entries(skills)) {
        for (const [appliance, priority] of Object.entries(applianceMap)) {
          rows.push({
            tenant_id: parseInt(tenantId),
            technician_id: parseInt(techId),
            appliance_type: appliance,
            priority,
          });
        }
      }

      if (rows.length > 0) {
        await supabase.from("tech_skills").insert(rows);
      }

      setSuccessMsg("Skills saved");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-24"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tech Skills & Capacity</h1>
            <p className="text-sm text-gray-500">{tenant?.name} — assign appliance types to technicians</p>
          </div>
        </div>
        <button onClick={saveSkills} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
          <Save size={14} /> {isSaving ? "Saving..." : "Save Skills"}
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {successMsg && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{successMsg}</div>}

      {techs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Wrench size={48} className="text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">Add technicians first before configuring skills.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Capacity Settings */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Daily Capacity</h2>
            <div className="space-y-3">
              {techs.map((tech) => (
                <div key={tech.id} className="flex items-center gap-4">
                  <span className="text-sm font-medium text-gray-900 w-32">{tech.tech_name}</span>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500">Max Appts/Day:</label>
                    <input
                      type="number"
                      value={tech.max_daily_appointments}
                      onChange={(e) => updateCapacity(tech.id, "max_daily_appointments", parseInt(e.target.value) || 12)}
                      className="w-16 px-2 py-1 text-sm border border-gray-300 rounded-lg text-center"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500">Max Repairs/Day:</label>
                    <input
                      type="number"
                      value={tech.max_daily_repairs}
                      onChange={(e) => updateCapacity(tech.id, "max_daily_repairs", parseInt(e.target.value) || 6)}
                      className="w-16 px-2 py-1 text-sm border border-gray-300 rounded-lg text-center"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Skills Matrix */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 overflow-x-auto">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Skill Assignment</h2>
            <p className="text-sm text-gray-500 mb-4">Check the appliance types each tech can handle. Priority 1 = preferred tech for that appliance.</p>
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase">Appliance</th>
                  {techs.map((t) => (
                    <th key={t.id} className="text-center py-2 text-xs font-semibold text-gray-500 uppercase px-3">
                      {t.tech_name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {APPLIANCE_TYPES.map((appliance) => (
                  <tr key={appliance} className="hover:bg-gray-50">
                    <td className="py-2.5 text-sm text-gray-900">{appliance}</td>
                    {techs.map((tech) => {
                      const hasSkill = skills[tech.id]?.[appliance];
                      return (
                        <td key={tech.id} className="text-center py-2.5 px-3">
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="checkbox"
                              checked={!!hasSkill}
                              onChange={() => toggleSkill(tech.id, appliance)}
                              className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                            />
                            {hasSkill && (
                              <select
                                value={hasSkill}
                                onChange={(e) => setPriority(tech.id, appliance, parseInt(e.target.value))}
                                className="w-12 px-1 py-0.5 text-xs border border-gray-300 rounded"
                              >
                                <option value={1}>P1</option>
                                <option value={2}>P2</option>
                                <option value={3}>P3</option>
                              </select>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
