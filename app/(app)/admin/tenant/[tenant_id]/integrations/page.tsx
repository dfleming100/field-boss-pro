"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";

interface TenantData {
  id: string;
  name: string;
  stripe_connect_account_id: string | null;
}

interface Integration {
  id: string;
  integration_type: "twilio" | "vapi" | "leadform" | "other";
  api_key: string;
  config: Record<string, any>;
  active: boolean;
}

export default function TenantIntegrationPage() {
  const router = useRouter();
  const params = useParams();
  const tenantId = params.tenant_id as string;
  const { user, tenantUser, loading } = useAuth();

  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"twilio" | "vapi" | "leadform">(
    "twilio"
  );

  // Form states
  const [twilioSid, setTwilioSid] = useState("");
  const [twilioToken, setTwilioToken] = useState("");
  const [twilioPhone, setTwilioPhone] = useState("");

  const [vapiApiKey, setVapiApiKey] = useState("");
  const [vapiPhoneNumber, setVapiPhoneNumber] = useState("");

  const [leadFormName, setLeadFormName] = useState("");
  const [leadFormType, setLeadFormType] = useState<
    "google_ads" | "facebook_ads" | "web_form" | "phone_call"
  >("web_form");
  const [leadFormConfig, setLeadFormConfig] = useState("");

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (!user || tenantUser?.role !== "admin") {
        router.push("/dashboard");
        return;
      }
      fetchData();
    }
  }, [loading, user, tenantUser, router, tenantId]);

  const fetchData = async () => {
    try {
      // Fetch tenant
      const { data: tenantData, error: tenantError } = await supabase
        .from("tenants")
        .select("*")
        .eq("id", tenantId)
        .single();

      if (tenantError) throw tenantError;
      setTenant(tenantData);

      // Fetch integrations
      const { data: integrationsData, error: intError } = await supabase
        .from("tenant_integrations")
        .select("*")
        .eq("tenant_id", tenantId);

      if (intError) throw intError;
      setIntegrations(integrationsData || []);

      // Populate form with existing data
      const twilio = integrationsData?.find(
        (i: Integration) => i.integration_type === "twilio"
      );
      if (twilio) {
        setTwilioSid(twilio.api_key || "");
        setTwilioToken(twilio.config?.api_secret || "");
        setTwilioPhone(twilio.config?.phone_number || "");
      }

      const vapi = integrationsData?.find((i: Integration) => i.integration_type === "vapi");
      if (vapi) {
        setVapiApiKey(vapi.api_key || "");
        setVapiPhoneNumber(vapi.config?.phone_number || "");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveTwilio = async () => {
    if (!twilioSid || !twilioToken || !twilioPhone) {
      setError("All Twilio fields are required");
      return;
    }

    setIsSaving(true);
    try {
      const existing = integrations.find(
        (i) => i.integration_type === "twilio"
      );

      if (existing) {
        // Update
        const { error: updateError } = await supabase
          .from("tenant_integrations")
          .update({
            api_key: twilioSid,
            config: {
              api_secret: twilioToken,
              phone_number: twilioPhone,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        if (updateError) throw updateError;
      } else {
        // Create
        const { error: insertError } = await supabase
          .from("tenant_integrations")
          .insert({
            tenant_id: tenantId,
            integration_type: "twilio",
            api_key: twilioSid,
            config: {
              api_secret: twilioToken,
              phone_number: twilioPhone,
            },
            active: true,
          });

        if (insertError) throw insertError;
      }

      setError("");
      await fetchData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveVapi = async () => {
    if (!vapiApiKey || !vapiPhoneNumber) {
      setError("All Vapi fields are required");
      return;
    }

    setIsSaving(true);
    try {
      const existing = integrations.find((i) => i.integration_type === "vapi");

      if (existing) {
        const { error: updateError } = await supabase
          .from("tenant_integrations")
          .update({
            api_key: vapiApiKey,
            config: {
              phone_number: vapiPhoneNumber,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("tenant_integrations")
          .insert({
            tenant_id: tenantId,
            integration_type: "vapi",
            api_key: vapiApiKey,
            config: {
              phone_number: vapiPhoneNumber,
            },
            active: true,
          });

        if (insertError) throw insertError;
      }

      setError("");
      await fetchData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-red-500">Tenant not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="text-gray-600 hover:text-gray-900"
          >
            ← Back
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{tenant.name}</h1>
            <p className="text-sm text-gray-600">Integration Settings</p>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-4 mb-8 border-b border-gray-200">
          {(["twilio", "vapi", "leadform"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 font-medium border-b-2 transition ${
                activeTab === tab
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              {tab === "twilio" && "Twilio"}
              {tab === "vapi" && "Vapi"}
              {tab === "leadform" && "Lead Forms"}
            </button>
          ))}
        </div>

        {/* Twilio Tab */}
        {activeTab === "twilio" && (
          <div className="bg-white rounded-lg shadow p-6 max-w-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-6">
              Twilio Configuration
            </h3>
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Account SID
                </label>
                <input
                  type="text"
                  value={twilioSid}
                  onChange={(e) => setTwilioSid(e.target.value)}
                  placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Auth Token
                </label>
                <input
                  type="password"
                  value={twilioToken}
                  onChange={(e) => setTwilioToken(e.target.value)}
                  placeholder="••••••••••••••••••••••••••••••••"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={twilioPhone}
                  onChange={(e) => setTwilioPhone(e.target.value)}
                  placeholder="+1234567890"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              <button
                onClick={handleSaveTwilio}
                disabled={isSaving}
                className="w-full bg-indigo-600 text-white py-2 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {isSaving ? "Saving..." : "Save Twilio Configuration"}
              </button>
            </div>
          </div>
        )}

        {/* Vapi Tab */}
        {activeTab === "vapi" && (
          <div className="bg-white rounded-lg shadow p-6 max-w-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-6">
              Vapi Configuration
            </h3>
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  API Key
                </label>
                <input
                  type="password"
                  value={vapiApiKey}
                  onChange={(e) => setVapiApiKey(e.target.value)}
                  placeholder="••••••••••••••••••••••••••••••••"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={vapiPhoneNumber}
                  onChange={(e) => setVapiPhoneNumber(e.target.value)}
                  placeholder="+1234567890"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              <button
                onClick={handleSaveVapi}
                disabled={isSaving}
                className="w-full bg-indigo-600 text-white py-2 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {isSaving ? "Saving..." : "Save Vapi Configuration"}
              </button>
            </div>
          </div>
        )}

        {/* Lead Forms Tab */}
        {activeTab === "leadform" && (
          <div className="bg-white rounded-lg shadow p-6 max-w-2xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-6">
              Lead Form Configuration
            </h3>
            <div className="space-y-6">
              <p className="text-sm text-gray-600">
                Configure lead capture from Google Ads, Facebook Ads, or web forms. This is extensible for future ad platforms.
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Form Type
                </label>
                <select
                  value={leadFormType}
                  onChange={(e) =>
                    setLeadFormType(
                      e.target.value as
                        | "google_ads"
                        | "facebook_ads"
                        | "web_form"
                        | "phone_call"
                    )
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="web_form">Web Form</option>
                  <option value="google_ads">Google Ads Lead Form</option>
                  <option value="facebook_ads">Facebook Ads Lead Form</option>
                  <option value="phone_call">Phone Call (Vapi)</option>
                </select>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  ℹ️ Lead forms will automatically convert leads to customers in your system. Connects with Twilio and Vapi for call routing.
                </p>
              </div>

              <button
                disabled={isSaving}
                className="w-full bg-indigo-600 text-white py-2 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {isSaving ? "Saving..." : "Configure Lead Forms"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
