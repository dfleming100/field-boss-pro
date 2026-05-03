"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useTenantPlan } from "@/lib/useTenantPlan";
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
  MessageSquare,
  LayoutDashboard,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  techHidden?: boolean; // hide from technician role
}

const navItems: NavItem[] = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "Boss Board", href: "/boss-board", icon: LayoutDashboard, techHidden: true },
  { label: "Leads", href: "/leads", icon: Funnel, techHidden: true },
  { label: "Customers", href: "/customers", icon: Users },
  { label: "Technicians", href: "/people", icon: Wrench, techHidden: true },
  { label: "Work Orders", href: "/work-orders", icon: ClipboardList },
  { label: "SMS Center", href: "/sms", icon: MessageSquare, techHidden: true },
  { label: "Map", href: "/map", icon: MapPin, techHidden: true },
  { label: "Scheduling", href: "/scheduling", icon: CalendarDays },
  { label: "Invoices", href: "/invoices", icon: FileText, techHidden: true },
  { label: "Payments", href: "/payments", icon: CreditCard, techHidden: true },
  { label: "Reports", href: "/reports", icon: BarChart3, techHidden: true },
];

const bottomItems = [
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "Help Center", href: "/help", icon: HelpCircle },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export default function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const { tenantUser } = useAuth();
  const { isPaid } = useTenantPlan();
  const isTech = tenantUser?.role === "technician";

  // Tier-gated Home swap:
  //   Paid plans → Home points at /boss-board, the standalone Boss Board nav
  //                item disappears (it IS Home now, no need to list twice)
  //   Free plans → Home stays /dashboard, Boss Board entirely hidden
  // Techs always get the basic dashboard regardless of tier — they don't
  // need the ops view.
  const showBossBoardAsHome = isPaid && !isTech;
  const visibleNavItems = navItems
    .filter((item) => !(isTech && item.techHidden))
    .filter((item) => item.href !== "/boss-board") // never show as separate item; merged with Home below
    .map((item) => {
      if (item.href === "/dashboard" && showBossBoardAsHome) {
        return { ...item, href: "/boss-board" };
      }
      return item;
    });

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    if (href === "/boss-board") return pathname === "/boss-board";
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
        onClick={() => onMobileClose?.()}
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
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onMobileClose}
          aria-label="Close menu"
        />
      )}
    <aside
      className={`fixed top-0 left-0 h-screen bg-slate-900 border-r border-slate-800 flex flex-col z-50 transition-all duration-200
        ${collapsed ? "md:w-[68px]" : "md:w-[240px]"}
        w-[260px]
        md:translate-x-0
        ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
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
        {visibleNavItems.map((item) => (
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
    </>
  );
}
