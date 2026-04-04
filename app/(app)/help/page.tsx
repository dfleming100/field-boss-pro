"use client";

import React from "react";
import { HelpCircle, BookOpen, MessageCircle, Mail } from "lucide-react";

export default function HelpPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Help Center</h1>
        <p className="text-gray-500 mt-1">Get help with Field Boss Pro</p>
      </div>

      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-3">
            <BookOpen size={20} className="text-indigo-600" />
            <h3 className="font-semibold text-gray-900">Getting Started</h3>
          </div>
          <p className="text-sm text-gray-600">
            Learn how to set up your account, add technicians, create work orders, and schedule appointments.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-3">
            <MessageCircle size={20} className="text-indigo-600" />
            <h3 className="font-semibold text-gray-900">Live Chat Support</h3>
          </div>
          <p className="text-sm text-gray-600">
            Chat with our support team for immediate assistance with your account.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-3">
            <Mail size={20} className="text-indigo-600" />
            <h3 className="font-semibold text-gray-900">Email Support</h3>
          </div>
          <p className="text-sm text-gray-600">
            Send us an email at support@fieldboss.pro and we&apos;ll get back to you within 24 hours.
          </p>
        </div>
      </div>
    </div>
  );
}
