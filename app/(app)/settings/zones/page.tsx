"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Plus, Trash2, Save, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";

interface Zone {
  id: number | string;
  zone_name: string;
  zip_codes: string[];
  window_start: string;
  window_end: string;
  sort_order: number;
  is_active: boolean;
  isNew?: boolean;
}

export default function ZoneSettingsPage() {
  const router = useRouter();
  const { tenantUser } = useAuth();
  const [zones, setZones] = useState<Zone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const fetchData = useCallback(async () => {
    if (!tenantUser) return;
    const { data } = await supabase.from("service_zones").select("*").eq("tenant_id", tenantUser.tenant_id).order("sort_order");
    if (data) setZones(data);
    setIsLoading(false);
  }, [tenantUser]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const addZone = () => {
    setZones([...zones, { id: `new-${Date.now()}`, zone_name: "", zip_codes: [], window_start: "9:00am", window_end: "12:00pm", sort_order: zones.length + 1, is_active: true, isNew: true }]);
  };

  const [zipInputs, setZipInputs] = useState<Record<string, string>>({});

  const updateZone = (id: number | string, field: string, value: any) => {
    setZones(zones.map((z) => z.id === id ? { ...z, [field]: value } : z));
  };

  const updateZipText = (id: number | string, text: string) => {
    setZipInputs({ ...zipInputs, [String(id)]: text });
  };

  const getZipText = (zone: Zone) => {
    const key = String(zone.id);
    if (zipInputs[key] !== undefined) return zipInputs[key];
    return zone.zip_codes.join(", ");
  };

  const removeZone = (id: number | string) => { setZones(zones.filter((z) => z.id !== id)); };

  const saveAll = async () => {
    if (!tenantUser) return;
    setIsSaving(true);
    setError("");
    try {
      await supabase.from("service_zones").delete().eq("tenant_id", tenantUser.tenant_id);
      // Parse ZIP text inputs into arrays before saving
      const zonesWithParsedZips = zones.map((z) => {
        const key = String(z.id);
        const zipText = zipInputs[key] !== undefined ? zipInputs[key] : z.zip_codes.join(", ");
        return { ...z, zip_codes: zipText.split(",").map((s) => s.trim()).filter(Boolean) };
      });
      const valid = zonesWithParsedZips.filter((z) => z.zone_name.trim() && z.zip_codes.length > 0);
      if (valid.length > 0) {
        await supabase.from("service_zones").insert(valid.map((z, i) => ({
          tenant_id: tenantUser.tenant_id, zone_name: z.zone_name.trim(), zip_codes: z.zip_codes,
          window_start: z.window_start, window_end: z.window_end, sort_order: i + 1, is_active: z.is_active,
        })));
      }
      setSuccessMsg("Zones saved");
      setTimeout(() => setSuccessMsg(""), 3000);
      await fetchData();
    } catch (err) { setError((err as Error).message); }
    finally { setIsSaving(false); }
  };

  if (isLoading) return <div className="flex items-center justify-center py-24"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Service Zones</h1>
            <p className="text-sm text-gray-500">Set up ZIP codes and appointment time windows</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={addZone} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100"><Plus size={14} /> Add Zone</button>
          <button onClick={saveAll} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"><Save size={14} /> {isSaving ? "Saving..." : "Save All"}</button>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {successMsg && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{successMsg}</div>}

      {zones.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <MapPin size={48} className="text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No service zones</h3>
          <p className="text-gray-500 text-sm mb-4">Add zones to define time windows for your service areas.</p>
          <button onClick={addZone} className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">Add First Zone</button>
        </div>
      ) : (
        <div className="space-y-4">
          {zones.map((zone, idx) => (
            <div key={zone.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 bg-indigo-100 text-indigo-700 rounded-lg flex items-center justify-center text-sm font-bold">{idx + 1}</span>
                  <input type="text" value={zone.zone_name} onChange={(e) => updateZone(zone.id, "zone_name", e.target.value)} placeholder="Zone name (e.g., Early Morning)" className="px-3 py-1.5 text-sm font-semibold border border-gray-300 rounded-lg w-64" />
                </div>
                <button onClick={() => removeZone(zone.id)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 size={16} /></button>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Time Window</label>
                  <div className="flex gap-2">
                    <input type="text" value={zone.window_start} onChange={(e) => updateZone(zone.id, "window_start", e.target.value)} placeholder="8:30am" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                    <span className="py-2 text-gray-400">to</span>
                    <input type="text" value={zone.window_end} onChange={(e) => updateZone(zone.id, "window_end", e.target.value)} placeholder="10:30am" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">ZIP Codes</label>
                  <input type="text" value={getZipText(zone)} onChange={(e) => updateZipText(zone.id, e.target.value)} placeholder="75034, 75033, 75036" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono" />
                  <p className="text-xs text-gray-400 mt-1">Comma-separated ZIP codes</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
