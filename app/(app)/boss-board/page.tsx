"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { ClipboardList, Flame, CalendarDays, MessageCircle, Gauge, Package, RefreshCw, DollarSign, Receipt, UserCheck, TrendingUp, AlertTriangle, Wrench } from "lucide-react";
import BossTile from "@/app/components/BossTile";

type WORow = {
  id: number;
  work_order_number: string;
  customer_name: string;
  appliance_type: string | null;
  status: string;
  status_changed_at: string | null;
  created_at: string;
  outreach_count: number | null;
};

type TodayApptByTech = {
  tech_id: number;
  tech_name: string;
  max_daily: number;
  appts: { id: number; start_time: string | null; customer_name: string; wo_id: number; wo_number: string }[];
};

type OutreachBuckets = {
  never: number;
  cold: number;
  replied_unbooked: number;
  booked: number;
};

type CapacityRow = {
  tech_id: number;
  tech_name: string;
  today_booked: number;
  today_max: number;
  week_booked: number;
  week_max: number;
};

type PartsRow = {
  ordered_count: number;
  ordered_avg_days: number;
  arrived_count: number;
  arrived_avg_days: number;
};

type RevenueRow = { today: number; week: number; month: number };

type ARRow = {
  bucket_0_30: number; count_0_30: number;
  bucket_31_60: number; count_31_60: number;
  bucket_60_plus: number; count_60_plus: number;
  total_outstanding: number;
};

type AltContactRow = {
  wo_id: number;
  wo_number: string;
  customer_name: string;
  alt_contact_name: string;
  alt_contact_phone: string;
  alt_contact_relationship: string | null;
  appliance_type: string | null;
  hours_since: number;
};

type SourceVelocityRow = { source: string; today: number; week: number };

type WatchlistRow = {
  phone: string;
  customer_name: string;
  reasons: string[];      // ["fallback", "paused", "long", "stop"]
  turn_count: number;
  last_at: string;
};

const WATCHLIST_LOOKBACK_HOURS = 48;
const WATCHLIST_LONG_THRESHOLD = 6;
const STOP_KEYWORDS = ["stop", "no thanks", "no thank you", "remove me", "unsubscribe", "cancel", "leave me alone"];
const FALLBACK_MARKER = "Please call us at"; // matches both "can't pull availability" and "find a time" fallbacks

const HOT_DAYS_THRESHOLD = 3;

function fmtMoney(cents: number): string {
  // total is stored as numeric (dollars), not cents
  return `$${cents.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function hoursAgo(iso: string | null): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 3600000);
}

function normalizeSource(source: string | null, warranty: string | null): string {
  const s = (source || warranty || "").trim().toLowerCase();
  if (!s) return "Direct";
  if (s.includes("ahs")) return "AHS";
  if (s.includes("fahw") || s.includes("first american")) return "FAHW";
  if (s.includes("walk")) return "Walk-in";
  if (s.includes("google") || s.includes("web")) return "Google";
  if (s.includes("referral")) return "Referral";
  return source || warranty || "Direct";
}

function daysAgo(iso: string | null): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 86400000);
}

function todayCT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function plusDaysCT(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function fmtTime(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hh = parseInt(h, 10);
  const ampm = hh >= 12 ? "PM" : "AM";
  const hh12 = hh % 12 || 12;
  return `${hh12}:${m} ${ampm}`;
}

export default function BossBoardPage() {
  const { tenantUser } = useAuth();

  const [unscheduled, setUnscheduled] = useState<WORow[]>([]);
  const [unscheduledRepairs, setUnscheduledRepairs] = useState<WORow[]>([]);
  const [hotList, setHotList] = useState<WORow[]>([]);
  const [todaySched, setTodaySched] = useState<TodayApptByTech[]>([]);
  const [outreach, setOutreach] = useState<OutreachBuckets>({ never: 0, cold: 0, replied_unbooked: 0, booked: 0 });
  const [capacity, setCapacity] = useState<CapacityRow[]>([]);
  const [parts, setParts] = useState<PartsRow>({ ordered_count: 0, ordered_avg_days: 0, arrived_count: 0, arrived_avg_days: 0 });
  const [revenue, setRevenue] = useState<RevenueRow>({ today: 0, week: 0, month: 0 });
  const [ar, setAr] = useState<ARRow>({ bucket_0_30: 0, count_0_30: 0, bucket_31_60: 0, count_31_60: 0, bucket_60_plus: 0, count_60_plus: 0, total_outstanding: 0 });
  const [altContacts, setAltContacts] = useState<AltContactRow[]>([]);
  const [velocity, setVelocity] = useState<SourceVelocityRow[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistRow[]>([]);

  const [loading, setLoading] = useState({ u: true, ur: true, h: true, t: true, o: true, c: true, p: true, r: true, a: true, ac: true, v: true, w: true });
  const [errors, setErrors] = useState<{ [k: string]: string | null }>({});
  const [refreshedAt, setRefreshedAt] = useState<Date>(new Date());

  // ── Tile 1: Unscheduled New WOs ──────────────────────────────────────────
  const fetchUnscheduled = useCallback(async () => {
    if (!tenantUser) return;
    setLoading((s) => ({ ...s, u: true }));
    try {
      const { data, error } = await supabase
        .from("work_orders")
        .select(`id, work_order_number, appliance_type, status, status_changed_at, created_at, outreach_count,
          customer:customers(customer_name), appointments(id, status)`)
        .eq("tenant_id", tenantUser.tenant_id)
        .in("status", ["New", "New Hold"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      const filtered: WORow[] = (data || [])
        .filter((wo: any) => !(wo.appointments || []).some((a: any) => a.status === "scheduled"))
        .map((wo: any) => ({
          id: wo.id, work_order_number: wo.work_order_number,
          customer_name: wo.customer?.customer_name || "—",
          appliance_type: wo.appliance_type, status: wo.status,
          status_changed_at: wo.status_changed_at, created_at: wo.created_at,
          outreach_count: wo.outreach_count,
        }));
      setUnscheduled(filtered);
      setErrors((e) => ({ ...e, u: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, u: (e as Error).message }));
    } finally {
      setLoading((s) => ({ ...s, u: false }));
    }
  }, [tenantUser]);

  // ── Tile 1b: Unscheduled Repair Follow-ups ──────────────────────────────
  // Different lens from Hot List: ALL Repair Follow-ups in any non-terminal
  // status that have no scheduled appointment yet, not just the
  // Parts-Have-Arrived-3-days-stuck subset. Catches the early-stage ones
  // (Parts Ordered) before they become Hot List items.
  const fetchUnscheduledRepairs = useCallback(async () => {
    if (!tenantUser) return;
    setLoading((s) => ({ ...s, ur: true }));
    try {
      const { data, error } = await supabase
        .from("work_orders")
        .select(`id, work_order_number, appliance_type, status, status_changed_at, created_at, outreach_count,
          customer:customers(customer_name), appointments(id, status)`)
        .eq("tenant_id", tenantUser.tenant_id)
        .eq("job_type", "Repair Follow-up")
        .in("status", ["New", "Parts Ordered", "Parts Have Arrived", "Parts Needed"])
        .order("status_changed_at", { ascending: true });
      if (error) throw error;
      const filtered: WORow[] = (data || [])
        .filter((wo: any) => !(wo.appointments || []).some((a: any) => a.status === "scheduled"))
        .map((wo: any) => ({
          id: wo.id, work_order_number: wo.work_order_number,
          customer_name: wo.customer?.customer_name || "—",
          appliance_type: wo.appliance_type, status: wo.status,
          status_changed_at: wo.status_changed_at, created_at: wo.created_at,
          outreach_count: wo.outreach_count,
        }));
      setUnscheduledRepairs(filtered);
      setErrors((e) => ({ ...e, ur: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, ur: (e as Error).message }));
    } finally {
      setLoading((s) => ({ ...s, ur: false }));
    }
  }, [tenantUser]);

  // ── Tile 2: Hot List ────────────────────────────────────────────────────
  const fetchHotList = useCallback(async () => {
    if (!tenantUser) return;
    setLoading((s) => ({ ...s, h: true }));
    try {
      const cutoff = new Date(Date.now() - HOT_DAYS_THRESHOLD * 86400000).toISOString();
      const { data, error } = await supabase
        .from("work_orders")
        .select(`id, work_order_number, appliance_type, status, status_changed_at, created_at, outreach_count,
          customer:customers(customer_name), appointments(id, status)`)
        .eq("tenant_id", tenantUser.tenant_id)
        .eq("status", "Parts Have Arrived")
        .lte("status_changed_at", cutoff)
        .gt("outreach_count", 0)
        .order("status_changed_at", { ascending: true });
      if (error) throw error;
      const filtered: WORow[] = (data || [])
        .filter((wo: any) => !(wo.appointments || []).some((a: any) => a.status === "scheduled"))
        .map((wo: any) => ({
          id: wo.id, work_order_number: wo.work_order_number,
          customer_name: wo.customer?.customer_name || "—",
          appliance_type: wo.appliance_type, status: wo.status,
          status_changed_at: wo.status_changed_at, created_at: wo.created_at,
          outreach_count: wo.outreach_count,
        }));
      setHotList(filtered);
      setErrors((e) => ({ ...e, h: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, h: (e as Error).message }));
    } finally {
      setLoading((s) => ({ ...s, h: false }));
    }
  }, [tenantUser]);

  // ── Tile 3: Today's Schedule by Tech ────────────────────────────────────
  const fetchTodaySchedule = useCallback(async () => {
    if (!tenantUser) return;
    setLoading((s) => ({ ...s, t: true }));
    try {
      const today = todayCT();
      const [techRes, apptRes] = await Promise.all([
        supabase.from("technicians")
          .select("id, tech_name, max_daily_appointments")
          .eq("tenant_id", tenantUser.tenant_id)
          .eq("is_active", true)
          .order("tech_name"),
        supabase.from("appointments")
          .select(`id, technician_id, start_time, status,
            work_order:work_orders!inner(id, work_order_number, customer:customers(customer_name))`)
          .eq("tenant_id", tenantUser.tenant_id)
          .eq("appointment_date", today)
          .eq("status", "scheduled")
          .order("start_time"),
      ]);
      if (techRes.error) throw techRes.error;
      if (apptRes.error) throw apptRes.error;

      const techs = (techRes.data || []).map((t: any) => ({
        tech_id: t.id,
        tech_name: t.tech_name,
        max_daily: t.max_daily_appointments || 12,
        appts: [] as TodayApptByTech["appts"],
      }));
      const byId: Record<number, TodayApptByTech> = Object.fromEntries(techs.map((t) => [t.tech_id, t]));

      for (const a of (apptRes.data as any[]) || []) {
        const wo = Array.isArray(a.work_order) ? a.work_order[0] : a.work_order;
        const cust = wo && (Array.isArray(wo.customer) ? wo.customer[0] : wo.customer);
        if (byId[a.technician_id]) {
          byId[a.technician_id].appts.push({
            id: a.id,
            start_time: a.start_time,
            customer_name: cust?.customer_name || "—",
            wo_id: wo?.id,
            wo_number: wo?.work_order_number || "",
          });
        }
      }
      setTodaySched(techs);
      setErrors((e) => ({ ...e, t: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, t: (e as Error).message }));
    } finally {
      setLoading((s) => ({ ...s, t: false }));
    }
  }, [tenantUser]);

  // ── Tile 4: Outreach Pipeline ───────────────────────────────────────────
  const fetchOutreach = useCallback(async () => {
    if (!tenantUser) return;
    setLoading((s) => ({ ...s, o: true }));
    try {
      // Outreach is meaningful for WOs that should be talking to the customer:
      // status in ('New','Parts Have Arrived'). Anything completed/scheduled
      // is moved out of the funnel.
      const { data: wos, error } = await supabase
        .from("work_orders")
        .select(`id, status, outreach_count, last_outreach_date, customer_id,
          appointments(id, status)`)
        .eq("tenant_id", tenantUser.tenant_id)
        .in("status", ["New", "Parts Have Arrived"]);
      if (error) throw error;

      // Pull recent inbound SMS (last 30d) once and group by customer_id.
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: inbound } = await supabase
        .from("sms_conversations")
        .select("customer_id, created_at")
        .eq("tenant_id", tenantUser.tenant_id)
        .eq("direction", "inbound")
        .gte("created_at", since);
      const repliedCustomers = new Set((inbound || []).map((m: any) => m.customer_id).filter(Boolean));

      const buckets: OutreachBuckets = { never: 0, cold: 0, replied_unbooked: 0, booked: 0 };

      for (const wo of (wos as any[]) || []) {
        const hasScheduled = (wo.appointments || []).some((a: any) => a.status === "scheduled");
        if (hasScheduled) { buckets.booked++; continue; }

        if (repliedCustomers.has(wo.customer_id)) {
          buckets.replied_unbooked++;
          continue;
        }

        const count = wo.outreach_count || 0;
        if (count === 0) buckets.never++;
        else buckets.cold++;
      }

      setOutreach(buckets);
      setErrors((e) => ({ ...e, o: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, o: (e as Error).message }));
    } finally {
      setLoading((s) => ({ ...s, o: false }));
    }
  }, [tenantUser]);

  // ── Tile 5: Tech Capacity (today + 7-day rolling) ───────────────────────
  const fetchCapacity = useCallback(async () => {
    if (!tenantUser) return;
    setLoading((s) => ({ ...s, c: true }));
    try {
      const today = todayCT();
      const weekEnd = plusDaysCT(7);
      const [techRes, apptRes] = await Promise.all([
        supabase.from("technicians")
          .select("id, tech_name, max_daily_appointments")
          .eq("tenant_id", tenantUser.tenant_id)
          .eq("is_active", true)
          .order("tech_name"),
        supabase.from("appointments")
          .select("technician_id, appointment_date, status")
          .eq("tenant_id", tenantUser.tenant_id)
          .eq("status", "scheduled")
          .gte("appointment_date", today)
          .lt("appointment_date", weekEnd),
      ]);
      if (techRes.error) throw techRes.error;
      if (apptRes.error) throw apptRes.error;

      const rows: CapacityRow[] = (techRes.data || []).map((t: any) => {
        const max = t.max_daily_appointments || 12;
        const techAppts = ((apptRes.data as any[]) || []).filter((a) => a.technician_id === t.id);
        const todayBooked = techAppts.filter((a) => a.appointment_date === today).length;
        const weekBooked = techAppts.length;
        return {
          tech_id: t.id, tech_name: t.tech_name,
          today_booked: todayBooked, today_max: max,
          week_booked: weekBooked, week_max: max * 7,
        };
      });
      setCapacity(rows);
      setErrors((e) => ({ ...e, c: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, c: (e as Error).message }));
    } finally {
      setLoading((s) => ({ ...s, c: false }));
    }
  }, [tenantUser]);

  // ── Tile 6: Parts Pipeline ──────────────────────────────────────────────
  const fetchParts = useCallback(async () => {
    if (!tenantUser) return;
    setLoading((s) => ({ ...s, p: true }));
    try {
      const { data, error } = await supabase
        .from("work_orders")
        .select("id, status, status_changed_at")
        .eq("tenant_id", tenantUser.tenant_id)
        .in("status", ["Parts Ordered", "Parts Have Arrived"]);
      if (error) throw error;

      const ordered = (data || []).filter((w: any) => w.status === "Parts Ordered");
      const arrived = (data || []).filter((w: any) => w.status === "Parts Have Arrived");
      const avgDays = (rows: any[]) =>
        rows.length === 0 ? 0 :
          Math.round(rows.reduce((sum, r) => sum + daysAgo(r.status_changed_at), 0) / rows.length);

      setParts({
        ordered_count: ordered.length, ordered_avg_days: avgDays(ordered),
        arrived_count: arrived.length, arrived_avg_days: avgDays(arrived),
      });
      setErrors((e) => ({ ...e, p: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, p: (e as Error).message }));
    } finally {
      setLoading((s) => ({ ...s, p: false }));
    }
  }, [tenantUser]);

  // ── Tile 7: Revenue Today / Week / Month ────────────────────────────────
  const fetchRevenue = useCallback(async () => {
    if (!tenantUser) return;
    setLoading((s) => ({ ...s, r: true }));
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const { data, error } = await supabase
        .from("invoices")
        .select("total, paid_at")
        .eq("tenant_id", tenantUser.tenant_id)
        .not("paid_at", "is", null)
        .gte("paid_at", startOfMonth);
      if (error) throw error;

      const today = todayCT();
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      let t = 0, w = 0, m = 0;
      for (const inv of (data || []) as any[]) {
        const total = Number(inv.total || 0);
        m += total;
        if (inv.paid_at >= weekAgo) w += total;
        const paidDay = new Date(inv.paid_at).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
        if (paidDay === today) t += total;
      }
      setRevenue({ today: t, week: w, month: m });
      setErrors((e) => ({ ...e, r: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, r: (e as Error).message }));
    } finally {
      setLoading((s) => ({ ...s, r: false }));
    }
  }, [tenantUser]);

  // ── Tile 8: A/R Aging ───────────────────────────────────────────────────
  const fetchAR = useCallback(async () => {
    if (!tenantUser) return;
    setLoading((s) => ({ ...s, a: true }));
    try {
      const { data, error } = await supabase
        .from("invoices")
        .select("total, amount_paid, created_at, status")
        .eq("tenant_id", tenantUser.tenant_id);
      if (error) throw error;

      const buckets = { bucket_0_30: 0, count_0_30: 0, bucket_31_60: 0, count_31_60: 0, bucket_60_plus: 0, count_60_plus: 0, total_outstanding: 0 };
      for (const inv of (data || []) as any[]) {
        const owed = Number(inv.total || 0) - Number(inv.amount_paid || 0);
        if (owed <= 0) continue;
        const days = daysAgo(inv.created_at);
        buckets.total_outstanding += owed;
        if (days <= 30) { buckets.bucket_0_30 += owed; buckets.count_0_30++; }
        else if (days <= 60) { buckets.bucket_31_60 += owed; buckets.count_31_60++; }
        else { buckets.bucket_60_plus += owed; buckets.count_60_plus++; }
      }
      setAr(buckets);
      setErrors((e) => ({ ...e, a: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, a: (e as Error).message }));
    } finally {
      setLoading((s) => ({ ...s, a: false }));
    }
  }, [tenantUser]);

  // ── Tile 9: Alt-Contact Handoffs Awaiting Reply ─────────────────────────
  const fetchAltContacts = useCallback(async () => {
    if (!tenantUser) return;
    setLoading((s) => ({ ...s, ac: true }));
    try {
      const { data: wos, error } = await supabase
        .from("work_orders")
        .select(`id, work_order_number, appliance_type, alt_contact_name, alt_contact_phone, alt_contact_relationship, status, updated_at,
          customer:customers(customer_name)`)
        .eq("tenant_id", tenantUser.tenant_id)
        .not("alt_contact_phone", "is", null)
        .not("status", "in", '("Complete","canceled")')
        .order("updated_at", { ascending: false })
        .limit(20);
      if (error) throw error;

      // Filter to only those whose alt-contact hasn't replied yet (no inbound from that number).
      const altPhones = (wos || []).map((w: any) => w.alt_contact_phone).filter(Boolean);
      const repliedSet = new Set<string>();
      if (altPhones.length > 0) {
        const { data: inbound } = await supabase
          .from("sms_conversations")
          .select("phone")
          .eq("tenant_id", tenantUser.tenant_id)
          .eq("direction", "inbound")
          .in("phone", altPhones);
        for (const m of (inbound || []) as any[]) repliedSet.add(m.phone);
      }

      const rows: AltContactRow[] = (wos || [])
        .filter((w: any) => !repliedSet.has(w.alt_contact_phone))
        .map((w: any) => ({
          wo_id: w.id,
          wo_number: w.work_order_number,
          customer_name: w.customer?.customer_name || "—",
          alt_contact_name: w.alt_contact_name || "—",
          alt_contact_phone: w.alt_contact_phone,
          alt_contact_relationship: w.alt_contact_relationship,
          appliance_type: w.appliance_type,
          hours_since: hoursAgo(w.updated_at),
        }));
      setAltContacts(rows);
      setErrors((e) => ({ ...e, ac: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, ac: (e as Error).message }));
    } finally {
      setLoading((s) => ({ ...s, ac: false }));
    }
  }, [tenantUser]);

  // ── Tile 10: New WO Velocity by source ──────────────────────────────────
  const fetchVelocity = useCallback(async () => {
    if (!tenantUser) return;
    setLoading((s) => ({ ...s, v: true }));
    try {
      const today = todayCT();
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data, error } = await supabase
        .from("work_orders")
        .select("source, warranty_company, created_at")
        .eq("tenant_id", tenantUser.tenant_id)
        .gte("created_at", weekAgo);
      if (error) throw error;

      const grouped: Record<string, { today: number; week: number }> = {};
      for (const wo of (data || []) as any[]) {
        const src = normalizeSource(wo.source, wo.warranty_company);
        if (!grouped[src]) grouped[src] = { today: 0, week: 0 };
        grouped[src].week++;
        const createdDay = new Date(wo.created_at).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
        if (createdDay === today) grouped[src].today++;
      }
      const rows: SourceVelocityRow[] = Object.entries(grouped)
        .map(([source, counts]) => ({ source, ...counts }))
        .sort((a, b) => b.week - a.week);
      setVelocity(rows);
      setErrors((e) => ({ ...e, v: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, v: (e as Error).message }));
    } finally {
      setLoading((s) => ({ ...s, v: false }));
    }
  }, [tenantUser]);

  // ── Tile 11: AI Quality Watchlist ───────────────────────────────────────
  // Surfaces SMS threads that hit ANY of 4 trouble signals in the last 48h:
  //   - fallback: AI emitted a "please call us" reply (slot fetch failed
  //     or the booking guard couldn't recover gracefully)
  //   - paused: admin (or auto-pause) hit the kill switch on the thread
  //   - long: 6+ messages exchanged with no scheduled appointment yet
  //   - stop: customer said "stop", "cancel", "no thanks", "unsubscribe", etc
  // Catches the Bahram / Laurie / Tom-shape failures without needing a
  // separate analytics pipeline.
  const fetchWatchlist = useCallback(async () => {
    if (!tenantUser) return;
    setLoading((s) => ({ ...s, w: true }));
    try {
      const since = new Date(Date.now() - WATCHLIST_LOOKBACK_HOURS * 3600000).toISOString();
      const [convRes, pausedRes] = await Promise.all([
        supabase
          .from("sms_conversations")
          .select("phone, direction, body, created_at, customer_id")
          .eq("tenant_id", tenantUser.tenant_id)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("sms_thread_state")
          .select("phone, ai_paused")
          .eq("tenant_id", tenantUser.tenant_id)
          .eq("ai_paused", true),
      ]);
      if (convRes.error) throw convRes.error;
      const messages = (convRes.data || []) as any[];
      const pausedSet = new Set<string>(((pausedRes.data || []) as any[]).map((r) => r.phone));

      // Group messages by phone
      const byPhone: Record<string, { msgs: any[]; customer_id: number | null; last_at: string }> = {};
      for (const m of messages) {
        if (!m.phone) continue;
        if (!byPhone[m.phone]) {
          byPhone[m.phone] = { msgs: [], customer_id: m.customer_id, last_at: m.created_at };
        }
        byPhone[m.phone].msgs.push(m);
        if (m.customer_id && !byPhone[m.phone].customer_id) byPhone[m.phone].customer_id = m.customer_id;
      }

      // Pull customer names for matched threads
      const customerIds = Array.from(new Set(Object.values(byPhone).map((g) => g.customer_id).filter(Boolean))) as number[];
      const customerNames: Record<number, string> = {};
      if (customerIds.length > 0) {
        const { data: custs } = await supabase
          .from("customers")
          .select("id, customer_name")
          .in("id", customerIds);
        for (const c of (custs || []) as any[]) customerNames[c.id] = c.customer_name;
      }

      // For "long with no booking" check, find which customers DO have a future scheduled appointment
      const todayStr = todayCT();
      const customersWithBooking = new Set<number>();
      if (customerIds.length > 0) {
        const { data: bookedAppts } = await supabase
          .from("appointments")
          .select("work_order:work_orders!inner(customer_id)")
          .eq("tenant_id", tenantUser.tenant_id)
          .eq("status", "scheduled")
          .gte("appointment_date", todayStr);
        for (const a of (bookedAppts || []) as any[]) {
          const wo = Array.isArray(a.work_order) ? a.work_order[0] : a.work_order;
          if (wo?.customer_id) customersWithBooking.add(wo.customer_id);
        }
      }

      const rows: WatchlistRow[] = [];
      for (const [phone, group] of Object.entries(byPhone)) {
        const reasons: string[] = [];
        const turnCount = group.msgs.length;
        const hasFallback = group.msgs.some((m) => m.direction === "outbound" && (m.body || "").includes(FALLBACK_MARKER));
        const isPaused = pausedSet.has(phone);
        const lastInbound = group.msgs.find((m) => m.direction === "inbound");
        const lastInboundLower = (lastInbound?.body || "").toLowerCase();
        const hitStop = STOP_KEYWORDS.some((kw) => lastInboundLower.includes(kw));
        const isLong = turnCount >= WATCHLIST_LONG_THRESHOLD &&
          (!group.customer_id || !customersWithBooking.has(group.customer_id));

        if (hasFallback) reasons.push("fallback");
        if (isPaused) reasons.push("paused");
        if (isLong) reasons.push("long");
        if (hitStop) reasons.push("stop");

        if (reasons.length === 0) continue;

        rows.push({
          phone,
          customer_name: group.customer_id ? (customerNames[group.customer_id] || phone) : phone,
          reasons,
          turn_count: turnCount,
          last_at: group.last_at,
        });
      }

      // Worst-first: more reasons = worse, then more recent
      rows.sort((a, b) => {
        if (b.reasons.length !== a.reasons.length) return b.reasons.length - a.reasons.length;
        return b.last_at.localeCompare(a.last_at);
      });
      setWatchlist(rows);
      setErrors((e) => ({ ...e, w: null }));
    } catch (e) {
      setErrors((er) => ({ ...er, w: (e as Error).message }));
    } finally {
      setLoading((s) => ({ ...s, w: false }));
    }
  }, [tenantUser]);

  const refreshAll = useCallback(() => {
    fetchUnscheduled(); fetchUnscheduledRepairs(); fetchHotList(); fetchTodaySchedule();
    fetchOutreach(); fetchCapacity(); fetchParts();
    fetchRevenue(); fetchAR(); fetchAltContacts(); fetchVelocity();
    fetchWatchlist();
    setRefreshedAt(new Date());
  }, [fetchUnscheduled, fetchUnscheduledRepairs, fetchHotList, fetchTodaySchedule, fetchOutreach, fetchCapacity, fetchParts, fetchRevenue, fetchAR, fetchAltContacts, fetchVelocity, fetchWatchlist]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  useEffect(() => {
    if (!tenantUser) return;
    const tid = tenantUser.tenant_id;
    const channel = supabase
      .channel(`boss-board-${tid}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "work_orders", filter: `tenant_id=eq.${tid}` },
        () => refreshAll())
      .on("postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `tenant_id=eq.${tid}` },
        () => refreshAll())
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "sms_conversations", filter: `tenant_id=eq.${tid}` },
        () => { fetchOutreach(); fetchAltContacts(); fetchWatchlist(); })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "sms_thread_state", filter: `tenant_id=eq.${tid}` },
        () => fetchWatchlist())
      .on("postgres_changes",
        { event: "*", schema: "public", table: "invoices", filter: `tenant_id=eq.${tid}` },
        () => { fetchRevenue(); fetchAR(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenantUser, refreshAll, fetchOutreach, fetchAltContacts, fetchRevenue, fetchAR, fetchWatchlist]);

  const totalTodayBooked = capacity.reduce((s, r) => s + r.today_booked, 0);
  const totalTodayMax = capacity.reduce((s, r) => s + r.today_max, 0);
  const todayPct = totalTodayMax === 0 ? 0 : Math.round((totalTodayBooked / totalTodayMax) * 100);
  const totalWeekBooked = capacity.reduce((s, r) => s + r.week_booked, 0);
  const totalWeekMax = capacity.reduce((s, r) => s + r.week_max, 0);
  const weekPct = totalWeekMax === 0 ? 0 : Math.round((totalWeekBooked / totalWeekMax) * 100);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Boss Board</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Live ops view · refreshed {refreshedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </p>
        </div>
        <button onClick={refreshAll}
          className="text-slate-500 hover:text-slate-800 p-2 rounded-lg hover:bg-slate-100 transition"
          aria-label="Refresh">
          <RefreshCw size={18} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* Unscheduled */}
        <BossTile
          title="Unscheduled New WOs" icon={ClipboardList} accent="blue"
          count={unscheduled.length} loading={loading.u} error={errors.u}
          empty={unscheduled.length === 0} emptyText="All new work orders are scheduled."
        >
          <ul className="text-sm divide-y divide-slate-100">
            {unscheduled.slice(0, 5).map((wo) => (
              <li key={wo.id} className="py-2 flex items-center justify-between gap-2">
                <Link href={`/jobs/${wo.id}`} className="min-w-0 flex-1 hover:text-blue-700">
                  <div className="font-medium text-slate-800 truncate">{wo.customer_name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    #{wo.work_order_number}{wo.appliance_type && ` · ${wo.appliance_type}`}
                  </div>
                </Link>
                <div className="text-right shrink-0">
                  <div className="text-xs font-medium text-slate-700">{daysAgo(wo.created_at)}d</div>
                  <div className="text-[10px] text-slate-400">old</div>
                </div>
              </li>
            ))}
          </ul>
          {unscheduled.length > 5 && <div className="text-xs text-slate-500 mt-2">+ {unscheduled.length - 5} more</div>}
        </BossTile>

        {/* Unscheduled Repair Follow-ups */}
        <BossTile
          title="Unscheduled Repair F/U" icon={Wrench} accent="violet"
          count={unscheduledRepairs.length}
          loading={loading.ur} error={errors.ur}
          empty={unscheduledRepairs.length === 0}
          emptyText="All Repair Follow-ups are scheduled."
          footer="Any status (parts ordered/arrived/needed) with no appointment"
        >
          <ul className="text-sm divide-y divide-slate-100">
            {unscheduledRepairs.slice(0, 5).map((wo) => (
              <li key={wo.id} className="py-2 flex items-center justify-between gap-2">
                <Link href={`/jobs/${wo.id}`} className="min-w-0 flex-1 hover:text-violet-700">
                  <div className="font-medium text-slate-800 truncate">{wo.customer_name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    #{wo.work_order_number}{wo.appliance_type && ` · ${wo.appliance_type}`} · {wo.status}
                  </div>
                </Link>
                <div className="text-right shrink-0">
                  <div className="text-xs font-medium text-slate-700">{daysAgo(wo.status_changed_at)}d</div>
                  <div className="text-[10px] text-slate-400">in status</div>
                </div>
              </li>
            ))}
          </ul>
          {unscheduledRepairs.length > 5 && <div className="text-xs text-slate-500 mt-2">+ {unscheduledRepairs.length - 5} more</div>}
        </BossTile>

        {/* Hot List */}
        <BossTile
          title="Hot List" icon={Flame} accent="rose"
          count={hotList.length} loading={loading.h} error={errors.h}
          empty={hotList.length === 0} emptyText="No stuck parts-arrived jobs."
          footer={`Parts arrived ${HOT_DAYS_THRESHOLD}+ days ago, outreached, still unbooked`}
        >
          <ul className="text-sm divide-y divide-slate-100">
            {hotList.slice(0, 5).map((wo) => (
              <li key={wo.id} className="py-2 flex items-center justify-between gap-2">
                <Link href={`/jobs/${wo.id}`} className="min-w-0 flex-1 hover:text-rose-700">
                  <div className="font-medium text-slate-800 truncate">{wo.customer_name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    #{wo.work_order_number}{wo.appliance_type && ` · ${wo.appliance_type}`}
                  </div>
                </Link>
                <div className="text-right shrink-0">
                  <div className="text-xs font-medium text-rose-700">{daysAgo(wo.status_changed_at)}d</div>
                  <div className="text-[10px] text-slate-400">stuck · {wo.outreach_count}x out</div>
                </div>
              </li>
            ))}
          </ul>
          {hotList.length > 5 && <div className="text-xs text-slate-500 mt-2">+ {hotList.length - 5} more</div>}
        </BossTile>

        {/* Today's Schedule by Tech */}
        <BossTile
          title="Today's Schedule" icon={CalendarDays} accent="violet"
          count={todaySched.reduce((s, t) => s + t.appts.length, 0)}
          loading={loading.t} error={errors.t}
          empty={todaySched.length === 0} emptyText="No active technicians."
        >
          <ul className="text-sm divide-y divide-slate-100">
            {todaySched.map((t) => (
              <li key={t.tech_id} className="py-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-slate-800">{t.tech_name}</div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    {t.appts.length}/{t.max_daily}
                  </div>
                </div>
                {t.appts.length > 0 ? (
                  <div className="text-xs text-slate-500 mt-0.5 truncate">
                    First: {fmtTime(t.appts[0].start_time)} · {t.appts[0].customer_name}
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 italic mt-0.5">No appointments</div>
                )}
              </li>
            ))}
          </ul>
        </BossTile>

        {/* Outreach Pipeline */}
        <BossTile
          title="Outreach Pipeline" icon={MessageCircle} accent="amber"
          loading={loading.o} error={errors.o}
        >
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <div className="text-2xl font-bold text-slate-800 tabular-nums">{outreach.never}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Never outreached</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-700 tabular-nums">{outreach.cold}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Cold (no reply)</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-700 tabular-nums">{outreach.replied_unbooked}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Replied, unbooked</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-700 tabular-nums">{outreach.booked}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Booked</div>
            </div>
          </div>
        </BossTile>

        {/* Tech Capacity */}
        <BossTile
          title="Tech Capacity" icon={Gauge} accent="emerald"
          count={`${todayPct}%`} loading={loading.c} error={errors.c}
          empty={capacity.length === 0} emptyText="No active technicians."
          footer={`7-day rolling: ${totalWeekBooked} / ${totalWeekMax} (${weekPct}%)`}
        >
          <ul className="text-sm space-y-1.5">
            {capacity.map((r) => {
              const pct = r.today_max === 0 ? 0 : Math.round((r.today_booked / r.today_max) * 100);
              const barColor = pct >= 100 ? "bg-rose-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500";
              return (
                <li key={r.tech_id}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-700 font-medium truncate">{r.tech_name}</span>
                    <span className="text-slate-500 tabular-nums">{r.today_booked}/{r.today_max}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-0.5">
                    <div className={`h-full ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </BossTile>

        {/* Parts Pipeline */}
        <BossTile
          title="Parts Pipeline" icon={Package} accent="slate"
          loading={loading.p} error={errors.p}
        >
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <div className="text-2xl font-bold text-amber-700 tabular-nums">{parts.ordered_count}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Ordered</div>
              <div className="text-xs text-slate-500 mt-0.5">avg {parts.ordered_avg_days}d stuck</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-teal-700 tabular-nums">{parts.arrived_count}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Arrived</div>
              <div className="text-xs text-slate-500 mt-0.5">avg {parts.arrived_avg_days}d in shop</div>
            </div>
          </div>
        </BossTile>

        {/* Revenue */}
        <BossTile
          title="Revenue" icon={DollarSign} accent="emerald"
          count={fmtMoney(revenue.month)}
          loading={loading.r} error={errors.r}
          footer="Month-to-date"
        >
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <div className="text-xl font-bold text-emerald-700 tabular-nums">{fmtMoney(revenue.today)}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Today</div>
            </div>
            <div>
              <div className="text-xl font-bold text-emerald-700 tabular-nums">{fmtMoney(revenue.week)}</div>
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Last 7 days</div>
            </div>
          </div>
        </BossTile>

        {/* A/R Aging */}
        <BossTile
          title="A/R Outstanding" icon={Receipt} accent="amber"
          count={fmtMoney(ar.total_outstanding)}
          loading={loading.a} error={errors.a}
          empty={ar.total_outstanding === 0}
          emptyText="Nothing outstanding."
        >
          <ul className="text-sm space-y-2 pt-1">
            <li className="flex items-center justify-between">
              <span className="text-slate-700">0–30 days</span>
              <span className="tabular-nums">
                <span className="font-semibold text-slate-800">{fmtMoney(ar.bucket_0_30)}</span>
                <span className="text-xs text-slate-400 ml-1">({ar.count_0_30})</span>
              </span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-slate-700">31–60 days</span>
              <span className="tabular-nums">
                <span className="font-semibold text-amber-700">{fmtMoney(ar.bucket_31_60)}</span>
                <span className="text-xs text-slate-400 ml-1">({ar.count_31_60})</span>
              </span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-slate-700">60+ days</span>
              <span className="tabular-nums">
                <span className="font-semibold text-rose-700">{fmtMoney(ar.bucket_60_plus)}</span>
                <span className="text-xs text-slate-400 ml-1">({ar.count_60_plus})</span>
              </span>
            </li>
          </ul>
        </BossTile>

        {/* Alt-Contact Handoffs Awaiting Reply */}
        <BossTile
          title="Alt-Contact Handoffs" icon={UserCheck} accent="violet"
          count={altContacts.length}
          loading={loading.ac} error={errors.ac}
          empty={altContacts.length === 0}
          emptyText="No alt-contact handoffs awaiting reply."
          footer="Texts sent to spouse / tenant / etc with no response yet"
        >
          <ul className="text-sm divide-y divide-slate-100">
            {altContacts.slice(0, 5).map((c) => (
              <li key={c.wo_id} className="py-2 flex items-center justify-between gap-2">
                <Link href={`/jobs/${c.wo_id}`} className="min-w-0 flex-1 hover:text-violet-700">
                  <div className="font-medium text-slate-800 truncate">
                    {c.alt_contact_name}
                    {c.alt_contact_relationship && <span className="text-slate-400 font-normal"> · {c.alt_contact_relationship}</span>}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    For {c.customer_name}{c.appliance_type && ` · ${c.appliance_type}`}
                  </div>
                </Link>
                <div className="text-right shrink-0">
                  <div className="text-xs font-medium text-slate-700">{c.hours_since}h</div>
                  <div className="text-[10px] text-slate-400">since</div>
                </div>
              </li>
            ))}
          </ul>
          {altContacts.length > 5 && <div className="text-xs text-slate-500 mt-2">+ {altContacts.length - 5} more</div>}
        </BossTile>

        {/* AI Quality Watchlist */}
        <BossTile
          title="AI Quality Watchlist" icon={AlertTriangle} accent="rose"
          count={watchlist.length}
          loading={loading.w} error={errors.w}
          empty={watchlist.length === 0}
          emptyText="No troubled threads in the last 48h."
          footer="Threads with fallback / paused / 6+ turns / stop keywords"
        >
          <ul className="text-sm divide-y divide-slate-100">
            {watchlist.slice(0, 5).map((w) => (
              <li key={w.phone} className="py-2">
                <Link href={`/sms?phone=${encodeURIComponent(w.phone)}`} className="block hover:text-rose-700">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-slate-800 truncate">{w.customer_name}</div>
                    <div className="text-[10px] text-slate-400 shrink-0">{hoursAgo(w.last_at)}h ago · {w.turn_count} msgs</div>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {w.reasons.map((r) => {
                      const labels: Record<string, { text: string; cls: string }> = {
                        fallback: { text: "fallback", cls: "bg-rose-100 text-rose-700" },
                        paused:   { text: "paused",   cls: "bg-amber-100 text-amber-700" },
                        long:     { text: "6+ turns", cls: "bg-blue-100 text-blue-700" },
                        stop:     { text: "stop kw",  cls: "bg-slate-200 text-slate-700" },
                      };
                      const l = labels[r];
                      return l ? (
                        <span key={r} className={`text-[10px] px-1.5 py-0.5 rounded ${l.cls}`}>{l.text}</span>
                      ) : null;
                    })}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {watchlist.length > 5 && <div className="text-xs text-slate-500 mt-2">+ {watchlist.length - 5} more</div>}
        </BossTile>

        {/* New WO Velocity by source */}
        <BossTile
          title="New WO Velocity" icon={TrendingUp} accent="blue"
          count={velocity.reduce((s, r) => s + r.week, 0)}
          countSuffix="/wk"
          loading={loading.v} error={errors.v}
          empty={velocity.length === 0}
          emptyText="No new work orders this week."
          footer="By source · last 7 days"
        >
          <ul className="text-sm space-y-1.5">
            {velocity.map((r) => (
              <li key={r.source} className="flex items-center justify-between">
                <span className="text-slate-700 font-medium truncate">{r.source}</span>
                <span className="text-xs text-slate-500 tabular-nums">
                  <span className="text-slate-800 font-semibold">{r.week}</span> wk
                  <span className="text-slate-400 ml-2">{r.today} today</span>
                </span>
              </li>
            ))}
          </ul>
        </BossTile>
      </div>

      <div className="mt-6 text-center text-xs text-slate-400">
        All 11 v1 tiles live. Updates in realtime via Supabase.
      </div>
    </div>
  );
}
