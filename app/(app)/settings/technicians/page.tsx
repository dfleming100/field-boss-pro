"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Save, Wrench, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";

const APPLIANCE_TYPES = [
  "Cooktop", "Dishwasher", "Dryer", "Microwave", "Oven", "Range", "Washer",
  "Refrigerator", "Freezer", "Ice Maker", "Garbage Disposal", "Range Hood", "Wine Cooler", "Other",
];

interface Tech {
  id: number;
  tech_name: string;
  phone: string | null;
  email: string | null;
  max_daily_appointments: number;
  max_daily_repairs: number;
}

interface SkillMap {
  [techId: number]: { [appliance: string]: number };
}

export default function TechSettingsPage() {
  const router = useRouter();
  const { tenantUser } = useAuth();
  const [techs, setTechs] = useState<Tech[]>([]);
  const [skills, setSkills] = useState<SkillMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showAddTech, setShowAddTech] = useState(false);
  const [newTechName, setNewTechName] = useState("");
  const [newTechPhone, setNewTechPhone] = useState("");
  const [newTechEmail, setNewTechEmail] = useState("");

  const fetchData = useCallback(async () => {
    if (!tenantUser) return;
    const tid = tenantUser.tenant_id;
    const [techRes, skillRes] = await Promise.all([
      supabase.from("technicians").select("id, tech_name, phone, email, max_daily_appointments, max_daily_repairs").eq("tenant_id", tid).eq("is_active", true).order("tech_name"),
      supabase.from("tech_skills").select("*").eq("tenant_id", tid),
    ]);
    if (techRes.data) setTechs(techRes.data);
    const map: SkillMap = {};
    for (const s of skillRes.data || []) {
      if (!map[s.technician_id]) map[s.technician_id] = {};
      map[s.technician_id][s.appliance_type] = s.priority;
    }
    setSkills(map);
    setIsLoading(false);
  }, [tenantUser]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleSkill = (techId: number, appliance: string) => {
    const newSkills = { ...skills };
    if (!newSkills[techId]) newSkills[techId] = {};
    if (newSkills[techId][appliance]) delete newSkills[techId][appliance];
    else newSkills[techId][appliance] = 1;
    setSkills(newSkills);
  };

  const updateCapacity = async (techId: number, field: string, value: number) => {
    await supabase.from("technicians").update({ [field]: value }).eq("id", techId);
    setTechs(techs.map((t) => t.id === techId ? { ...t, [field]: value } : t));
  };

  const saveSkills = async () => {
    if (!tenantUser) return;
    setIsSaving(true);
    setError("");
    try {
      await supabase.from("tech_skills").delete().eq("tenant_id", tenantUser.tenant_id);
      const rows: any[] = [];
      for (const [techId, appMap] of Object.entries(skills)) {
        for (const [appliance, priority] of Object.entries(appMap)) {
          rows.push({ tenant_id: tenantUser.tenant_id, technician_id: parseInt(techId), appliance_type: appliance, priority });
        }
      }
      if (rows.length > 0) await supabase.from("tech_skills").insert(rows);
      setSuccessMsg("Skills saved");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const addTech = async () => {
    if (!newTechName.trim() || !tenantUser) return;
    await supabase.from("technicians").insert({
      tenant_id: tenantUser.tenant_id, tech_name: newTechName.trim(),
      phone: newTechPhone || null, email: newTechEmail || null,
      is_active: true, max_daily_appointments: 12, max_daily_repairs: 6,
    });
    setShowAddTech(false);
    setNewTechName(""); setNewTechPhone(""); setNewTechEmail("");
    await fetchData();
  };

  const deleteTech = async (techId: number, name: string) => {
    if (!window.confirm(`Delete ${name}?`)) return;
    await supabase.from("tech_skills").delete().eq("technician_id", techId);
    await supabase.from("technicians").update({ is_active: false }).eq("id", techId);
    await fetchData();
  };

  if (isLoading) return <div className="flex items-center justify-center py-24"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Technicians & Skills</h1>
            <p className="text-sm text-gray-500">Manage technicians, skills, and capacity</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAddTech(true)} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100">
            <Plus size={14} /> Add Tech
          </button>
          <button onClick={saveSkills} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            <Save size={14} /> {isSaving ? "Saving..." : "Save Skills"}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {successMsg && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{successMsg}</div>}

      {/* Capacity */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Daily Capacity</h2>
        <div className="space-y-3">
          {techs.map((tech) => (
            <div key={tech.id} className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-900 w-32">{tech.tech_name}</span>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Max Appts:</label>
                <input type="number" value={tech.max_daily_appointments} onChange={(e) => updateCapacity(tech.id, "max_daily_appointments", parseInt(e.target.value) || 12)} className="w-16 px-2 py-1 text-sm border border-gray-300 rounded-lg text-center" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Max Repairs:</label>
                <input type="number" value={tech.max_daily_repairs} onChange={(e) => updateCapacity(tech.id, "max_daily_repairs", parseInt(e.target.value) || 6)} className="w-16 px-2 py-1 text-sm border border-gray-300 rounded-lg text-center" />
              </div>
              <button onClick={() => deleteTech(tech.id, tech.tech_name)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg ml-auto" title="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {techs.length === 0 && <p className="text-sm text-gray-400">No technicians. Click "Add Tech" to get started.</p>}
        </div>
      </div>

      {/* Skills Matrix */}
      {techs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 overflow-x-auto">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Skill Assignment</h2>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase">Appliance</th>
                {techs.map((t) => (
                  <th key={t.id} className="text-center py-2 text-xs font-semibold text-gray-500 uppercase px-3">{t.tech_name}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {APPLIANCE_TYPES.map((appliance) => (
                <tr key={appliance} className="hover:bg-gray-50">
                  <td className="py-2.5 text-sm text-gray-900">{appliance}</td>
                  {techs.map((tech) => (
                    <td key={tech.id} className="text-center py-2.5 px-3">
                      <input type="checkbox" checked={!!skills[tech.id]?.[appliance]} onChange={() => toggleSkill(tech.id, appliance)} className="w-4 h-4 rounded border-gray-300 text-indigo-600" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Tech Modal */}
      {showAddTech && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Add Technician</h3>
              <button onClick={() => setShowAddTech(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input type="text" value={newTechName} onChange={(e) => setNewTechName(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="John Smith" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input type="tel" value={newTechPhone} onChange={(e) => setNewTechPhone(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input type="email" value={newTechEmail} onChange={(e) => setNewTechEmail(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-gray-200">
              <button onClick={() => setShowAddTech(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={addTech} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">Add Technician</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
