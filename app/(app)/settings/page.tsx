"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  Wrench,
  MapPin,
  CalendarOff,
  CreditCard,
  Building2,
  Users,
  Lock,
} from "lucide-react";

export default function SettingsPage() {
  const { user, tenantUser } = useAuth();
  const isPlatformAdmin = tenantUser?.role === "admin" && String(tenantUser?.tenant_id) === "1";

  const [pwOpen, setPwOpen] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError("");
    setPwSuccess(false);
    if (newPw.length < 8) {
      setPwError("Password must be at least 8 characters");
      return;
    }
    if (newPw !== confirmPw) {
      setPwError("Passwords don't match");
      return;
    }
    setPwSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      setPwSuccess(true);
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setPwError((err as Error).message);
    } finally {
      setPwSaving(false);
    }
  };

  const tenantSections = [
    {
      label: "Technicians & Skills",
      description: "Manage technicians, skills, and daily capacity limits",
      href: "/settings/technicians",
      icon: Wrench,
    },
    {
      label: "Service Zones",
      description: "Set up ZIP codes, time windows, and service areas",
      href: "/settings/zones",
      icon: MapPin,
    },
    {
      label: "Days Off & Holidays",
      description: "Manage technician time off and company holidays",
      href: "/settings/days-off",
      icon: CalendarOff,
    },
    {
      label: "Billing & Subscription",
      description: "Manage your Field Boss Pro subscription and payment",
      href: "/dashboard/billing",
      icon: CreditCard,
    },
  ];

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-sm mt-1">Manage your account and company settings</p>
      </div>

      {/* Account Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Building2 size={20} className="text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">Account</h2>
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-500">Email</span>
            <span className="text-gray-900 font-medium">{user?.email}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-500">Role</span>
            <span className="text-gray-900 font-medium capitalize">{tenantUser?.role}</span>
          </div>
          <div className="flex justify-between items-center py-2">
            <span className="text-gray-500">Password</span>
            <button
              onClick={() => { setPwOpen(!pwOpen); setPwError(""); setPwSuccess(false); }}
              className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              <Lock size={14} />
              {pwOpen ? "Cancel" : "Change password"}
            </button>
          </div>
        </div>

        {pwOpen && (
          <form onSubmit={handleChangePassword} className="mt-4 pt-4 border-t border-gray-100 space-y-3">
            <div>
              <label className="block text-sm text-gray-700 mb-1">New password</label>
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                autoComplete="new-password"
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">Confirm new password</label>
              <input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                autoComplete="new-password"
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            {pwError && (
              <div className="bg-red-50 border border-red-200 rounded p-2.5 text-sm text-red-700">{pwError}</div>
            )}
            {pwSuccess && (
              <div className="bg-emerald-50 border border-emerald-200 rounded p-2.5 text-sm text-emerald-700">
                Password updated.
              </div>
            )}
            <button
              type="submit"
              disabled={pwSaving}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {pwSaving ? "Saving…" : "Update password"}
            </button>
          </form>
        )}
      </div>

      {/* Tenant Settings — admin/manager/dispatcher only */}
      {tenantUser?.role !== "technician" && (
        <div className="space-y-3">
          {tenantSections.map((section) => {
            const Icon = section.icon;
            return (
              <Link
                key={section.label}
                href={section.href}
                className="flex items-center gap-4 bg-white rounded-xl border border-gray-200 p-5 hover:border-indigo-300 hover:shadow-sm transition-all group"
              >
                <div className="w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center group-hover:bg-indigo-50 transition-colors">
                  <Icon size={20} className="text-gray-400 group-hover:text-indigo-600 transition-colors" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900">{section.label}</h3>
                  <p className="text-sm text-gray-500">{section.description}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
