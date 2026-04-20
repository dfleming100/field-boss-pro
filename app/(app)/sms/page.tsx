"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/lib/AuthContext";
import { useSoftphone } from "@/app/(app)/layout";
import { supabase } from "@/lib/supabase";
import {
  MessageSquare,
  Send,
  Search,
  Phone,
  PhoneCall,
  User,
  Clock,
  ChevronLeft,
  Circle,
  RefreshCw,
} from "lucide-react";

interface Conversation {
  phone: string;
  customer_name: string | null;
  customer_id: number | null;
  last_message: string;
  last_time: string;
  unread_count: number;
  direction: string;
}

interface Message {
  id: number;
  phone: string;
  direction: string;
  body: string;
  created_at: string;
  message_sid: string | null;
}

export default function SMSCommandCenter() {
  const { tenantUser } = useAuth();
  const { openSoftphone } = useSoftphone();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  // Track last-read timestamp per phone so only NEW inbound messages show as unread
  const [readTimestamps, setReadTimestamps] = useState<Record<string, string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("sms_read_timestamps");
        return saved ? JSON.parse(saved) : {};
      } catch { return {}; }
    }
    return {};
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch conversation list
  const fetchConversations = useCallback(async () => {
    if (!tenantUser) return;

    const { data } = await supabase
      .from("sms_conversations")
      .select("phone, direction, body, created_at")
      .eq("tenant_id", tenantUser.tenant_id)
      .order("created_at", { ascending: false });

    if (!data) return;

    // Group by phone, get last message and unread count
    const phoneMap: Record<string, Conversation> = {};
    const unreadAfterRead: Record<string, number> = {};

    for (const msg of data) {
      // Skip malformed phone values (e.g. "+", empty, or too short to be a real number)
      const digits = (msg.phone || "").replace(/\D/g, "");
      if (digits.length < 7) continue;

      if (!phoneMap[msg.phone]) {
        phoneMap[msg.phone] = {
          phone: msg.phone,
          customer_name: null,
          customer_id: null,
          last_message: msg.body,
          last_time: msg.created_at,
          unread_count: 0,
          direction: msg.direction,
        };
      }
      // Only count inbound messages NEWER than when we last read this conversation
      const lastRead = readTimestamps[msg.phone];
      if (msg.direction === "inbound" && (!lastRead || msg.created_at > lastRead)) {
        phoneMap[msg.phone].unread_count++;
      }
    }

    // Look up customer names in a single batch query instead of N+1
    const phones = Object.keys(phoneMap);
    const { data: allCustomers } = await supabase
      .from("customers")
      .select("id, customer_name, phone")
      .eq("tenant_id", tenantUser.tenant_id);

    if (allCustomers) {
      for (const phone of phones) {
        const digits = phone.replace(/\D/g, "");
        const search = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
        if (search.length >= 7) {
          const match = allCustomers.find((c: any) => {
            const cDigits = (c.phone || "").replace(/\D/g, "");
            if (cDigits.length < 7) return false;
            return cDigits.slice(-7) === search.slice(-7);
          });
          if (match) {
            phoneMap[phone].customer_name = match.customer_name;
            phoneMap[phone].customer_id = match.id;
          }
        }
      }
    }

    // Sort by most recent
    const sorted = Object.values(phoneMap).sort(
      (a, b) => new Date(b.last_time).getTime() - new Date(a.last_time).getTime()
    );

    setConversations(sorted);
    setIsLoading(false);
  }, [tenantUser, readTimestamps]);

  // Fetch messages for selected conversation
  const fetchMessages = useCallback(async (phone: string) => {
    const { data } = await supabase
      .from("sms_conversations")
      .select("*")
      .eq("phone", phone)
      .order("created_at", { ascending: true });

    if (data) setMessages(data);
  }, []);

  // Initial load
  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Poll for new messages every 5 seconds
  useEffect(() => {
    pollRef.current = setInterval(() => {
      fetchConversations();
      if (selectedPhone) fetchMessages(selectedPhone);
    }, 5000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchConversations, fetchMessages, selectedPhone]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Select a conversation
  const selectConversation = (conv: Conversation) => {
    setSelectedPhone(conv.phone);
    setSelectedCustomer(conv.customer_name);
    setReadTimestamps((prev) => {
      const next = { ...prev, [conv.phone]: new Date().toISOString() };
      try { localStorage.setItem("sms_read_timestamps", JSON.stringify(next)); } catch {}
      return next;
    });
    fetchMessages(conv.phone);
  };

  // Send manual message
  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedPhone) return;
    setIsSending(true);

    try {
      // Send via API
      const res = await fetch("/api/sms/send-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: selectedPhone,
          body: newMessage.trim(),
          tenant_id: tenantUser?.tenant_id,
        }),
      });

      if (res.ok) {
        setNewMessage("");
        await fetchMessages(selectedPhone);
        await fetchConversations();
      }
    } catch (err) {
      console.error("Send failed:", err);
    } finally {
      setIsSending(false);
    }
  };

  // Supabase returns timestamps without a timezone marker (e.g. "2026-04-10 19:37:46.942871").
  // JavaScript would parse that as LOCAL time, but the value is actually UTC — so we
  // normalize by appending "Z" when no offset is present.
  const parseUtc = (ts: string): Date => {
    const hasOffset = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(ts);
    const normalized = hasOffset ? ts : ts.replace(" ", "T") + "Z";
    return new Date(normalized);
  };

  // Format timestamp
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
    return d.toLocaleDateString("en-US", {
      month: "short", day: "numeric",
      timeZone: "America/Chicago",
    });
  };

  const formatFullTime = (ts: string) => {
    const d = parseUtc(ts);
    return d.toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
      timeZone: "America/Chicago",
    });
  };

  // Format phone for display
  const formatPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    const num = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (num.length === 10) {
      return `(${num.slice(0, 3)}) ${num.slice(3, 6)}-${num.slice(6)}`;
    }
    return phone;
  };

  // Filter conversations
  const filtered = conversations.filter((c) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      c.phone.includes(searchTerm.replace(/\D/g, "")) ||
      c.customer_name?.toLowerCase().includes(term) ||
      c.last_message.toLowerCase().includes(term)
    );
  });

  // Total unread
  const totalUnread = conversations.reduce((sum, c) => sum + c.unread_count, 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-7rem)]">
      {/* Header */}
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
          onClick={() => fetchConversations()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div className="flex bg-white rounded-xl border border-gray-200 overflow-hidden h-[calc(100%-3rem)]">
        {/* Left Panel: Conversation List */}
        <div className={`w-80 border-r border-gray-200 flex flex-col flex-shrink-0 ${selectedPhone ? "hidden md:flex" : "flex"}`}>
          {/* Search */}
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

          {/* Conversations */}
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
                          {isUnread && (
                            <Circle size={8} className="text-blue-500 fill-blue-500 flex-shrink-0" />
                          )}
                          <p className={`text-sm truncate ${isUnread ? "font-bold text-gray-900" : "font-medium text-gray-700"}`}>
                            {conv.customer_name || formatPhone(conv.phone)}
                          </p>
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

        {/* Right Panel: Message Thread */}
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
              {/* Thread Header */}
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
                    onClick={() => openSoftphone(selectedPhone, selectedCustomer || undefined)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100 transition"
                  >
                    <PhoneCall size={14} />
                    Call
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/50">
                {messages.map((msg) => {
                  const isOutbound = msg.direction === "outbound";
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}
                    >
                      <div className={`max-w-[75%] ${isOutbound ? "order-1" : ""}`}>
                        <div
                          className={`px-3.5 py-2.5 rounded-2xl text-sm ${
                            isOutbound
                              ? "bg-indigo-600 text-white rounded-br-md"
                              : "bg-white border border-gray-200 text-gray-900 rounded-bl-md"
                          }`}
                        >
                          {msg.body}
                        </div>
                        <p
                          className={`text-[10px] mt-1 px-1 ${
                            isOutbound ? "text-right text-gray-400" : "text-gray-400"
                          }`}
                        >
                          {formatFullTime(msg.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Send Box */}
              <div className="p-3 border-t border-gray-200 bg-white">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                    placeholder="Type a message..."
                    className="flex-1 px-4 py-2.5 text-sm border border-gray-300 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                    disabled={isSending}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={isSending || !newMessage.trim()}
                    className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition"
                  >
                    <Send size={16} />
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1 px-1">
                  Manual message — bypasses AI agent, sends directly from (855) 269-3196
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
