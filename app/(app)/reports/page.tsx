"use client";

import React from "react";
import Link from "next/link";
import { BarChart3, DollarSign, Users, ClipboardList } from "lucide-react";

export default function ReportsPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-gray-500 text-sm mt-1">Business analytics and reporting</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/reports/payroll"
          className="bg-white rounded-xl border border-gray-200 p-6 hover:border-indigo-300 hover:shadow-md transition group"
        >
          <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
            <DollarSign size={24} className="text-green-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 group-hover:text-indigo-600">Tech Payroll</h3>
          <p className="text-sm text-gray-500 mt-1">Completed first visits by technician for payroll calculation</p>
        </Link>

        <div className="bg-white rounded-xl border border-gray-200 p-6 opacity-50">
          <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-4">
            <BarChart3 size={24} className="text-indigo-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Revenue</h3>
          <p className="text-sm text-gray-500 mt-1">Coming soon</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 opacity-50">
          <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
            <ClipboardList size={24} className="text-purple-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Work Order Summary</h3>
          <p className="text-sm text-gray-500 mt-1">Coming soon</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 opacity-50">
          <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
            <Users size={24} className="text-blue-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Customer Analytics</h3>
          <p className="text-sm text-gray-500 mt-1">Coming soon</p>
        </div>
      </div>
    </div>
  );
}
