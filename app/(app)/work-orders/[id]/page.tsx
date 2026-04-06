"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { useSoftphone } from "@/app/(app)/layout";
import {
  ArrowLeft,
  User,
  MapPin,
  Phone,
  PhoneCall,
  Mail,
  CalendarDays,
  Clock,
  Wrench,
  Plus,
  Save,
  FileText,
  MessageSquare,
  Send,
  Camera,
  X,
} from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  "New": { label: "New", bg: "bg-blue-100", text: "text-blue-700", dot: "bg-blue-500" },
  "Parts Ordered": { label: "Parts Ordered", bg: "bg-amber-100", text: "text-amber-700", dot: "bg-amber-500" },
  "Parts Have Arrived": { label: "Parts Arrived", bg: "bg-teal-100", text: "text-teal-700", dot: "bg-teal-500" },
  "Scheduled": { label: "Scheduled", bg: "bg-purple-100", text: "text-purple-700", dot: "bg-purple-500" },
  "Complete": { label: "Complete", bg: "bg-green-100", text: "text-green-700", dot: "bg-green-500" },
};

const statusOptions = ["New", "Parts Ordered", "Parts Have Arrived", "Scheduled", "Complete"];

interface ApplianceDetails {
  make: string;
  item: string;
  model: string;
  serial: string;
  age: string;
  diagnosis: string;
  cause: string;
  fix: string;
  parts: string;
}

interface ActivityNote {
  id: string;
  text: string;
  author: string;
  timestamp: string;
}

export default function WorkOrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const workOrderId = params.id as string;
  const { tenantUser } = useAuth();
  const { openSoftphone } = useSoftphone();

  const [workOrder, setWorkOrder] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [technicians, setTechnicians] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [photos, setPhotos] = useState<any[]>([]);

  // Form state
  const [status, setStatus] = useState("New");
  const [assignedTechId, setAssignedTechId] = useState("");
  const [serviceDate, setServiceDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("11:00");
  const [notes, setNotes] = useState("");

  // Appliance details (stored in description as JSON)
  const [appliance, setAppliance] = useState<ApplianceDetails>({
    make: "", item: "", model: "", serial: "",
    age: "", diagnosis: "", cause: "", fix: "", parts: "",
  });

  // Activity feed
  const [activityNotes, setActivityNotes] = useState<ActivityNote[]>([]);
  const [newNote, setNewNote] = useState("");

  const fetchWorkOrder = useCallback(async () => {
    if (!tenantUser) return;
    try {
      const { data, error: fetchError } = await supabase
        .from("work_orders")
        .select(`
          *,
          customer:customers(*),
          technician:technicians(tech_name, phone, email)
        `)
        .eq("id", workOrderId)
        .eq("tenant_id", tenantUser.tenant_id)
        .single();

      if (fetchError) throw fetchError;
      setWorkOrder(data);
      setStatus(data.status || "New");
      setAssignedTechId(data.assigned_technician_id || "");
      setServiceDate(data.service_date || "");
      setNotes(data.notes || "");

      // Parse appliance details from description (JSON)
      if (data.description) {
        try {
          const parsed = JSON.parse(data.description);
          if (parsed.appliance) setAppliance(parsed.appliance);
          if (parsed.activity) setActivityNotes(parsed.activity);
        } catch {
          // description is plain text, not JSON
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [tenantUser, workOrderId]);

  const fetchTechs = useCallback(async () => {
    if (!tenantUser) return;
    const { data } = await supabase
      .from("technicians")
      .select("id, tech_name")
      .eq("tenant_id", tenantUser.tenant_id)
      .eq("is_active", true)
      .order("tech_name");
    if (data) setTechnicians(data);
  }, [tenantUser]);

  const fetchPhotos = useCallback(async () => {
    if (!tenantUser) return;
    const { data } = await supabase
      .from("work_order_photos")
      .select("*")
      .eq("work_order_id", workOrderId)
      .order("created_at", { ascending: false });
    if (data) setPhotos(data);
  }, [tenantUser, workOrderId]);

  const fetchAppointments = useCallback(async () => {
    if (!tenantUser) return;
    const { data } = await supabase
      .from("appointments")
      .select(`*, technician:technicians(tech_name)`)
      .eq("tenant_id", tenantUser.tenant_id)
      .eq("work_order_id", workOrderId)
      .order("appointment_date", { ascending: true });
    if (data) setAppointments(data);
  }, [tenantUser, workOrderId]);

  useEffect(() => {
    fetchWorkOrder();
    fetchTechs();
    fetchAppointments();
    fetchPhotos();
  }, [fetchWorkOrder, fetchTechs, fetchAppointments, fetchPhotos]);

  const handleSave = async () => {
    setError("");
    setSuccessMsg("");
    setIsSaving(true);

    try {
      // Build description JSON
      const descriptionData = JSON.stringify({
        appliance,
        activity: activityNotes,
      });

      // Auto-set job type based on status
      let autoJobType = workOrder?.job_type;
      if (status === "New") autoJobType = "Diagnosis";
      if (status === "Parts Have Arrived") autoJobType = "Repair Follow-up";

      const { error: updateError } = await supabase
        .from("work_orders")
        .update({
          status,
          job_type: autoJobType,
          assigned_technician_id: assignedTechId || null,
          service_date: serviceDate || null,
          notes,
          description: descriptionData,
        })
        .eq("id", workOrderId)
        .eq("tenant_id", tenantUser?.tenant_id);

      if (updateError) throw updateError;

      // Auto-cancel appointments when status changes FROM Scheduled to something else
      const oldStatus = workOrder?.status;
      if (oldStatus === "Scheduled" && status !== "Scheduled") {
        // Delete scheduled appointments and clean up capacity
        const { data: oldAppts } = await supabase
          .from("appointments")
          .select("id, appointment_date, technician_id")
          .eq("work_order_id", workOrderId)
          .eq("status", "scheduled");

        for (const appt of oldAppts || []) {
          const { data: cap } = await supabase
            .from("tech_daily_capacity")
            .select("id, current_appointments")
            .eq("technician_id", appt.technician_id)
            .eq("date", appt.appointment_date)
            .single();

          if (cap) {
            const newCount = Math.max(0, (cap.current_appointments || 1) - 1);
            if (newCount === 0) {
              await supabase.from("tech_daily_capacity").delete().eq("id", cap.id);
            } else {
              await supabase.from("tech_daily_capacity").update({ current_appointments: newCount }).eq("id", cap.id);
            }
          }
          await supabase.from("appointments").delete().eq("id", appt.id);
        }

        // Clear service date
        await supabase.from("work_orders").update({ service_date: null }).eq("id", workOrderId);
      }

      // Fire SMS notification if status changed
      if (oldStatus && oldStatus !== status) {
        try {
          const notifRes = await fetch("/api/notifications/status-change", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              work_order_id: workOrderId,
              tenant_id: tenantUser?.tenant_id,
              old_status: oldStatus,
              new_status: status,
            }),
          });
          const notifData = await notifRes.json();
          if (notifData.success) {
            setSuccessMsg(`Saved & SMS sent to customer (${notifData.to})`);
          } else if (notifData.skipped) {
            setSuccessMsg(`Saved (SMS skipped: ${notifData.reason})`);
          } else {
            setSuccessMsg("Saved (SMS failed — check logs)");
          }
        } catch {
          setSuccessMsg("Saved (SMS notification error)");
        }
      } else {
        setSuccessMsg("Saved successfully");
      }

      setTimeout(() => setSuccessMsg(""), 5000);
      await fetchWorkOrder();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const cancelAppointment = async (apptId: number, apptDate: string, techId: number | null) => {
    const newStatus = window.prompt(
      "Cancel this appointment. What status should the work order change to?\n\nOptions: New, Parts Ordered, Parts Have Arrived, Complete\n\nType the status:",
      "Parts Have Arrived"
    );
    if (!newStatus) return;

    const validStatuses = ["New", "Parts Ordered", "Parts Have Arrived", "Scheduled", "Complete"];
    if (!validStatuses.includes(newStatus)) {
      setError("Invalid status. Use: " + validStatuses.join(", "));
      return;
    }

    try {
      // Delete the appointment
      await supabase.from("appointments").delete().eq("id", apptId);

      // Decrement capacity
      if (techId) {
        const { data: cap } = await supabase
          .from("tech_daily_capacity")
          .select("id, current_appointments")
          .eq("technician_id", techId)
          .eq("date", apptDate)
          .single();

        if (cap) {
          const newCount = Math.max(0, (cap.current_appointments || 1) - 1);
          if (newCount === 0) {
            await supabase.from("tech_daily_capacity").delete().eq("id", cap.id);
          } else {
            await supabase.from("tech_daily_capacity").update({ current_appointments: newCount }).eq("id", cap.id);
          }
        }
      }

      // Update WO status
      await supabase
        .from("work_orders")
        .update({ status: newStatus, service_date: null })
        .eq("id", workOrderId);

      setStatus(newStatus);
      setSuccessMsg(`Appointment canceled. Status changed to ${newStatus}.`);
      setTimeout(() => setSuccessMsg(""), 5000);
      await fetchWorkOrder();
      await fetchAppointments();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const createAppointment = async () => {
    if (!serviceDate) {
      setError("Set a service date first");
      return;
    }
    const { error: insertError } = await supabase.from("appointments").insert({
      tenant_id: tenantUser?.tenant_id,
      work_order_id: workOrderId,
      technician_id: assignedTechId || workOrder?.assigned_technician_id || null,
      appointment_date: serviceDate,
      start_time: startTime,
      end_time: endTime,
      status: "scheduled",
    });
    if (insertError) {
      setError("Appointment failed: " + insertError.message);
      return;
    }
    await fetchAppointments();
  };

  const addActivityNote = () => {
    if (!newNote.trim()) return;
    const note: ActivityNote = {
      id: Date.now().toString(),
      text: newNote.trim(),
      author: tenantUser?.first_name
        ? `${tenantUser.first_name} ${tenantUser.last_name || ""}`
        : tenantUser?.email || "User",
      timestamp: new Date().toISOString(),
    };
    setActivityNotes((prev) => [note, ...prev]);
    setNewNote("");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!workOrder) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-gray-500">Work order not found.</p>
      </div>
    );
  }

  const customer = workOrder.customer;
  const statusCfg = STATUS_CONFIG[workOrder.status] || STATUS_CONFIG["New"];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                {workOrder.work_order_number}
              </h1>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${statusCfg.bg} ${statusCfg.text}`}
              >
                <span className={`w-2 h-2 rounded-full ${statusCfg.dot}`} />
                {statusCfg.label}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              Created {new Date(workOrder.created_at).toLocaleDateString("en-US", {
                month: "long", day: "numeric", year: "numeric",
              })}
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
        >
          <Save size={16} />
          {isSaving ? "Saving..." : "Save Changes"}
        </button>
        <Link
          href={`/invoices/new?wo=${workOrderId}`}
          className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 shadow-sm"
        >
          <FileText size={16} />
          Create Invoice
        </Link>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      {successMsg && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-700">{successMsg}</p>
        </div>
      )}

      {/* Top Info Cards: Customer / Service Location / Contact */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Customer Info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <User size={16} className="text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer</h3>
          </div>
          <Link
            href={`/customers/${workOrder.customer_id}`}
            className="text-base font-semibold text-indigo-600 hover:text-indigo-700"
          >
            {customer?.customer_name || "—"}
          </Link>
          {customer?.email && (
            <p className="text-sm text-gray-500 mt-1">{customer.email}</p>
          )}
        </div>

        {/* Service Location */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <MapPin size={16} className="text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Service Location</h3>
          </div>
          <p className="text-sm text-gray-900 font-medium">
            {customer?.service_address || "—"}
          </p>
          <p className="text-sm text-gray-500">
            {[customer?.city, customer?.state, customer?.zip].filter(Boolean).join(", ")}
          </p>
        </div>

        {/* Contact Info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Phone size={16} className="text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</h3>
          </div>
          {customer?.phone ? (
            <div className="flex items-center gap-2">
              <a href={`tel:${customer.phone}`} className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700">
                <Phone size={14} /> {customer.phone}
              </a>
              <button
                onClick={() => openSoftphone(customer.phone, customer.customer_name)}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100 transition"
              >
                <PhoneCall size={12} />
                Call
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No phone</p>
          )}
          {customer?.email && (
            <a href={`mailto:${customer.email}`} className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700 mt-1">
              <Mail size={14} /> {customer.email}
            </a>
          )}
        </div>
      </div>

      {/* Main Content: 2-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Details */}
        <div className="lg:col-span-2 space-y-6">

          {/* Work Order Details */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Work Order Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-medium"
                >
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_CONFIG[s]?.label || s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Job Type</label>
                <p className="px-3 py-2 text-sm text-gray-900 bg-gray-50 rounded-lg border border-gray-200">
                  {workOrder.job_type || "—"} <span className="text-gray-400 text-xs">(auto-set by status)</span>
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Appliance Type</label>
                <select
                  value={workOrder.appliance_type || ""}
                  onChange={async (e) => {
                    await supabase.from("work_orders").update({ appliance_type: e.target.value }).eq("id", workOrderId);
                    await fetchWorkOrder();
                  }}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                >
                  <option value="">Select...</option>
                  <option value="Refrigerator">Refrigerator</option>
                  <option value="Washer">Washer</option>
                  <option value="Dryer">Dryer</option>
                  <option value="Dishwasher">Dishwasher</option>
                  <option value="Cooktop">Cooktop</option>
                  <option value="Oven">Oven</option>
                  <option value="Range">Range</option>
                  <option value="Microwave">Microwave</option>
                  <option value="Freezer">Freezer</option>
                  <option value="Ice Maker">Ice Maker</option>
                  <option value="Garbage Disposal">Garbage Disposal</option>
                  <option value="Range Hood">Range Hood</option>
                  <option value="Wine Cooler">Wine Cooler</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Source</label>
                <select
                  value={workOrder.source || ""}
                  onChange={async (e) => {
                    await supabase.from("work_orders").update({ source: e.target.value }).eq("id", workOrderId);
                    await fetchWorkOrder();
                  }}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                >
                  <option value="">Select...</option>
                  <option value="AHS">AHS (American Home Shield)</option>
                  <option value="Google">Google</option>
                  <option value="Facebook">Facebook</option>
                  <option value="Referral">Referral</option>
                  <option value="Website">Website</option>
                  <option value="Walk-in">Walk-in</option>
                  <option value="Repeat Customer">Repeat Customer</option>
                  <option value="Other Warranty">Other Warranty</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                placeholder="Add work order notes..."
              />
            </div>

            {/* Photos */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-gray-500 uppercase">Photos</label>
                <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 cursor-pointer">
                  <Camera size={14} />
                  Add Photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const fileName = `${workOrderId}/${Date.now()}-${file.name}`;
                      const { error: uploadErr } = await supabase.storage
                        .from("work-order-photos")
                        .upload(fileName, file);
                      if (uploadErr) { setError("Upload failed: " + uploadErr.message); return; }
                      const { data: urlData } = supabase.storage
                        .from("work-order-photos")
                        .getPublicUrl(fileName);
                      await supabase.from("work_order_photos").insert({
                        work_order_id: parseInt(workOrderId),
                        tenant_id: tenantUser?.tenant_id,
                        file_url: urlData.publicUrl,
                        file_name: file.name,
                      });
                      fetchPhotos();
                    }}
                  />
                </label>
              </div>
              {photos.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-3 bg-gray-50 rounded-lg border border-dashed border-gray-300">No photos yet</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((photo: any) => (
                    <div key={photo.id} className="relative group">
                      <img
                        src={photo.file_url}
                        alt={photo.file_name || "Photo"}
                        className="w-full h-24 object-cover rounded-lg border border-gray-200"
                      />
                      <button
                        onClick={async () => {
                          await supabase.from("work_order_photos").delete().eq("id", photo.id);
                          fetchPhotos();
                        }}
                        className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Assign & Schedule */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Assign & Schedule</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Assigned Technician</label>
                <select
                  value={assignedTechId}
                  onChange={(e) => setAssignedTechId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                >
                  <option value="">Unassigned</option>
                  {technicians.map((t) => (
                    <option key={t.id} value={t.id}>{t.tech_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Service Date</label>
                <input
                  type="date"
                  value={serviceDate}
                  onChange={(e) => setServiceDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Start Time</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">End Time</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                />
              </div>
            </div>

            <button
              onClick={createAppointment}
              className="mt-4 flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
            >
              <CalendarDays size={16} />
              Create Appointment
            </button>

            {/* Existing Appointments */}
            {appointments.length > 0 && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Scheduled Appointments</h3>
                <div className="space-y-2">
                  {appointments.map((appt) => (
                    <div
                      key={appt.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      <div className="flex items-center gap-3">
                        <CalendarDays size={16} className="text-purple-500" />
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {new Date(appt.appointment_date + "T00:00:00").toLocaleDateString("en-US", {
                              weekday: "short", month: "short", day: "numeric",
                            })}
                            {appt.start_time && ` ${appt.start_time.slice(0, 5)}`}
                            {appt.end_time && ` - ${appt.end_time.slice(0, 5)}`}
                          </p>
                          <p className="text-xs text-gray-500">
                            {appt.technician?.tech_name || "Unassigned"} &middot;{" "}
                            <span className="capitalize">{appt.status}</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/scheduling?date=${appt.appointment_date}`}
                          className="text-xs text-indigo-600 hover:text-indigo-700"
                        >
                          View
                        </Link>
                        <button
                          onClick={() => cancelAppointment(appt.id, appt.appointment_date, appt.technician_id)}
                          className="text-xs text-red-600 hover:text-red-700 font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Appliance Details */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Wrench size={18} className="text-gray-400" />
              <h2 className="text-lg font-semibold text-gray-900">Appliance Details</h2>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {([
                { key: "make", label: "Make" },
                { key: "item", label: "Item" },
                { key: "model", label: "Model" },
                { key: "serial", label: "Serial #" },
                { key: "age", label: "Age" },
              ] as { key: keyof ApplianceDetails; label: string }[]).map((field) => (
                <div key={field.key}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                    {field.label}
                  </label>
                  <input
                    type="text"
                    value={appliance[field.key]}
                    onChange={(e) =>
                      setAppliance({ ...appliance, [field.key]: e.target.value })
                    }
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                    placeholder={field.label}
                  />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-4 mt-4">
              {([
                { key: "diagnosis", label: "Diagnosis" },
                { key: "cause", label: "Cause of Issue" },
                { key: "fix", label: "Fix / Resolution" },
                { key: "parts", label: "Parts Needed" },
              ] as { key: keyof ApplianceDetails; label: string }[]).map((field) => (
                <div key={field.key}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                    {field.label}
                  </label>
                  <textarea
                    value={appliance[field.key]}
                    onChange={(e) =>
                      setAppliance({ ...appliance, [field.key]: e.target.value })
                    }
                    rows={2}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                    placeholder={field.label}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Items / Parts Table */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Items / Parts</h2>
              <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100">
                <Plus size={14} />
                Add Item
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">Part / Item</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">Qty</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">Unit Price</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">
                      No items added yet. Click &quot;Add Item&quot; to start.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column - Activity Feed */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl border border-gray-200 p-5 sticky top-24">
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare size={18} className="text-gray-400" />
              <h2 className="text-lg font-semibold text-gray-900">Activity</h2>
            </div>

            {/* Add Note */}
            <div className="mb-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addActivityNote()}
                  placeholder="Add a note..."
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg"
                />
                <button
                  onClick={addActivityNote}
                  className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  <Send size={16} />
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Press Enter or click send. Save to persist.</p>
            </div>

            {/* Timeline */}
            <div className="space-y-4 max-h-[600px] overflow-y-auto">
              {activityNotes.length === 0 && appointments.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-6">
                  No activity yet
                </p>
              )}

              {/* Notes */}
              {activityNotes.map((note) => (
                <div key={note.id} className="relative pl-6 border-l-2 border-indigo-200">
                  <div className="absolute left-[-5px] top-1 w-2 h-2 rounded-full bg-indigo-500" />
                  <p className="text-sm text-gray-900">{note.text}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {note.author} &middot;{" "}
                    {new Date(note.timestamp).toLocaleString("en-US", {
                      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                    })}
                  </p>
                </div>
              ))}

              {/* Appointment events */}
              {appointments.map((appt) => (
                <div key={`appt-${appt.id}`} className="relative pl-6 border-l-2 border-purple-200">
                  <div className="absolute left-[-5px] top-1 w-2 h-2 rounded-full bg-purple-500" />
                  <p className="text-sm text-gray-900">
                    Appointment {appt.status === "scheduled" ? "scheduled" : appt.status} for{" "}
                    {new Date(appt.appointment_date + "T00:00:00").toLocaleDateString("en-US", {
                      month: "short", day: "numeric",
                    })}
                    {appt.start_time && ` at ${appt.start_time.slice(0, 5)}`}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {appt.technician?.tech_name || "Unassigned"} &middot;{" "}
                    {new Date(appt.created_at).toLocaleString("en-US", {
                      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                    })}
                  </p>
                </div>
              ))}

              {/* Created event */}
              <div className="relative pl-6 border-l-2 border-gray-200">
                <div className="absolute left-[-5px] top-1 w-2 h-2 rounded-full bg-gray-400" />
                <p className="text-sm text-gray-600">Work order created</p>
                <p className="text-xs text-gray-400 mt-1">
                  {new Date(workOrder.created_at).toLocaleString("en-US", {
                    month: "short", day: "numeric", year: "numeric",
                    hour: "numeric", minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
