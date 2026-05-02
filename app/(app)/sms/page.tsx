"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/lib/AuthContext";
import { useSoftphone } from "@/app/(app)/layout";
import { supabase } from "@/lib/supabase";
import {
  MessageSquare,
  Send,
  Search,
  PhoneCall,
  User,
  ChevronLeft,
  Circle,
  RefreshCw,
  Paperclip,
  X,
  Pause,
  Play,
  CheckCheck,
  Check,
  AlertCircle,
  Clock,
  Image as ImageIcon,
} from "lucide-react";

interface Conversation {
  phone: string;
  customer_name: string | null;
  customer_id: number | null;
  last_message: string;
  last_time: string;
  unread_count: number;
  direction: string;
  ai_paused: boolean;
}

interface Message {
  id: number;
  phone: string;
  direction: string;
  body: string | null;
  created_at: string;
  message_sid: string | null;
  status: string | null;
  media_urls: string[] | null;
  error_code: string | null;
  error_message: string | null;
  work_order_id: number | null;
}

interface ThreadState {
  phone: string;
  ai_paused: boolean;
  last_read_at: string | null;
}

type Pending = { file: File; previewUrl: string };

export default function SMSCommandCenter() {
  const { tenantUser } = useAuth();
  const { openSoftphone } = useSoftphone();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [threadStates, setThreadStates] = useState<Record<string, ThreadState>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tenantId = tenantUser?.tenant_id;

  const fetchThreadStates = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await supabase
      .from("sms_thread_state")
      .select("phone, ai_paused, last_read_at")
      .eq("tenant_id", tenantId);
    if (data) {
      const map: Record<string, ThreadState> = {};
      for (const s of data as any[]) map[s.phone] = s;
      setThreadStates(map);
    }
  }, [tenantId]);

  const fetchConversations = useCallback(async () => {
    if (!tenantId) return;

    // Tech role: only show threads for THEIR customers (WOs assigned to them
    // or with a non-canceled appointment for them) + alt_contacts on those WOs.
    let allowedPhones: Set<string> | null = null;
    const isTech = (tenantUser as any)?.role === "technician";
    const techId = (tenantUser as any)?.technician_id;
    if (isTech && techId) {
      const { data: assignedWos } = await supabase
        .from("work_orders")
        .select("customer_id, alt_contact_phone")
        .eq("tenant_id", tenantId)
        .eq("assigned_technician_id", techId);
      const { data: apptRows } = await supabase
        .from("appointments")
        .select("work_order:work_orders!inner(customer_id, alt_contact_phone)")
        .eq("tenant_id", tenantId)
        .eq("technician_id", techId)
        .neq("status", "canceled");
      const custIds = new Set<number>();
      const altPhones = new Set<string>();
      for (const w of assignedWos || []) {
        if (w.customer_id) custIds.add(w.customer_id);
        if (w.alt_contact_phone) altPhones.add(w.alt_contact_phone);
      }
      for (const a of (apptRows as any[]) || []) {
        const wo = Array.isArray(a.work_order) ? a.work_order[0] : a.work_order;
        if (wo?.customer_id) custIds.add(wo.customer_id);
        if (wo?.alt_contact_phone) altPhones.add(wo.alt_contact_phone);
      }
      const phoneList = new Set<string>(Array.from(altPhones));
      if (custIds.size > 0) {
        const { data: custPhones } = await supabase
          .from("customers")
          .select("phone, phone2")
          .eq("tenant_id", tenantId)
          .in("id", Array.from(custIds));
        for (const c of custPhones || []) {
          if (c.phone) phoneList.add((c.phone || "").replace(/\D/g, "").slice(-10));
          if (c.phone2) phoneList.add((c.phone2 || "").replace(/\D/g, "").slice(-10));
        }
        for (const p of altPhones) phoneList.add((p || "").replace(/\D/g, "").slice(-10));
      }
      allowedPhones = phoneList;
    }

    const { data } = await supabase
      .from("sms_conversations")
      .select("phone, direction, body, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (!data) return;

    const phoneMap: Record<string, Conversation> = {};

    for (const msg of data) {
      const digits = (msg.phone || "").replace(/\D/g, "");
      if (digits.length < 7) continue;

      // Tech filter: drop threads that don't belong to this tech.
      if (allowedPhones && !allowedPhones.has(digits.slice(-10))) continue;

      const lastRead = threadStates[msg.phone]?.last_read_at;
      if (!phoneMap[msg.phone]) {
        phoneMap[msg.phone] = {
          phone: msg.phone,
          customer_name: null,
          customer_id: null,
          last_message: msg.body || "[attachment]",
          last_time: msg.created_at,
          unread_count: 0,
          direction: msg.direction,
          ai_paused: !!threadStates[msg.phone]?.ai_paused,
        };
      }
      if (msg.direction === "inbound" && (!lastRead || msg.created_at > lastRead)) {
        phoneMap[msg.phone].unread_count++;
      }
    }

    const phones = Object.keys(phoneMap);
    const { data: allCustomers } = await supabase
      .from("customers")
      .select("id, customer_name, phone, phone2")
      .eq("tenant_id", tenantId);

    if (allCustomers) {
      for (const phone of phones) {
        const digits = phone.replace(/\D/g, "");
        const search = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
        if (search.length >= 7) {
          const match = allCustomers.find((c: any) => {
            const cDigits = (c.phone || "").replace(/\D/g, "");
            const cDigits2 = (c.phone2 || "").replace(/\D/g, "");
            if (cDigits.length >= 7 && cDigits.slice(-7) === search.slice(-7)) return true;
            if (cDigits2.length >= 7 && cDigits2.slice(-7) === search.slice(-7)) return true;
            return false;
          });
          if (match) {
            phoneMap[phone].customer_name = match.customer_name;
            phoneMap[phone].customer_id = match.id;
          }
        }
      }
    }

    const sorted = Object.values(phoneMap).sort(
      (a, b) => new Date(b.last_time).getTime() - new Date(a.last_time).getTime()
    );

    setConversations(sorted);
    setIsLoading(false);
  }, [tenantId, threadStates, tenantUser]);

  const fetchMessages = useCallback(async (phone: string) => {
    const { data } = await supabase
      .from("sms_conversations")
      .select("*")
      .eq("phone", phone)
      .order("created_at", { ascending: true });
    if (data) setMessages(data as any);
  }, []);

  useEffect(() => {
    fetchThreadStates();
  }, [fetchThreadStates]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Supabase Realtime: listen for new/updated conversations.
  // Drop server-side filter (bigint/string mismatch) — RLS already scopes delivery.
  useEffect(() => {
    if (!tenantId) return;

    // Make sure the realtime socket has the current JWT
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) {
        supabase.realtime.setAuth(data.session.access_token);
      }
    });

    const channel = supabase
      .channel(`sms-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sms_conversations" },
        (payload: any) => {
          const row = payload.new || payload.old;
          if (row && String(row.tenant_id) !== String(tenantId)) return;
          fetchConversations();
          if (row && selectedPhone && row.phone === selectedPhone) {
            fetchMessages(selectedPhone);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sms_thread_state" },
        (payload: any) => {
          const row = payload.new || payload.old;
          if (row && String(row.tenant_id) !== String(tenantId)) return;
          fetchThreadStates();
        }
      )
      .subscribe();

    // Polling fallback — guarantees refresh within 10s even if Realtime misses.
    const poll = setInterval(() => {
      fetchConversations();
      if (selectedPhone) fetchMessages(selectedPhone);
    }, 10000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [tenantId, selectedPhone, fetchConversations, fetchMessages, fetchThreadStates]);

  // Reset auto-scroll intent whenever the user opens a different thread.
  useEffect(() => {
    shouldAutoScrollRef.current = true;
  }, [selectedPhone]);

  // Only auto-scroll to the newest message if the user is already near the bottom.
  // If they've scrolled up to read history, leave their scroll position alone.
  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;
  }, []);

  const markRead = useCallback(async (phone: string) => {
    if (!tenantId) return;
    await fetch("/api/sms/thread-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId, phone, mark_read: true }),
    });
    fetchThreadStates();
  }, [tenantId, fetchThreadStates]);

  const selectConversation = (conv: Conversation) => {
    setSelectedPhone(conv.phone);
    setSelectedCustomer(conv.customer_name);
    fetchMessages(conv.phone);
    markRead(conv.phone);
  };

  const togglePause = async () => {
    if (!selectedPhone || !tenantId) return;
    const current = threadStates[selectedPhone]?.ai_paused || false;
    await fetch("/api/sms/thread-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId, phone: selectedPhone, ai_paused: !current }),
    });
    fetchThreadStates();
  };

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const picked = files.map((f) => ({ file: f, previewUrl: URL.createObjectURL(f) }));
    setPending((prev) => [...prev, ...picked].slice(0, 10));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePending = (i: number) => {
    setPending((prev) => {
      const copy = [...prev];
      URL.revokeObjectURL(copy[i].previewUrl);
      copy.splice(i, 1);
      return copy;
    });
  };

  const uploadAttachments = async (): Promise<string[]> => {
    if (!tenantId || pending.length === 0) return [];
    const urls: string[] = [];
    for (const p of pending) {
      const ext = p.file.name.split(".").pop() || "bin";
      const path = `${tenantId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("sms-attachments").upload(path, p.file, {
        contentType: p.file.type,
        upsert: false,
      });
      if (error) {
        console.error("Upload failed:", error);
        continue;
      }
      const { data } = supabase.storage.from("sms-attachments").getPublicUrl(path);
      if (data?.publicUrl) urls.push(data.publicUrl);
    }
    return urls;
  };

  const sendMessage = async () => {
    if ((!newMessage.trim() && pending.length === 0) || !selectedPhone) return;
    setIsSending(true);

    try {
      const mediaUrls = await uploadAttachments();
      const res = await fetch("/api/sms/send-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: selectedPhone,
          body: newMessage.trim(),
          tenant_id: tenantId,
          media_urls: mediaUrls.length ? mediaUrls : undefined,
        }),
      });
      if (res.ok) {
        setNewMessage("");
        pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
        setPending([]);
        fetchMessages(selectedPhone);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Send failed: ${err.error || res.statusText}`);
      }
    } catch (err) {
      console.error("Send failed:", err);
    } finally {
      setIsSending(false);
    }
  };

  const parseUtc = (ts: string): Date => {
    const hasOffset = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(ts);
    const normalized = hasOffset ? ts : ts.replace(" ", "T") + "Z";
    return new Date(normalized);
  };

  const formatTime = (ts: string) => {
    const d = parseUtc(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
  };

  const formatFullTime = (ts: string) => {
    const d = parseUtc(ts);
    return d.toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", timeZone: "America/Chicago",
    });
  };

  const formatPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    const num = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (num.length === 10) return `(${num.slice(0, 3)}) ${num.slice(3, 6)}-${num.slice(6)}`;
    return phone;
  };

  const renderStatus = (msg: Message) => {
    if (msg.direction !== "outbound") return null;
    const s = (msg.status || "").toLowerCase();
    if (s === "delivered") return <span className="inline-flex items-center gap-0.5 text-green-400" title="Delivered"><CheckCheck size={11} /></span>;
    if (s === "sent") return <span className="inline-flex items-center gap-0.5 text-gray-300" title="Sent"><Check size={11} /></span>;
    if (s === "queued" || s === "sending") return <span className="inline-flex items-center gap-0.5 text-gray-300" title="Queued"><Clock size={11} /></span>;
    if (s === "failed" || s === "undelivered") return <span className="inline-flex items-center gap-0.5 text-red-300" title={msg.error_message || "Failed"}><AlertCircle size={11} /></span>;
    return null;
  };

  const filtered = conversations.filter((c) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    const digitsTerm = searchTerm.replace(/\D/g, "");
    // Only apply the phone-match if the search has at least one digit;
    // otherwise "Lori".replace(/\D/g,"") === "" and includes("") was true
    // for every phone, defeating the name search.
    const phoneMatch =
      digitsTerm.length > 0 && c.phone.replace(/\D/g, "").includes(digitsTerm);
    const nameMatch = (c.customer_name || "").toLowerCase().includes(term);
    const msgMatch = (c.last_message || "").toLowerCase().includes(term);
    return phoneMatch || nameMatch || msgMatch;
  });

  const totalUnread = conversations.reduce((sum, c) => sum + c.unread_count, 0);
  const currentPaused = selectedPhone ? threadStates[selectedPhone]?.ai_paused : false;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-7rem)]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">SMS Command Center</h1>
          {totalUnread > 0 && (
            <span className="px-2.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full">
              {totalUnread} unread
            </span>
          )}
        </div>
        <button
          onClick={() => { fetchConversations(); if (selectedPhone) fetchMessages(selectedPhone); }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div className="flex bg-white rounded-xl border border-gray-200 overflow-hidden h-[calc(100%-3rem)]">
        {/* Left Panel */}
        <div className={`w-80 border-r border-gray-200 flex flex-col flex-shrink-0 ${selectedPhone ? "hidden md:flex" : "flex"}`}>
          <div className="p-3 border-b border-gray-200">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name or phone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">
                {conversations.length === 0 ? "No conversations yet" : "No matches"}
              </div>
            ) : (
              filtered.map((conv) => {
                const isSelected = selectedPhone === conv.phone;
                const isUnread = conv.unread_count > 0;
                return (
                  <button
                    key={conv.phone}
                    onClick={() => selectConversation(conv)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition ${
                      isSelected ? "bg-indigo-50 border-l-2 border-l-indigo-500" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {isUnread && <Circle size={8} className="text-blue-500 fill-blue-500 flex-shrink-0" />}
                          <p className={`text-sm truncate ${isUnread ? "font-bold text-gray-900" : "font-medium text-gray-700"}`}>
                            {conv.customer_name || formatPhone(conv.phone)}
                          </p>
                          {conv.ai_paused && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700 bg-amber-100 rounded px-1" title="AI paused">
                              <Pause size={8} />
                              AI OFF
                            </span>
                          )}
                        </div>
                        {conv.customer_name && (
                          <p className="text-xs text-gray-400 mt-0.5">{formatPhone(conv.phone)}</p>
                        )}
                        <p className={`text-xs mt-1 truncate ${isUnread ? "font-semibold text-gray-800" : "text-gray-500"}`}>
                          {conv.direction === "outbound" && "You: "}{conv.last_message}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-[10px] text-gray-400">{formatTime(conv.last_time)}</span>
                        {isUnread && (
                          <span className="w-5 h-5 bg-blue-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                            {conv.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Panel */}
        <div className={`flex-1 flex flex-col ${!selectedPhone ? "hidden md:flex" : "flex"}`}>
          {!selectedPhone ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <MessageSquare size={48} className="text-gray-300 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">Select a conversation</p>
              </div>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSelectedPhone(null)}
                    className="md:hidden p-1 text-gray-400 hover:text-gray-600"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <div className="w-9 h-9 bg-indigo-100 rounded-full flex items-center justify-center">
                    <User size={16} className="text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {selectedCustomer || formatPhone(selectedPhone)}
                    </p>
                    <p className="text-xs text-gray-500">{formatPhone(selectedPhone)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={togglePause}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition ${
                      currentPaused
                        ? "text-amber-700 bg-amber-50 hover:bg-amber-100"
                        : "text-gray-600 bg-white border border-gray-200 hover:bg-gray-50"
                    }`}
                    title={currentPaused ? "Resume AI auto-reply" : "Pause AI auto-reply and take over"}
                  >
                    {currentPaused ? <Play size={14} /> : <Pause size={14} />}
                    {currentPaused ? "Resume AI" : "Pause AI"}
                  </button>
                  <button
                    onClick={() => openSoftphone(selectedPhone, selectedCustomer || undefined)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100 transition"
                  >
                    <PhoneCall size={14} />
                    Call
                  </button>
                </div>
              </div>

              <div
                ref={messagesContainerRef}
                onScroll={handleMessagesScroll}
                className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/50"
              >
                {messages.map((msg) => {
                  const isOutbound = msg.direction === "outbound";
                  const media = msg.media_urls || [];
                  return (
                    <div key={msg.id} className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] ${isOutbound ? "order-1" : ""}`}>
                        {media.length > 0 && (
                          <div className={`mb-1 grid gap-1 ${media.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                            {media.map((url, i) => (
                              <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={url}
                                  alt="attachment"
                                  className="rounded-lg border border-gray-200 max-h-60 object-cover w-full"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                  }}
                                />
                              </a>
                            ))}
                          </div>
                        )}
                        {msg.body && (
                          <div
                            className={`px-3.5 py-2.5 rounded-2xl text-sm ${
                              isOutbound
                                ? "bg-indigo-600 text-white rounded-br-md"
                                : "bg-white border border-gray-200 text-gray-900 rounded-bl-md"
                            }`}
                          >
                            {msg.body}
                          </div>
                        )}
                        <p className={`text-[10px] mt-1 px-1 flex items-center gap-1 ${isOutbound ? "justify-end text-gray-400" : "text-gray-400"}`}>
                          {formatFullTime(msg.created_at)}
                          {renderStatus(msg)}
                        </p>
                        {msg.error_message && isOutbound && (
                          <p className="text-[10px] text-red-500 mt-0.5 px-1 text-right">
                            {msg.error_message}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Send Box */}
              <div className="p-3 border-t border-gray-200 bg-white">
                {pending.length > 0 && (
                  <div className="flex gap-2 mb-2 flex-wrap">
                    {pending.map((p, i) => (
                      <div key={i} className="relative">
                        {p.file.type.startsWith("image/") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.previewUrl} alt="pending" className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
                        ) : (
                          <div className="w-16 h-16 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center">
                            <ImageIcon size={20} className="text-gray-400" />
                          </div>
                        )}
                        <button
                          onClick={() => removePending(i)}
                          className="absolute -top-1 -right-1 w-5 h-5 bg-gray-800 text-white rounded-full flex items-center justify-center hover:bg-black"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*,application/pdf"
                    multiple
                    onChange={onPickFiles}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSending}
                    className="p-2.5 text-gray-500 hover:text-indigo-600 hover:bg-gray-50 rounded-xl transition"
                    title="Attach photo or file"
                  >
                    <Paperclip size={18} />
                  </button>
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                    placeholder={currentPaused ? "Replying directly — AI is paused" : "Type a message..."}
                    className="flex-1 px-4 py-2.5 text-sm border border-gray-300 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                    disabled={isSending}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={isSending || (!newMessage.trim() && pending.length === 0)}
                    className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition"
                  >
                    <Send size={16} />
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1 px-1">
                  Manual message — bypasses AI agent.
                  {currentPaused && <span className="ml-1 font-semibold text-amber-700">AI auto-reply paused for this thread.</span>}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
