"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { Bell, MessageSquare, Briefcase, CreditCard, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";

type Notification = {
  id: string;
  type: "sms" | "work_order" | "billing" | "stale_parts";
  title: string;
  subtitle: string;
  href: string;
  createdAt: string;
};

const LAST_SEEN_KEY = "fb_notifications_last_seen";

export default function NotificationsBell() {
  const { tenantUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const lastSeen = typeof window !== "undefined"
    ? localStorage.getItem(LAST_SEEN_KEY) || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    : new Date().toISOString();

  const load = useCallback(async () => {
    if (!tenantUser?.tenant_id) return;
    const tenantId = tenantUser.tenant_id;
    const collected: Notification[] = [];

    // Recent inbound SMS (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: smsData } = await supabase
      .from("sms_conversations")
      .select("id, phone, body, created_at, customer:customers(customer_name)")
      .eq("tenant_id", tenantId)
      .eq("direction", "inbound")
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(20);
    if (smsData) {
      for (const m of smsData) {
        const name = (m.customer as any)?.customer_name || m.phone;
        collected.push({
          id: `sms-${m.id}`,
          type: "sms",
          title: `New text from ${name}`,
          subtitle: (m.body || "").slice(0, 80),
          href: "/sms",
          createdAt: m.created_at,
        });
      }
    }

    // Recent work orders (last 7 days, status New)
    const { data: woData } = await supabase
      .from("work_orders")
      .select("id, work_order_number, status, created_at, customer:customers(customer_name)")
      .eq("tenant_id", tenantId)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(20);
    if (woData) {
      for (const wo of woData) {
        collected.push({
          id: `wo-${wo.id}`,
          type: "work_order",
          title: `New work order ${wo.work_order_number}`,
          subtitle: (wo.customer as any)?.customer_name || "",
          href: `/work-orders/${wo.id}`,
          createdAt: wo.created_at,
        });
      }
    }

    // Stale "Parts Ordered" WOs — stuck >5 days
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const { data: staleData } = await supabase
      .from("work_orders")
      .select("id, work_order_number, status_changed_at, customer:customers(customer_name)")
      .eq("tenant_id", tenantId)
      .eq("status", "Parts Ordered")
      .lt("status_changed_at", fiveDaysAgo)
      .order("status_changed_at", { ascending: true })
      .limit(20);
    if (staleData) {
      for (const wo of staleData) {
        const days = Math.floor((Date.now() - new Date(wo.status_changed_at).getTime()) / (24 * 60 * 60 * 1000));
        collected.push({
          id: `stale-${wo.id}`,
          type: "stale_parts",
          title: `${wo.work_order_number} — Parts Ordered ${days}d`,
          subtitle: `Follow up: ${(wo.customer as any)?.customer_name || ""}`,
          href: `/work-orders/${wo.id}`,
          createdAt: wo.status_changed_at,
        });
      }
    }

    // Past-due / billing alerts (subscription health)
    const { data: tenant } = await supabase
      .from("tenants")
      .select("subscription_status, payment_failed_at")
      .eq("id", tenantId)
      .single();
    if (tenant?.subscription_status === "past_due" && tenant.payment_failed_at) {
      collected.push({
        id: `billing-past-due`,
        type: "billing",
        title: "Payment failed",
        subtitle: "Update your card to avoid losing access",
        href: "/dashboard/billing",
        createdAt: tenant.payment_failed_at,
      });
    }

    collected.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    setItems(collected.slice(0, 10));
    setUnreadCount(collected.filter((n) => n.createdAt > lastSeen).length);
  }, [tenantUser?.tenant_id, lastSeen]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = () => {
    setOpen(!open);
    if (!open) {
      // Mark as seen when they open the dropdown
      const now = new Date().toISOString();
      localStorage.setItem(LAST_SEEN_KEY, now);
      setUnreadCount(0);
    }
  };

  const iconFor = (type: Notification["type"]) => {
    if (type === "sms") return <MessageSquare size={14} className="text-indigo-600" />;
    if (type === "work_order") return <Briefcase size={14} className="text-green-600" />;
    if (type === "stale_parts") return <AlertTriangle size={14} className="text-orange-600" />;
    return <CreditCard size={14} className="text-amber-600" />;
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-lg z-50 max-h-[480px] overflow-y-auto">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">No recent activity</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {items.map((n) => (
                <Link
                  key={n.id}
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className="block px-4 py-3 hover:bg-gray-50"
                >
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5">{iconFor(n.type)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{n.title}</p>
                      {n.subtitle && (
                        <p className="text-xs text-gray-500 truncate">{n.subtitle}</p>
                      )}
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {timeAgo(n.createdAt)}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
