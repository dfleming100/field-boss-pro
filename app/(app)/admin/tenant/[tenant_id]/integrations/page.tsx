"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  ArrowLeft,
  Phone,
  Mic,
  CreditCard,
  Megaphone,
  Bot,
  CheckCircle2,
  AlertCircle,
  Save,
  Eye,
  EyeOff,
  Copy,
} from "lucide-react";

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
}

interface VapiConfig {
  apiKey: string;
  phoneNumberId: string;
  assistantId: string;
}

interface AnthropicConfig {
  apiKey: string;
}

const emptyTwilio: TwilioConfig = { accountSid: "", authToken: "", phoneNumber: "", apiKeySid: "", apiKeySecret: "", twimlAppSid: "" };
const emptyVapi: VapiConfig = { apiKey: "", phoneNumberId: "", assistantId: "" };
const emptyAnthropic: AnthropicConfig = { apiKey: "" };

export default function TenantIntegrationPage() {
  const router = useRouter();
  const params = useParams();
  const tenantId = params.tenant_id as string;
  const { tenantUser } = useAuth();

  const [tenant, setTenant] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [activeTab, setActiveTab] = useState("twilio");
  const [isSaving, setIsSaving] = useState(false);

  // Form states
  const [twilio, setTwilio] = useState<TwilioConfig>(emptyTwilio);
  const [vapi, setVapi] = useState<VapiConfig>(emptyVapi);
  const [anthropic, setAnthropic] = useState<AnthropicConfig>(emptyAnthropic);

  // Show/hide secrets
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const toggleSecret = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const fetchData = useCallback(async () => {
    try {
      const { data: tenantData } = await supabase
        .from("tenants")
        .select("*")
        .eq("id", tenantId)
        .single();

      setTenant(tenantData);

      // Fetch all integrations for this tenant
      const { data: integrations } = await supabase
        .from("tenant_integrations")
        .select("*")
        .eq("tenant_id", tenantId);

      for (const int of integrations || []) {
        const keys = int.encrypted_keys || {};
        switch (int.integration_type) {
          case "twilio":
            setTwilio({
              accountSid: keys.accountSid || "",
              authToken: keys.authToken || "",
              phoneNumber: keys.phoneNumber || "",
              apiKeySid: keys.apiKeySid || "",
              apiKeySecret: keys.apiKeySecret || "",
              twimlAppSid: keys.twimlAppSid || "",
            });
            break;
          case "vapi":
            setVapi({
              apiKey: keys.apiKey || "",
              phoneNumberId: keys.phoneNumberId || "",
              assistantId: keys.assistantId || "",
            });
            break;
          case "anthropic":
            setAnthropic({ apiKey: keys.apiKey || "" });
            break;
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const saveIntegration = async (type: string, keys: Record<string, string>) => {
    setIsSaving(true);
    setError("");
    setSuccessMsg("");

    try {
      // Check if integration exists
      const { data: existing } = await supabase
        .from("tenant_integrations")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("integration_type", type)
        .single();

      if (existing) {
        await supabase
          .from("tenant_integrations")
          .update({
            encrypted_keys: keys,
            encryption_key: "plaintext",
            is_configured: Object.values(keys).some((v) => v.length > 0),
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("tenant_integrations").insert({
          tenant_id: tenantId,
          integration_type: type,
          encrypted_keys: keys,
          encryption_key: "plaintext",
          is_configured: Object.values(keys).some((v) => v.length > 0),
        });
      }

      setSuccessMsg(`${type.charAt(0).toUpperCase() + type.slice(1)} saved successfully`);
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const appUrl = "https://field-boss-pro.vercel.app";

  const SecretField = ({
    label, value, onChange, placeholder, fieldKey, helpText,
  }: {
    label: string; value: string; onChange: (v: string) => void;
    placeholder: string; fieldKey: string; helpText?: string;
  }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="relative">
        <input
          type={showSecrets[fieldKey] ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 pr-10 text-sm border border-gray-300 rounded-lg font-mono"
        />
        <button
          type="button"
          onClick={() => toggleSecret(fieldKey)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
        >
          {showSecrets[fieldKey] ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {helpText && <p className="text-xs text-gray-400 mt-1">{helpText}</p>}
    </div>
  );

  const StatusBadge = ({ configured }: { configured: boolean }) => (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
      configured ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
    }`}>
      {configured ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
      {configured ? "Configured" : "Not configured"}
    </span>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const tabs = [
    { id: "twilio", label: "Twilio", icon: Phone, configured: !!twilio.accountSid },
    { id: "vapi", label: "Vapi", icon: Mic, configured: !!vapi.apiKey },
    { id: "anthropic", label: "AI (Claude)", icon: Bot, configured: !!anthropic.apiKey },
    { id: "webhooks", label: "Webhooks", icon: Megaphone, configured: true },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{tenant?.name || "Tenant"}</h1>
          <p className="text-sm text-gray-500">Integration Settings — Super Admin</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle size={16} className="text-red-500" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      {successMsg && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
          <CheckCircle2 size={16} className="text-green-500" />
          <p className="text-sm text-green-700">{successMsg}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-gray-200">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
                activeTab === tab.id
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Icon size={16} />
              {tab.label}
              <StatusBadge configured={tab.configured} />
            </button>
          );
        })}
      </div>

      {/* ── Twilio Tab ── */}
      {activeTab === "twilio" && (
        <div className="space-y-6">
          {/* Core Twilio */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Twilio SMS & Voice</h2>
            <p className="text-sm text-gray-500 mb-4">Core Twilio credentials for SMS and voice calls</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account SID</label>
                <input
                  type="text"
                  value={twilio.accountSid}
                  onChange={(e) => setTwilio({ ...twilio, accountSid: e.target.value })}
                  placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono"
                />
              </div>
              <SecretField
                label="Auth Token" value={twilio.authToken}
                onChange={(v) => setTwilio({ ...twilio, authToken: v })}
                placeholder="Your Twilio auth token" fieldKey="twilioAuth"
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={twilio.phoneNumber}
                  onChange={(e) => setTwilio({ ...twilio, phoneNumber: e.target.value })}
                  placeholder="+18552693196"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                />
              </div>
            </div>
          </div>

          {/* Softphone / Browser Calling */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Softphone (Browser Calling)</h2>
            <p className="text-sm text-gray-500 mb-4">Required for click-to-call from Field Boss. Customer sees the business number as caller ID.</p>
            <div className="space-y-4">
              <SecretField
                label="API Key SID" value={twilio.apiKeySid}
                onChange={(v) => setTwilio({ ...twilio, apiKeySid: v })}
                placeholder="SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" fieldKey="apiKeySid"
                helpText="Twilio Console → Account → API Keys → Create new key"
              />
              <SecretField
                label="API Key Secret" value={twilio.apiKeySecret}
                onChange={(v) => setTwilio({ ...twilio, apiKeySecret: v })}
                placeholder="Your API key secret" fieldKey="apiKeySecret"
                helpText="Shown once when you create the key — save it"
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">TwiML App SID</label>
                <input
                  type="text"
                  value={twilio.twimlAppSid}
                  onChange={(e) => setTwilio({ ...twilio, twimlAppSid: e.target.value })}
                  placeholder="APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Twilio Console → Voice → TwiML Apps → Create. Set Voice URL to: <code className="bg-gray-100 px-1 rounded">{appUrl}/api/twilio/twiml</code>
                </p>
              </div>
            </div>
          </div>

          {/* Webhook URLs (read-only) */}
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Twilio Webhook URLs (set in Twilio Console)</h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-3 py-2">
                <div>
                  <p className="text-xs text-gray-500">Incoming SMS Webhook</p>
                  <code className="text-xs text-gray-900">{appUrl}/api/sms/incoming</code>
                </div>
                <button onClick={() => navigator.clipboard.writeText(`${appUrl}/api/sms/incoming`)} className="p-1 text-gray-400 hover:text-gray-600">
                  <Copy size={14} />
                </button>
              </div>
              <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-3 py-2">
                <div>
                  <p className="text-xs text-gray-500">TwiML Voice URL</p>
                  <code className="text-xs text-gray-900">{appUrl}/api/twilio/twiml</code>
                </div>
                <button onClick={() => navigator.clipboard.writeText(`${appUrl}/api/twilio/twiml`)} className="p-1 text-gray-400 hover:text-gray-600">
                  <Copy size={14} />
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={() => saveIntegration("twilio", twilio as any)}
            disabled={isSaving}
            className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            <Save size={16} />
            {isSaving ? "Saving..." : "Save Twilio Configuration"}
          </button>
        </div>
      )}

      {/* ── Vapi Tab ── */}
      {activeTab === "vapi" && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Vapi Voice Agent</h2>
            <p className="text-sm text-gray-500 mb-4">AI voice agent for inbound calls — handles scheduling, customer lookup, and booking</p>
            <div className="space-y-4">
              <SecretField
                label="Vapi API Key" value={vapi.apiKey}
                onChange={(v) => setVapi({ ...vapi, apiKey: v })}
                placeholder="Your Vapi API key" fieldKey="vapiKey"
                helpText="Vapi Dashboard → Settings → API Keys"
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number ID</label>
                <input
                  type="text"
                  value={vapi.phoneNumberId}
                  onChange={(e) => setVapi({ ...vapi, phoneNumberId: e.target.value })}
                  placeholder="Vapi phone number ID"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assistant ID</label>
                <input
                  type="text"
                  value={vapi.assistantId}
                  onChange={(e) => setVapi({ ...vapi, assistantId: e.target.value })}
                  placeholder="Vapi assistant ID"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono"
                />
              </div>
            </div>
          </div>

          {/* Vapi Tool URLs */}
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Vapi Custom Tool URLs (set in Vapi Dashboard)</h2>
            <div className="space-y-2 text-sm">
              {[
                { label: "Customer Lookup", path: "/api/vapi/customer-lookup" },
                { label: "Get Available Slots", path: "/api/vapi/get-available-slots" },
                { label: "Book Appointment", path: "/api/vapi/book-appointment" },
              ].map((tool) => (
                <div key={tool.path} className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-3 py-2">
                  <div>
                    <p className="text-xs text-gray-500">{tool.label}</p>
                    <code className="text-xs text-gray-900">{appUrl}{tool.path}</code>
                  </div>
                  <button onClick={() => navigator.clipboard.writeText(`${appUrl}${tool.path}`)} className="p-1 text-gray-400 hover:text-gray-600">
                    <Copy size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => saveIntegration("vapi", vapi as any)}
            disabled={isSaving}
            className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            <Save size={16} />
            {isSaving ? "Saving..." : "Save Vapi Configuration"}
          </button>
        </div>
      )}

      {/* ── Anthropic / AI Tab ── */}
      {activeTab === "anthropic" && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">AI Agent (Claude)</h2>
            <p className="text-sm text-gray-500 mb-4">Powers the SMS AI agent for intent classification and customer service responses</p>
            <div className="space-y-4">
              <SecretField
                label="Anthropic API Key" value={anthropic.apiKey}
                onChange={(v) => setAnthropic({ ...anthropic, apiKey: v })}
                placeholder="sk-ant-api03-..." fieldKey="anthropicKey"
                helpText="console.anthropic.com → API Keys"
              />
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  Uses Claude Haiku for fast, cost-effective SMS responses. Handles scheduling, pricing questions, status checks, and more.
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={() => saveIntegration("anthropic", anthropic as any)}
            disabled={isSaving}
            className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            <Save size={16} />
            {isSaving ? "Saving..." : "Save AI Configuration"}
          </button>
        </div>
      )}

      {/* ── Webhooks Tab ── */}
      {activeTab === "webhooks" && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Webhook Endpoints</h2>
            <p className="text-sm text-gray-500 mb-4">These URLs receive data from external systems. Set them in the corresponding dashboards.</p>
            <div className="space-y-3">
              {[
                { label: "Twilio Incoming SMS", path: "/api/sms/incoming", desc: "Set in Twilio Console → Phone Number → Messaging" },
                { label: "Twilio Voice (TwiML)", path: "/api/twilio/twiml", desc: "Set in Twilio Console → TwiML App → Voice URL" },
                { label: "Stripe Webhook", path: "/api/stripe/webhook", desc: "Set in Stripe Dashboard → Webhooks" },
                { label: "AHS Warranty Inbound", path: "/api/warranty/inbound", desc: "Give to AHS for pushing new work orders" },
                { label: "AHS Status Sync", path: "/api/warranty/status", desc: "Bidirectional status updates with warranty companies" },
                { label: "Vapi: Customer Lookup", path: "/api/vapi/customer-lookup", desc: "Vapi custom tool" },
                { label: "Vapi: Get Available Slots", path: "/api/vapi/get-available-slots", desc: "Vapi custom tool" },
                { label: "Vapi: Book Appointment", path: "/api/vapi/book-appointment", desc: "Vapi custom tool" },
              ].map((endpoint) => (
                <div key={endpoint.path} className="flex items-center justify-between bg-gray-50 rounded-lg border border-gray-200 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{endpoint.label}</p>
                    <code className="text-xs text-indigo-600">{appUrl}{endpoint.path}</code>
                    <p className="text-xs text-gray-400 mt-0.5">{endpoint.desc}</p>
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(`${appUrl}${endpoint.path}`)}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 bg-white border border-gray-200 rounded hover:bg-gray-50"
                  >
                    <Copy size={12} />
                    Copy
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
