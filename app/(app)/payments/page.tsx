"use client";

import React from "react";
import { CreditCard } from "lucide-react";

export default function PaymentsPage() {
  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
        <p className="text-gray-500 mt-1">Track payments from your customers</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <CreditCard size={48} className="text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No payments yet</h3>
        <p className="text-gray-500 text-sm">Payment records from invoices and Stripe will appear here.</p>
      </div>
    </div>
  );
}
