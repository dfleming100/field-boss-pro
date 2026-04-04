"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/AuthContext";
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  X,
  Minimize2,
} from "lucide-react";

// Dynamically import Twilio Voice SDK (client-side only)
let TwilioDevice: any = null;

interface SoftphoneProps {
  isOpen: boolean;
  onClose: () => void;
  dialNumber?: string;
  contactName?: string;
}

export default function Softphone({ isOpen, onClose, dialNumber, contactName }: SoftphoneProps) {
  const { tenantUser } = useAuth();
  const [device, setDevice] = useState<any>(null);
  const [call, setCall] = useState<any>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "ringing" | "connected" | "ended" | "error">("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [phoneInput, setPhoneInput] = useState(dialNumber || "");
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Update phone input when dialNumber changes
  useEffect(() => {
    if (dialNumber) setPhoneInput(dialNumber);
  }, [dialNumber]);

  // Load Twilio SDK and get token
  const initDevice = useCallback(async () => {
    try {
      if (!TwilioDevice) {
        const sdk = await import("@twilio/voice-sdk");
        TwilioDevice = sdk.Device;
      }

      const res = await fetch("/api/twilio/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantUser?.tenant_id,
          identity: tenantUser?.user_email || "office",
        }),
      });

      const data = await res.json();

      if (data.error) {
        setErrorMsg(data.error === "Twilio API keys not configured"
          ? "Softphone needs Twilio API keys. See Settings → Integrations."
          : data.error);
        return;
      }

      const newDevice = new TwilioDevice(data.token, {
        codecPreferences: ["opus", "pcmu"],
        edge: "ashburn",
      });

      newDevice.on("registered", () => setStatus("idle"));
      newDevice.on("error", (err: any) => {
        setErrorMsg(err.message || "Call error");
        setStatus("error");
      });

      await newDevice.register();
      setDevice(newDevice);
      setStatus("idle");
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStatus("error");
    }
  }, [tenantUser]);

  useEffect(() => {
    if (isOpen && !device) {
      initDevice();
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isOpen, device, initDevice]);

  // Make call
  const makeCall = async () => {
    if (!device || !phoneInput) return;

    setStatus("connecting");
    setErrorMsg("");
    setDuration(0);

    try {
      const digits = phoneInput.replace(/\D/g, "");
      const toNumber = digits.length === 10 ? `+1${digits}` : digits.length === 11 ? `+${digits}` : phoneInput;

      const activeCall = await device.connect({
        params: {
          To: toNumber,
          CallerId: "+18552693196",
        },
      });

      activeCall.on("ringing", () => setStatus("ringing"));
      activeCall.on("accept", () => {
        setStatus("connected");
        timerRef.current = setInterval(() => {
          setDuration((d) => d + 1);
        }, 1000);
      });
      activeCall.on("disconnect", () => {
        setStatus("ended");
        if (timerRef.current) clearInterval(timerRef.current);
      });
      activeCall.on("error", (err: any) => {
        setErrorMsg(err.message || "Call failed");
        setStatus("error");
      });

      setCall(activeCall);
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStatus("error");
    }
  };

  // Hang up
  const hangUp = () => {
    if (call) {
      call.disconnect();
      setCall(null);
    }
    setStatus("ended");
    if (timerRef.current) clearInterval(timerRef.current);
  };

  // Toggle mute
  const toggleMute = () => {
    if (call) {
      call.mute(!isMuted);
      setIsMuted(!isMuted);
    }
  };

  // Format duration
  const formatDuration = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-6 right-6 w-80 bg-white rounded-2xl shadow-2xl border border-gray-200 z-50 overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Phone size={16} className="text-green-400" />
          <span className="text-sm font-semibold text-white">Softphone</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="p-4">
        {errorMsg && (
          <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-xs text-red-700">{errorMsg}</p>
          </div>
        )}

        {/* Contact info */}
        {contactName && (
          <p className="text-center text-sm font-semibold text-gray-900 mb-1">{contactName}</p>
        )}

        {/* Status */}
        <p className="text-center text-xs text-gray-500 mb-3">
          {status === "idle" && "Ready to call"}
          {status === "connecting" && "Connecting..."}
          {status === "ringing" && "Ringing..."}
          {status === "connected" && formatDuration(duration)}
          {status === "ended" && `Call ended — ${formatDuration(duration)}`}
          {status === "error" && "Error"}
        </p>

        {/* Phone input */}
        {(status === "idle" || status === "ended" || status === "error") && (
          <input
            type="tel"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            placeholder="(555) 123-4567"
            className="w-full px-3 py-2.5 text-center text-lg font-mono border border-gray-300 rounded-xl mb-3"
          />
        )}

        {/* Call controls */}
        <div className="flex items-center justify-center gap-4">
          {(status === "idle" || status === "ended" || status === "error") && (
            <button
              onClick={makeCall}
              disabled={!phoneInput || !device}
              className="w-14 h-14 bg-green-500 hover:bg-green-600 disabled:opacity-50 rounded-full flex items-center justify-center transition shadow-lg"
            >
              <Phone size={24} className="text-white" />
            </button>
          )}

          {(status === "connecting" || status === "ringing" || status === "connected") && (
            <>
              <button
                onClick={toggleMute}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition ${
                  isMuted
                    ? "bg-red-100 text-red-600"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
              <button
                onClick={hangUp}
                className="w-14 h-14 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center transition shadow-lg"
              >
                <PhoneOff size={24} className="text-white" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
