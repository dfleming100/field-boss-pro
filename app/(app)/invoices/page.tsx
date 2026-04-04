"use client";

import React from "react";
import { FileText, Plus } from "lucide-react";

export default function InvoicesPage() {
  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
          <p className="text-gray-500 mt-1">Create and manage customer invoices</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
          <Plus size={16} />
          New Invoice
        </button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <FileText size={48} className="text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No invoices yet</h3>
        <p className="text-gray-500 text-sm">Invoices you create for completed work orders will appear here.</p>
      </div>
    </div>
  );
}
