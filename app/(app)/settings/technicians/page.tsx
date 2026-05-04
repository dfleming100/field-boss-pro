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
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newTechPhone, setNewTechPhone] = useState("");
  const [newTechEmail, setNewTechEmail] = useState("");
  const [newTechPassword, setNewTechPassword] = useState("");
  const [addTechError, setAddTechError] = useState("");
  const [addTechSaving, setAddTechSaving] = useState(false);

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

  // Cycle: off → primary (1) → secondary (2) → off
  const toggleSkill = (techId: number, appliance: string) => {
    const newSkills = { ...skills };
    if (!newSkills[techId]) newSkills[techId] = {};
    const current = newSkills[techId][appliance];
    if (!current) newSkills[techId][appliance] = 1;
    else if (current === 1) newSkills[techId][appliance] = 2;
    else delete newSkills[techId][appliance];
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
    setAddTechError("");
    if (!tenantUser) return;
    if (!newFirstName.trim() || !newLastName.trim() || !newTechEmail.trim() || !newTechPassword) {
      setAddTechError("First name, last name, email, and password are required");
      return;
    }
    if (newTechPassword.length < 8) {
      setAddTechError("Password must be at least 8 characters");
      return;
    }
    setAddTechSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setAddTechError("Session expired — sign in again");
        return;
      }
      const res = await fetch("/api/admin/techs/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          tenant_id: tenantUser.tenant_id,
          first_name: newFirstName.trim(),
          last_name: newLastName.trim(),
          email: newTechEmail.trim(),
          password: newTechPassword,
          phone: newTechPhone || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setAddTechError(data.error || "Failed to create technician");
        return;
      }
      setShowAddTech(false);
      setNewFirstName(""); setNewLastName(""); setNewTechPhone(""); setNewTechEmail(""); setNewTechPassword("");
      await fetchData();
    } finally {
      setAddTechSaving(false);
    }
  };

  const deleteTech = async (techId: number, name: string) => {
    if (!window.confirm(`Delete ${name}? Their login access will be removed and they will no longer appear on the team.`)) return;
    if (!tenantUser) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setError("Session expired — sign in again");
      return;
    }
    const res = await fetch("/api/admin/techs/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ tenant_id: tenantUser.tenant_id, technician_id: techId }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setError(data.error || "Failed to delete technician");
      return;
    }
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
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Skill Assignment</h2>
          <p className="text-xs text-gray-500 mb-4">
            Click a cell to cycle: <span className="font-medium">empty</span> →{" "}
            <span className="inline-block w-5 h-5 rounded text-[10px] font-bold text-white bg-indigo-600 text-center leading-5">1</span>{" "}
            (primary specialty) →{" "}
            <span className="inline-block w-5 h-5 rounded text-[10px] font-bold text-indigo-700 bg-indigo-100 border border-indigo-200 text-center leading-5">2</span>{" "}
            (also able to do) → empty. The scheduler picks the tech with the lowest priority sum across all appliances on a WO.
          </p>
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
                  {techs.map((tech) => {
                    const priority = skills[tech.id]?.[appliance];
                    let cellClass = "w-7 h-7 rounded-md text-xs font-bold border transition-all ";
                    let label = "";
                    if (priority === 1) {
                      cellClass += "bg-indigo-600 border-indigo-600 text-white";
                      label = "1";
                    } else if (priority === 2) {
                      cellClass += "bg-indigo-100 border-indigo-200 text-indigo-700";
                      label = "2";
                    } else {
                      cellClass += "bg-white border-gray-300 text-gray-400 hover:border-indigo-300";
                      label = "";
                    }
                    return (
                      <td key={tech.id} className="text-center py-2.5 px-3">
                        <button
                          type="button"
                          onClick={() => toggleSkill(tech.id, appliance)}
                          className={cellClass}
                          title={priority === 1 ? "Primary specialty" : priority === 2 ? "Can also do" : "Click to assign"}
                        >
                          {label}
                        </button>
                      </td>
                    );
                  })}
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
              <button onClick={() => { setShowAddTech(false); setAddTechError(""); }} className="p-1 text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-gray-500">
                Creates a login for this technician. They sign in with the email and password you set here.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First name *</label>
                  <input type="text" value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="John" autoFocus />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last name *</label>
                  <input type="text" value={newLastName} onChange={(e) => setNewLastName(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="Smith" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                <input type="email" value={newTechEmail} onChange={(e) => setNewTechEmail(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="john@example.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
                <input type="text" value={newTechPassword} onChange={(e) => setNewTechPassword(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono" placeholder="At least 8 characters" />
                <p className="text-xs text-gray-400 mt-1">Share this password securely with the tech — they can change it later in Settings.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input type="tel" value={newTechPhone} onChange={(e) => setNewTechPhone(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
              </div>
              {addTechError && (
                <div className="bg-red-50 border border-red-200 rounded p-2.5 text-sm text-red-700">{addTechError}</div>
              )}
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-gray-200">
              <button onClick={() => { setShowAddTech(false); setAddTechError(""); }} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={addTech} disabled={addTechSaving} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">{addTechSaving ? "Creating…" : "Add Technician"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
