"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import TechMap, { TechPin } from "@/app/components/TechMap";

export default function MapPage() {
  const { tenantUser } = useAuth();
  const [techPins, setTechPins] = useState<TechPin[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPins = useCallback(async () => {
    if (!tenantUser) return;
    let query = supabase
      .from("technicians")
      .select("id, tech_name, last_lat, last_lng, last_location_at")
      .eq("tenant_id", tenantUser.tenant_id)
      .eq("is_active", true)
      .not("last_location_at", "is", null);

    // Tech: only their own pin
    if (tenantUser.role === "technician" && tenantUser.technician_id) {
      query = query.eq("id", tenantUser.technician_id);
    }

    const { data } = await query;
    setTechPins((data || []).filter((t: any) => t.last_lat != null && t.last_lng != null) as TechPin[]);
    setLoading(false);
  }, [tenantUser]);

  useEffect(() => {
    fetchPins();
    const id = setInterval(fetchPins, 60000);
    return () => clearInterval(id);
  }, [fetchPins]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Map</h1>
          <p className="text-gray-500 mt-1">Live technician locations — updates every 60 seconds.</p>
        </div>
        <div className="text-sm text-gray-500">
          {loading ? "Loading…" : techPins.length ? `${techPins.length} tech${techPins.length === 1 ? "" : "s"} reporting` : "No techs reporting"}
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-3">
        <TechMap techs={techPins} apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY} height={640} />
      </div>
    </div>
  );
}
