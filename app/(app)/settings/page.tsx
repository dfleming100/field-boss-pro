"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import {
  Wrench,
  MapPin,
  CalendarOff,
  CreditCard,
  Building2,
  Users,
} from "lucide-react";

export default function SettingsPage() {
  const { user, tenantUser } = useAuth();
  const isPlatformAdmin = tenantUser?.role === "admin" && String(tenantUser?.tenant_id) === "1";

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
        </div>
      </div>

      {/* Tenant Settings */}
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
    </div>
  );
}
