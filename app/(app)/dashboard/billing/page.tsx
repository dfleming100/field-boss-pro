"use client";

import React, { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { calculateBilling, formatMonthly, formatCurrency } from "@/lib/billing";
import {
  CreditCard,
  Building2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Zap,
  Users,
  DollarSign,
} from "lucide-react";

function BillingContent() {
  const { user, tenantUser } = useAuth();
  const searchParams = useSearchParams();

  const [tenant, setTenant] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [techCount, setTechCount] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [connectLive, setConnectLive] = useState<{
    status: string;
    charges_enabled?: boolean;
    payouts_enabled?: boolean;
    details_submitted?: boolean;
    requirements_currently_due?: string[];
    resume_url?: string | null;
  } | null>(null);

  // Check URL params for return status
  useEffect(() => {
    const connect = searchParams.get("connect");
    const subscription = searchParams.get("subscription");
    if (connect === "success") setSuccessMsg("Stripe Connect setup complete!");
    if (subscription === "success") setSuccessMsg("Subscription activated successfully!");
    if (subscription === "canceled") setError("Subscription setup was canceled.");
  }, [searchParams]);

  const fetchData = useCallback(async () => {
    if (!tenantUser) return;
    try {
      const [tenantRes, techRes] = await Promise.all([
        supabase
          .from("tenants")
          .select("*")
          .eq("id", tenantUser.tenant_id)
          .single(),
        supabase
          .from("technicians")
          .select("id", { count: "exact" })
          .eq("tenant_id", tenantUser.tenant_id)
          .eq("is_active", true),
      ]);

      if (tenantRes.error) throw tenantRes.error;
      setTenant(tenantRes.data);
      setTechCount(techRes.count || 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [tenantUser]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!tenant?.stripe_connect_account_id || !tenantUser?.tenant_id) {
      setConnectLive(null);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/stripe/connect-status?tenantId=${tenantUser.tenant_id}`);
        if (res.ok) setConnectLive(await res.json());
      } catch {}
    })();
  }, [tenant?.stripe_connect_account_id, tenantUser?.tenant_id]);

  // ── Subscribe to Field Boss Pro ──
  const handleSubscribe = async () => {
    setIsSubscribing(true);
    setError("");
    try {
      const res = await fetch("/api/stripe/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenantUser?.tenant_id,
          techCount,
          email: user?.email,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Failed to create checkout session");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubscribing(false);
    }
  };

  // ── Connect Stripe (for collecting customer payments) ──
  const handleConnectStripe = async () => {
    setIsConnecting(true);
    setError("");
    try {
      const res = await fetch("/api/stripe/create-connect-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenantUser?.tenant_id }),
      });
      const data = await res.json();
      if (data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
      } else {
        setError(data.error || "Failed to start Stripe Connect setup");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnectStripe = async () => {
    if (!window.confirm("Disconnect Stripe? You won't be able to collect customer payments.")) return;
    setIsConnecting(true);
    try {
      await supabase
        .from("tenants")
        .update({ stripe_connect_account_id: null })
        .eq("id", tenantUser?.tenant_id);
      await fetchData();
      setSuccessMsg("Stripe disconnected");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsConnecting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const billing = calculateBilling(techCount);
  const hasSubscription = tenant?.plan === "professional";
  const hasConnect = !!tenant?.stripe_connect_account_id;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Billing & Payments</h1>
        <p className="text-gray-500 text-sm mt-1">
          Manage your subscription and payment collection
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      {successMsg && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
          <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
          <p className="text-sm text-green-700">{successMsg}</p>
        </div>
      )}

      {/* ════════════════════════════════════════════════════
          SECTION 1: YOUR SUBSCRIPTION (Tenant pays Field Boss)
         ════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
            <Zap size={20} className="text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Your Subscription
            </h2>
            <p className="text-sm text-gray-500">
              Pay for Field Boss Pro to manage your business
            </p>
          </div>
          {hasSubscription && (
            <span className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 bg-green-100 text-green-700 text-sm font-semibold rounded-full">
              <CheckCircle2 size={14} />
              Active
            </span>
          )}
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign size={16} className="text-gray-400" />
              <span className="text-xs font-semibold text-gray-500 uppercase">
                Base Fee
              </span>
            </div>
            <p className="text-2xl font-bold text-gray-900">$99</p>
            <p className="text-xs text-gray-500 mt-1">
              /month &middot; up to 3 techs
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-2 mb-2">
              <Users size={16} className="text-gray-400" />
              <span className="text-xs font-semibold text-gray-500 uppercase">
                Extra Techs
              </span>
            </div>
            <p className="text-2xl font-bold text-gray-900">$50</p>
            <p className="text-xs text-gray-500 mt-1">
              /month &middot; per additional tech
            </p>
          </div>
          <div className="bg-indigo-50 rounded-lg p-4 border border-indigo-200">
            <div className="flex items-center gap-2 mb-2">
              <CreditCard size={16} className="text-indigo-500" />
              <span className="text-xs font-semibold text-indigo-600 uppercase">
                Your Cost
              </span>
            </div>
            <p className="text-2xl font-bold text-indigo-600">
              {formatCurrency(billing.totalMonthlyCost)}
            </p>
            <p className="text-xs text-indigo-500 mt-1">
              /month &middot; {techCount} tech{techCount !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* Cost breakdown */}
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 mb-4">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">
                Base fee (includes 3 techs)
              </span>
              <span className="font-medium">{formatMonthly(billing.baseFee)}</span>
            </div>
            {billing.additionalTechs > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-600">
                  {billing.additionalTechs} additional tech
                  {billing.additionalTechs !== 1 ? "s" : ""} x $50
                </span>
                <span className="font-medium text-orange-600">
                  {formatMonthly(billing.additionalFee)}
                </span>
              </div>
            )}
            <div className="flex justify-between border-t border-gray-200 pt-2 font-semibold">
              <span className="text-gray-900">Total</span>
              <span className="text-indigo-600">
                {formatMonthly(billing.totalMonthlyCost)}
              </span>
            </div>
          </div>
        </div>

        {hasSubscription ? (
          <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-green-600" />
              <span className="text-sm font-medium text-green-700">
                Professional plan active
              </span>
            </div>
            <button
              onClick={handleSubscribe}
              disabled={isSubscribing}
              className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              Manage Subscription
            </button>
          </div>
        ) : (
          <button
            onClick={handleSubscribe}
            disabled={isSubscribing}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
          >
            <CreditCard size={18} />
            {isSubscribing
              ? "Redirecting to Stripe..."
              : `Subscribe — ${formatMonthly(billing.totalMonthlyCost)}`}
          </button>
        )}
      </div>

      {/* ════════════════════════════════════════════════════
          SECTION 2: STRIPE CONNECT (Tenant collects customer payments)
         ════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
            <Building2 size={20} className="text-purple-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Payment Collection
            </h2>
            <p className="text-sm text-gray-500">
              Connect your Stripe account to collect payments from your customers
            </p>
          </div>
          {hasConnect && (
            <span className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 bg-green-100 text-green-700 text-sm font-semibold rounded-full">
              <CheckCircle2 size={14} />
              Connected
            </span>
          )}
        </div>

        {hasConnect ? (
          <div>
            {connectLive?.status === "active" ? (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 size={16} className="text-green-600" />
                  <span className="text-sm font-semibold text-green-700">Ready to collect payments</span>
                </div>
                <p className="text-xs text-green-600 ml-6">
                  Charges and payouts enabled · Account {tenant?.stripe_connect_account_id?.substring(0, 18)}…
                </p>
              </div>
            ) : connectLive?.status === "pending_review" ? (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle size={16} className="text-amber-600" />
                  <span className="text-sm font-semibold text-amber-700">Stripe is reviewing your account</span>
                </div>
                <p className="text-xs text-amber-700 ml-6">
                  You&apos;ll be able to collect payments once review is complete (usually 1–2 business days).
                </p>
              </div>
            ) : connectLive?.status === "incomplete" ? (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle size={16} className="text-red-600" />
                  <span className="text-sm font-semibold text-red-700">Onboarding incomplete</span>
                </div>
                <p className="text-xs text-red-700 ml-6 mb-2">
                  {connectLive.requirements_currently_due?.length
                    ? `Stripe still needs: ${connectLive.requirements_currently_due.slice(0, 3).join(", ")}`
                    : "Finish Stripe onboarding to start collecting payments."}
                </p>
                {connectLive.resume_url && (
                  <a
                    href={connectLive.resume_url}
                    className="ml-6 inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700"
                  >
                    Resume Onboarding <ExternalLink size={12} />
                  </a>
                )}
              </div>
            ) : (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg mb-4">
                <p className="text-xs text-gray-600">Checking Stripe account status…</p>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleConnectStripe}
                disabled={isConnecting}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                <ExternalLink size={16} />
                {isConnecting ? "Opening..." : "Stripe Dashboard"}
              </button>
              <button
                onClick={handleDisconnectStripe}
                disabled={isConnecting}
                className="px-4 py-2.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-blue-800">
                Connect your Stripe account to accept credit card payments from
                your customers. Funds go directly to your bank account.
              </p>
              <ul className="mt-3 space-y-1.5 text-xs text-blue-700">
                <li className="flex items-center gap-2">
                  <CheckCircle2 size={12} /> Accept credit/debit cards
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 size={12} /> Automatic payouts to your bank
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 size={12} /> Send invoices from work orders
                </li>
              </ul>
            </div>
            <button
              onClick={handleConnectStripe}
              disabled={isConnecting}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50 shadow-sm"
            >
              <Building2 size={18} />
              {isConnecting
                ? "Redirecting to Stripe..."
                : "Connect Stripe Account"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="text-sm text-gray-500">Loading...</div></div>}>
      <BillingContent />
    </Suspense>
  );
}
