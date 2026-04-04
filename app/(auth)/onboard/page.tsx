"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { supabase, supabaseAdmin } from "@/lib/supabase";

export default function OnboardPage() {
  const router = useRouter();
  const { user, loading, tenantUser } = useAuth();
  
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Organization info
  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [serviceTypes, setServiceTypes] = useState<string[]>([]);

  // Team member info
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  // Redirect if already has tenant
  React.useEffect(() => {
    if (!loading && tenantUser) {
      router.push("/dashboard");
    }
  }, [loading, tenantUser, router]);

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-gray-500">Redirecting to login...</div>
      </div>
    );
  }

  const handleCreateOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      // Create tenant
      const { data: tenantData, error: tenantError } = await supabase
        .from("tenants")
        .insert({
          name: organizationName,
          slug: organizationSlug.toLowerCase().replace(/\s+/g, "-"),
          phone,
          email,
          address,
          city,
          state,
          zip,
        })
        .select()
        .single();

      if (tenantError) throw tenantError;

      // Create tenant_user as admin
      const { error: userError } = await supabase
        .from("tenant_users")
        .insert({
          tenant_id: tenantData.id,
          auth_uid: user.id,
          email: user.email,
          role: "admin",
          first_name: firstName,
          last_name: lastName,
          active: true,
        });

      if (userError) throw userError;

      setStep(2);
    } catch (err) {
      setError((err as Error).message || "Failed to create organization");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddTechnicianStep = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      // Get the tenant user
      const { data: tenantUserData } = await supabase
        .from("tenant_users")
        .select("tenant_id")
        .eq("auth_uid", user.id)
        .single();

      if (!tenantUserData) throw new Error("Tenant not found");

      // Redirect to dashboard
      router.push("/dashboard");
    } catch (err) {
      setError((err as Error).message || "Failed to complete onboarding");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900">
            Welcome to Field Service Pro
          </h1>
          <p className="mt-2 text-gray-600">
            Step {step} of 2: Set up your organization
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-lg shadow-lg p-8">
          {/* Error */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Progress */}
          <div className="mb-8 flex justify-between items-center">
            <div
              className={`h-12 w-12 rounded-full flex items-center justify-center font-bold ${
                step >= 1
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-200 text-gray-600"
              }`}
            >
              ✓
            </div>
            <div
              className={`flex-1 h-1 mx-4 ${
                step >= 2 ? "bg-indigo-600" : "bg-gray-200"
              }`}
            ></div>
            <div
              className={`h-12 w-12 rounded-full flex items-center justify-center font-bold ${
                step >= 2
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-200 text-gray-600"
              }`}
            >
              2
            </div>
          </div>

          {/* Step 1: Organization */}
          {step === 1 && (
            <form onSubmit={handleCreateOrganization} className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Organization Details
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Organization Name *
                  </label>
                  <input
                    type="text"
                    value={organizationName}
                    onChange={(e) => {
                      setOrganizationName(e.target.value);
                      setOrganizationSlug(e.target.value);
                    }}
                    className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="Fleming Appliance Repair"
                    required
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Contact Name *
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="mt-1 flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                      placeholder="First"
                      required
                      disabled={isLoading}
                    />
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="mt-1 flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                      placeholder="Last"
                      disabled={isLoading}
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="(555) 123-4567"
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Email *
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="contact@example.com"
                    required
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Service Address
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  placeholder="123 Main St"
                  disabled={isLoading}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    City
                  </label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="Denver"
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    State
                  </label>
                  <input
                    type="text"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="CO"
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    ZIP
                  </label>
                  <input
                    type="text"
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                    className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="80202"
                    disabled={isLoading}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-indigo-600 text-white py-3 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {isLoading ? "Creating..." : "Continue to Step 2"}
              </button>
            </form>
          )}

          {/* Step 2: Addons */}
          {step === 2 && (
            <form onSubmit={handleAddTechnicianStep} className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  You're Almost Done!
                </h3>
                <p className="text-gray-600 mb-6">
                  Your organization has been created. You can now add technicians,
                  customers, and set up your dispatch system in the dashboard.
                </p>
              </div>

              {/* Quick Setup Options */}
              <div className="bg-gray-50 rounded-lg p-6">
                <h4 className="font-medium text-gray-900 mb-4">
                  What's next?
                </h4>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li>✓ Add your first technician</li>
                  <li>✓ Import customers from your CRM</li>
                  <li>✓ Set up service areas and ZIP routing</li>
                  <li>✓ Configure appointment windows</li>
                  <li>✓ Connect Stripe for billing</li>
                </ul>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-indigo-600 text-white py-3 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {isLoading ? "Completing..." : "Go to Dashboard"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
