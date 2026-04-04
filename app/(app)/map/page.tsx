"use client";

import React from "react";
import { MapPin } from "lucide-react";

export default function MapPage() {
  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Map</h1>
        <p className="text-gray-500 mt-1">View technician locations and service areas</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <MapPin size={48} className="text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Map View</h3>
        <p className="text-gray-500 text-sm">Live technician tracking and service area visualization coming soon.</p>
      </div>
    </div>
  );
}
