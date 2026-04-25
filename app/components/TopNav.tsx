"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  Plus,
  Bell,
  ChevronDown,
  LogOut,
  User,
  ClipboardList,
  UserPlus,
  Users,
  Shield,
} from "lucide-react";

export default function TopNav() {
  const router = useRouter();
  const { user, tenantUser, signOut } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const [tenantName, setTenantName] = useState<string>("");

  useEffect(() => {
    if (!tenantUser?.tenant_id) {
      setTenantName("");
      return;
    }
    supabase
      .from("tenants")
      .select("name")
      .eq("id", tenantUser.tenant_id)
      .maybeSingle()
      .then(({ data }) => setTenantName(data?.name || ""));
  }, [tenantUser?.tenant_id]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setAddOpen(false);
      }
      if (
        profileRef.current &&
        !profileRef.current.contains(e.target as Node)
      ) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSignOut = () => {
    // Force clear all Supabase data from localStorage
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("sb-") || key.includes("supabase")) {
        localStorage.removeItem(key);
      }
    });
    signOut().catch(() => {});
    window.location.href = "/login";
  };

  const initials =
    tenantUser?.first_name && tenantUser?.last_name
      ? `${tenantUser.first_name[0]}${tenantUser.last_name[0]}`
      : user?.email?.[0]?.toUpperCase() || "U";

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 sticky top-0 z-30">
      {/* Left: company / tenant name */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 truncate">
          {tenantName || (tenantUser?.tenant_id ? "Loading…" : "Field Boss Pro")}
        </h2>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        {/* Add button */}
        <div ref={addRef} className="relative">
          <button
            onClick={() => setAddOpen(!addOpen)}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">Add</span>
          </button>
          {addOpen && (
            <div className="absolute right-0 mt-2 w-52 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
              <Link
                href="/work-orders/new"
                onClick={() => setAddOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                <ClipboardList size={16} className="text-gray-400" />
                New Work Order
              </Link>
              <Link
                href="/customers/new"
                onClick={() => setAddOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                <UserPlus size={16} className="text-gray-400" />
                New Customer
              </Link>
              <Link
                href="/people"
                onClick={() => setAddOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Users size={16} className="text-gray-400" />
                New Technician
              </Link>
            </div>
          )}
        </div>

        {/* Alerts */}
        <button className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
          <Bell size={20} />
          <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            3
          </span>
        </button>

        {/* Profile */}
        <div ref={profileRef} className="relative">
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold">
              {initials}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-sm font-medium text-gray-900 leading-tight">
                {tenantUser?.first_name
                  ? `${tenantUser.first_name} ${tenantUser.last_name || ""}`
                  : user?.email}
              </p>
              <p className="text-xs text-gray-500 capitalize leading-tight">
                {tenantUser?.role || "User"}
              </p>
            </div>
            <ChevronDown size={14} className="text-gray-400 hidden sm:block" />
          </button>
          {profileOpen && (
            <div className="absolute right-0 mt-2 w-52 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
              <Link
                href="/settings"
                onClick={() => setProfileOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                <User size={16} className="text-gray-400" />
                Profile & Settings
              </Link>
              {tenantUser?.role === "admin" && String(tenantUser?.tenant_id) === "1" && (
                <Link
                  href="/admin/dashboard"
                  onClick={() => setProfileOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Shield size={16} className="text-gray-400" />
                  Super Admin
                </Link>
              )}
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 w-full"
              >
                <LogOut size={16} className="text-red-400" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
