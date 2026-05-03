"use client";

import React from "react";
import { LucideIcon } from "lucide-react";

interface BossTileProps {
  title: string;
  icon: LucideIcon;
  accent?: "blue" | "amber" | "rose" | "emerald" | "violet" | "slate";
  count?: number | string | null;
  countSuffix?: string;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyText?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}

const ACCENTS: Record<NonNullable<BossTileProps["accent"]>, { ring: string; iconBg: string; iconText: string; count: string }> = {
  blue:    { ring: "border-blue-200",    iconBg: "bg-blue-100",    iconText: "text-blue-700",    count: "text-blue-700" },
  amber:   { ring: "border-amber-200",   iconBg: "bg-amber-100",   iconText: "text-amber-700",   count: "text-amber-700" },
  rose:    { ring: "border-rose-200",    iconBg: "bg-rose-100",    iconText: "text-rose-700",    count: "text-rose-700" },
  emerald: { ring: "border-emerald-200", iconBg: "bg-emerald-100", iconText: "text-emerald-700", count: "text-emerald-700" },
  violet:  { ring: "border-violet-200",  iconBg: "bg-violet-100",  iconText: "text-violet-700",  count: "text-violet-700" },
  slate:   { ring: "border-slate-200",   iconBg: "bg-slate-100",   iconText: "text-slate-700",   count: "text-slate-700" },
};

export default function BossTile({
  title, icon: Icon, accent = "slate",
  count, countSuffix, loading, error, empty, emptyText = "Nothing here.",
  children, footer,
}: BossTileProps) {
  const a = ACCENTS[accent];

  return (
    <div className={`bg-white rounded-xl border ${a.ring} shadow-sm flex flex-col overflow-hidden`}>
      <div className="flex items-start justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`${a.iconBg} ${a.iconText} p-2 rounded-lg shrink-0`}>
            <Icon size={18} />
          </div>
          <h3 className="text-sm font-semibold text-slate-700 truncate">{title}</h3>
        </div>
        {count != null && !loading && !error && (
          <div className={`text-2xl font-bold tabular-nums ${a.count}`}>
            {count}{countSuffix && <span className="text-sm font-medium ml-0.5">{countSuffix}</span>}
          </div>
        )}
      </div>

      <div className="px-4 pb-3 flex-1 min-h-[80px]">
        {loading ? (
          <div className="space-y-2 pt-1 animate-pulse">
            <div className="h-3 bg-slate-100 rounded w-3/4" />
            <div className="h-3 bg-slate-100 rounded w-1/2" />
            <div className="h-3 bg-slate-100 rounded w-2/3" />
          </div>
        ) : error ? (
          <div className="text-xs text-rose-600 pt-2">{error}</div>
        ) : empty ? (
          <div className="text-xs text-slate-400 pt-2 italic">{emptyText}</div>
        ) : (
          children
        )}
      </div>

      {footer && (
        <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500 bg-slate-50">
          {footer}
        </div>
      )}
    </div>
  );
}
