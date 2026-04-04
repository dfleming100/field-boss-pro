"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Funnel,
  Users,
  ClipboardList,
  MapPin,
  CalendarDays,
  FileText,
  CreditCard,
  BarChart3,
  Settings,
  HelpCircle,
  Wrench,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const navItems = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "Leads", href: "/leads", icon: Funnel },
  { label: "Customers", href: "/customers", icon: Users },
  { label: "Technicians", href: "/people", icon: Wrench },
  { label: "Work Orders", href: "/work-orders", icon: ClipboardList },
  { label: "Map", href: "/map", icon: MapPin },
  { label: "Scheduling", href: "/scheduling", icon: CalendarDays },
  { label: "Invoices", href: "/invoices", icon: FileText },
  { label: "Payments", href: "/payments", icon: CreditCard },
  { label: "Reports", href: "/reports", icon: BarChart3 },
];

const bottomItems = [
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "Help Center", href: "/help", icon: HelpCircle },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  const NavItem = ({
    item,
  }: {
    item: { label: string; href: string; icon: React.ElementType };
  }) => {
    const active = isActive(item.href);
    const Icon = item.icon;

    return (
      <Link
        href={item.href}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group
          ${
            active
              ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/25"
              : "text-slate-400 hover:text-white hover:bg-slate-800"
          }
          ${collapsed ? "justify-center" : ""}
        `}
        title={collapsed ? item.label : undefined}
      >
        <Icon
          size={20}
          className={`flex-shrink-0 ${
            active
              ? "text-white"
              : "text-slate-500 group-hover:text-slate-300"
          }`}
        />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    );
  };

  return (
    <aside
      className={`fixed top-0 left-0 h-screen bg-slate-900 border-r border-slate-800 flex flex-col z-40 transition-all duration-200
        ${collapsed ? "w-[68px]" : "w-[240px]"}
      `}
    >
      {/* Brand */}
      <div
        className={`flex items-center h-16 px-4 border-b border-slate-800 ${
          collapsed ? "justify-center" : "gap-3"
        }`}
      >
        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
          <Wrench size={18} className="text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="text-white font-bold text-sm truncate leading-tight">
              Field Boss Pro
            </h1>
            <p className="text-slate-500 text-[10px] leading-tight">
              Service Management
            </p>
          </div>
        )}
      </div>

      {/* Main Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavItem key={item.href} item={item} />
        ))}
      </nav>

      {/* Bottom Nav */}
      <div className="px-3 py-4 border-t border-slate-800 space-y-1">
        {bottomItems.map((item) => (
          <NavItem key={item.href} item={item} />
        ))}

        {/* Collapse toggle */}
        <button
          onClick={onToggle}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors w-full"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight size={20} className="flex-shrink-0 mx-auto" />
          ) : (
            <>
              <ChevronLeft size={20} className="flex-shrink-0" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
