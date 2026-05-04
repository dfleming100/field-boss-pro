"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

export default function BillingRequiredPage() {
  const { user, tenantUser, loading, signOut } = useAuth();
  const router = useRouter();
  const [message, setMessage] = useState("Your subscription is no longer active.");
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!tenantUser?.tenant_id) return;
    fetch(`/api/billing/status?tenantId=${tenantUser.tenant_id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.message) setMessage(d.message);
        // If they're not actually locked, send them back to dashboard
        if (!d.locked && !d.requiresSubscription) router.push("/dashboard");
      })
      .catch(() => {});
  }, [tenantUser?.tenant_id, router]);

  const handleResubscribe = async () => {
    setOpening(true);
    try {
      // Try billing portal first (existing customer with payment method)
      const portalRes = await fetch("/api/stripe/billing-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenantUser?.tenant_id }),
      });
      const portalData = await portalRes.json();
      if (portalData.url) {
        window.location.href = portalData.url;
        return;
      }
      // Fall back to dashboard billing page (new checkout)
      router.push("/dashboard/billing");
    } catch {
      router.push("/dashboard/billing");
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Subscription Required</h1>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        <button
          onClick={handleResubscribe}
          disabled={opening}
          className="w-full px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {opening ? "Opening..." : "Resubscribe"}
        </button>
        <button
          onClick={signOut}
          className="w-full mt-3 px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
