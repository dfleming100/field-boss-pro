"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";

const FREE_TIERS = new Set(["starter", "free", "trial", ""]);

/**
 * Returns the current tenant's plan + a derived `isPaid` flag.
 * Cached in localStorage so the sidebar doesn't flicker between renders.
 *
 * Anything that is NOT in FREE_TIERS counts as paid (gets Boss Board as
 * Home). This is intentionally loose — DB plan strings have drifted from
 * the marketing tiers (professional, enterprise, growth, scale, etc all
 * exist in production) and we'd rather over-grant than gate a paying
 * tenant out of a feature they paid for.
 */
export function useTenantPlan(): { plan: string | null; isPaid: boolean } {
  const { tenantUser } = useAuth();
  const cacheKey = tenantUser ? `fb_tenant_plan_${tenantUser.tenant_id}` : "";

  const [plan, setPlan] = useState<string | null>(() => {
    if (typeof window === "undefined" || !cacheKey) return null;
    return localStorage.getItem(cacheKey);
  });

  useEffect(() => {
    if (!tenantUser) { setPlan(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("tenants")
        .select("plan")
        .eq("id", tenantUser.tenant_id)
        .maybeSingle();
      if (cancelled) return;
      const next = (data?.plan || "").toLowerCase();
      setPlan(next);
      try { localStorage.setItem(cacheKey, next); } catch {}
    })();
    return () => { cancelled = true; };
  }, [tenantUser, cacheKey]);

  const isPaid = !FREE_TIERS.has((plan || "").toLowerCase());
  return { plan, isPaid };
}
