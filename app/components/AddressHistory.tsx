"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { MapPin, ClipboardList, History } from "lucide-react";

interface Props {
  tenantId: number;
  address: string | null | undefined;
  zip?: string | null;
  excludeCustomerId?: string | number | null;
}

interface HistoryRow {
  id: number;
  work_order_number: string;
  status: string;
  job_type: string | null;
  created_at: string;
  customer_id: number;
  customer_name: string;
}

const STATUS_COLORS: Record<string, string> = {
  "New": "bg-blue-100 text-blue-700",
  "Parts Ordered": "bg-amber-100 text-amber-700",
  "Parts Have Arrived": "bg-teal-100 text-teal-700",
  "Scheduled": "bg-purple-100 text-purple-700",
  "Complete": "bg-green-100 text-green-700",
};

function normalize(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default function AddressHistory({ tenantId, address, zip, excludeCustomerId }: Props) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [otherCustomers, setOtherCustomers] = useState(0);

  useEffect(() => {
    const trimmed = (address || "").trim();
    if (!trimmed || trimmed.length < 5) {
      setRows([]);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const norm = normalize(trimmed);
        const prefix = norm.split(" ").slice(0, 3).join(" ");

        let q = supabase
          .from("customers")
          .select("id, customer_name, service_address, zip")
          .eq("tenant_id", tenantId)
          .ilike("service_address", `%${prefix}%`);
        if (zip) q = q.eq("zip", zip);
        const { data: matches } = await q;

        const sameAddressCustomers = (matches || []).filter((c: any) => normalize(c.service_address || "") === norm);
        const customerIds = sameAddressCustomers
          .map((c: any) => c.id)
          .filter((id: any) => id !== excludeCustomerId);

        if (customerIds.length === 0) {
          setRows([]);
          setOtherCustomers(0);
          return;
        }

        const { data: wos } = await supabase
          .from("work_orders")
          .select("id, work_order_number, status, job_type, created_at, customer_id")
          .eq("tenant_id", tenantId)
          .in("customer_id", customerIds)
          .order("created_at", { ascending: false })
          .limit(25);

        const nameById = new Map(sameAddressCustomers.map((c: any) => [c.id, c.customer_name]));
        setRows(
          (wos || []).map((w: any) => ({
            ...w,
            customer_name: nameById.get(w.customer_id) || "Unknown",
          }))
        );
        setOtherCustomers(customerIds.length);
      } finally {
        setLoading(false);
      }
    })();
  }, [tenantId, address, zip, excludeCustomerId]);

  if (!address || rows.length === 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl">
      <div className="flex items-center justify-between px-5 py-3 border-b border-amber-200">
        <div className="flex items-center gap-2">
          <History size={16} className="text-amber-600" />
          <h3 className="text-sm font-semibold text-amber-900">
            {rows.length} prior job{rows.length === 1 ? "" : "s"} at this address
          </h3>
          {otherCustomers > 0 && (
            <span className="text-xs text-amber-700">
              · under {otherCustomers} other customer{otherCustomers === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {loading && <span className="text-xs text-amber-700">loading…</span>}
      </div>
      <div className="divide-y divide-amber-100">
        {rows.map((r) => (
          <Link
            key={r.id}
            href={`/work-orders/${r.id}`}
            className="flex items-center justify-between px-5 py-2.5 hover:bg-amber-100/50 transition"
          >
            <div className="flex items-center gap-3 min-w-0">
              <ClipboardList size={14} className="text-amber-600 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-indigo-600">{r.work_order_number}</p>
                <p className="text-xs text-gray-600 truncate">
                  {r.customer_name} {r.job_type ? `· ${r.job_type}` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status] || "bg-gray-100 text-gray-700"}`}>
                {r.status}
              </span>
              <span className="text-xs text-gray-500">
                {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
