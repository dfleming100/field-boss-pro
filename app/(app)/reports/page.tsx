"use client";

import React from "react";
import { BarChart3 } from "lucide-react";

export default function ReportsPage() {
  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-gray-500 mt-1">Analytics and business insights</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <BarChart3 size={48} className="text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Reports</h3>
        <p className="text-gray-500 text-sm">Revenue, technician performance, and job completion analytics coming soon.</p>
      </div>
    </div>
  );
}
