"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  CalendarDays,
  Clock,
  MapPin,
  Phone,
  Wrench,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Truck,
} from "lucide-react";

interface PortalData {
  work_order: {
    id: number;
    work_order_number: string;
    status: string;
    job_type: string;
    appliance_type: string[] | null;
    notes: string | null;
    created_at: string;
  };
  customer: {
    customer_name: string;
    service_address: string;
    city: string;
    state: string;
    zip: string;
  } | null;
  technician: {
    id: number;
    tech_name: string;
    phone: string | null;
    last_lat: number | null;
    last_lng: number | null;
    last_location_at: string | null;
  } | null;
  appointment: {
    appointment_date: string;
    start_time: string | null;
    end_time: string | null;
    status: string;
  } | null;
  invoices: {
    id: number;
    invoice_number: string;
    total: number;
    status: string;
    created_at: string;
  }[];
  tenant: {
    name: string;
    contact_phone: string | null;
  } | null;
}

const STATUS_MESSAGES: Record<string, { label: string; tone: "info" | "good" | "warn"; icon: any }> = {
  "New": { label: "We've received your request", tone: "info", icon: AlertCircle },
  "ready_to_schedule": { label: "Ready to schedule", tone: "info", icon: CalendarDays },
  "Scheduled": { label: "Appointment scheduled", tone: "good", icon: CalendarDays },
  "in_progress": { label: "Your tech is on the job", tone: "good", icon: Truck },
  "Parts Ordered": { label: "Parts have been ordered", tone: "warn", icon: Clock },
  "Parts Have Arrived": { label: "Parts have arrived — scheduling next visit", tone: "info", icon: CheckCircle2 },
  "Complete": { label: "Job complete — thank you!", tone: "good", icon: CheckCircle2 },
  "canceled": { label: "This job has been canceled", tone: "warn", icon: AlertCircle },
};

function formatTime(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hour = parseInt(h);
  const suffix = hour >= 12 ? "PM" : "AM";
  const h12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${h12}:${m} ${suffix}`;
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
}

export default function CustomerPortalPage() {
  const params = useParams();
  const token = params.token as string;
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/portal/${token}`);
        if (!res.ok) {
          setError("This link is invalid or has expired.");
          return;
        }
        setData(await res.json());
      } catch {
        setError("Unable to load job status.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handlePay = async (invoiceId: number) => {
    try {
      const res = await fetch("/api/invoices/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: invoiceId }),
      });
      const json = await res.json();
      if (json.url) window.location.href = json.url;
    } catch {}
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center">
          <AlertCircle size={40} className="text-gray-300 mx-auto mb-2" />
          <p className="text-gray-600">{error || "Not found"}</p>
        </div>
      </div>
    );
  }

  const statusMeta = STATUS_MESSAGES[data.work_order.status] || {
    label: data.work_order.status,
    tone: "info" as const,
    icon: AlertCircle,
  };
  const StatusIcon = statusMeta.icon;
  const toneClasses = {
    info: "bg-blue-50 border-blue-200 text-blue-900",
    good: "bg-emerald-50 border-emerald-200 text-emerald-900",
    warn: "bg-amber-50 border-amber-200 text-amber-900",
  }[statusMeta.tone];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto p-4 py-6 space-y-4">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-lg font-bold text-gray-900">{data.tenant?.name || "Service Update"}</h1>
          <p className="text-xs text-gray-500">Work Order #{data.work_order.work_order_number}</p>
        </div>

        {/* Status banner */}
        <div className={`rounded-xl border-2 p-5 ${toneClasses}`}>
          <div className="flex items-center gap-3">
            <StatusIcon size={28} />
            <div>
              <p className="text-xs uppercase tracking-wide opacity-70">Current Status</p>
              <p className="text-lg font-bold">{statusMeta.label}</p>
            </div>
          </div>
        </div>

        {/* Appointment */}
        {data.appointment && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays size={16} className="text-purple-500" />
              <h2 className="text-sm font-semibold text-gray-900">Your Appointment</h2>
            </div>
            <p className="text-base font-bold text-gray-900">
              {formatDate(data.appointment.appointment_date)}
            </p>
            {(data.appointment.start_time || data.appointment.end_time) && (
              <p className="text-sm text-gray-600">
                {formatTime(data.appointment.start_time)}
                {data.appointment.end_time ? ` – ${formatTime(data.appointment.end_time)}` : ""}
              </p>
            )}
          </div>
        )}

        {/* Technician */}
        {data.technician && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Wrench size={16} className="text-indigo-500" />
              <h2 className="text-sm font-semibold text-gray-900">Your Technician</h2>
            </div>
            <p className="text-base font-bold text-gray-900">{data.technician.tech_name}</p>
            {data.technician.phone && (
              <a
                href={`tel:${data.technician.phone}`}
                className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-lg hover:bg-indigo-100"
              >
                <Phone size={14} />
                {data.technician.phone}
              </a>
            )}
          </div>
        )}

        {/* Service Address */}
        {data.customer && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-2">
              <MapPin size={16} className="text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-900">Service Address</h2>
            </div>
            <p className="text-sm text-gray-900">{data.customer.service_address}</p>
            <p className="text-sm text-gray-500">
              {[data.customer.city, data.customer.state, data.customer.zip].filter(Boolean).join(", ")}
            </p>
          </div>
        )}

        {/* Invoices */}
        {data.invoices.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-2">
              <CreditCard size={16} className="text-emerald-500" />
              <h2 className="text-sm font-semibold text-gray-900">Amount Due</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {data.invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between px-5 py-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Invoice #{inv.invoice_number}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(inv.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-bold text-gray-900 mb-1">{formatCurrency(inv.total)}</p>
                    <button
                      onClick={() => handlePay(inv.id)}
                      className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700"
                    >
                      Pay Now
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Contact */}
        {data.tenant?.contact_phone && (
          <div className="text-center py-4">
            <p className="text-xs text-gray-500 mb-1">Questions?</p>
            <a
              href={`tel:${data.tenant.contact_phone}`}
              className="inline-flex items-center gap-1.5 text-indigo-600 font-medium text-sm"
            >
              <Phone size={14} /> Call {data.tenant.contact_phone}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
