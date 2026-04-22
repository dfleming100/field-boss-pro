"use client";

import React, { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";

export interface TechPin {
  id: number;
  tech_name: string;
  last_lat: number;
  last_lng: number;
  last_location_at: string;
}

interface Props {
  techs: TechPin[];
  apiKey: string | undefined;
  height?: number;
}

const STALE_MINUTES = 15;
const HIDE_MINUTES = 60;

let loadPromise: Promise<void> | null = null;

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  if ((window as any).google?.maps) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-gmaps]");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("script error")));
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.defer = true;
    script.dataset.gmaps = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("script error"));
    document.head.appendChild(script);
  });
  return loadPromise;
}

function minutesSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

function ageLabel(iso: string): string {
  const m = minutesSince(iso);
  if (m < 1) return "just now";
  if (m < 60) return `${Math.round(m)} min ago`;
  return `${Math.round(m / 60)}h ago`;
}

export default function TechMap({ techs, apiKey, height = 320 }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const visible = techs.filter((t) => t.last_location_at && minutesSince(t.last_location_at) < HIDE_MINUTES);

  useEffect(() => {
    if (!apiKey || !mapRef.current) return;
    let cancelled = false;

    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !mapRef.current) return;
        const google = (window as any).google;

        const bounds = new google.maps.LatLngBounds();
        visible.forEach((t) => bounds.extend({ lat: t.last_lat, lng: t.last_lng }));

        if (!mapInstance.current) {
          mapInstance.current = new google.maps.Map(mapRef.current, {
            center: visible[0] ? { lat: visible[0].last_lat, lng: visible[0].last_lng } : { lat: 39.5, lng: -98.35 },
            zoom: visible.length ? 11 : 4,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
          });
        }

        markersRef.current.forEach((m) => m.setMap(null));
        markersRef.current = [];

        visible.forEach((t) => {
          const stale = minutesSince(t.last_location_at) > STALE_MINUTES;
          const marker = new google.maps.Marker({
            position: { lat: t.last_lat, lng: t.last_lng },
            map: mapInstance.current,
            title: `${t.tech_name} — ${ageLabel(t.last_location_at)}`,
            opacity: stale ? 0.5 : 1,
            label: { text: t.tech_name.charAt(0).toUpperCase(), color: "white", fontWeight: "600" },
          });
          const info = new google.maps.InfoWindow({
            content: `<div style="font-family:system-ui;font-size:13px;padding:2px 4px;"><strong>${t.tech_name}</strong><br/><span style="color:#666;">${ageLabel(t.last_location_at)}</span></div>`,
          });
          marker.addListener("click", () => info.open({ anchor: marker, map: mapInstance.current }));
          markersRef.current.push(marker);
        });

        if (visible.length > 1) mapInstance.current.fitBounds(bounds);
        else if (visible.length === 1) mapInstance.current.setCenter({ lat: visible[0].last_lat, lng: visible[0].last_lng });
      })
      .catch((e) => setLoadError(e?.message || "map load failed"));

    return () => {
      cancelled = true;
    };
  }, [apiKey, visible]);

  if (!apiKey) {
    return (
      <div className="flex flex-col items-center justify-center text-center p-8 bg-gray-50 rounded-lg" style={{ height }}>
        <MapPin size={32} className="text-gray-300 mb-2" />
        <p className="text-sm text-gray-500">Set <code className="px-1 bg-white rounded text-xs">NEXT_PUBLIC_GOOGLE_MAPS_KEY</code> to enable the live tech map.</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center text-center p-8 bg-red-50 rounded-lg" style={{ height }}>
        <p className="text-sm text-red-600">Map failed to load: {loadError}</p>
      </div>
    );
  }

  if (!visible.length) {
    return (
      <div className="flex flex-col items-center justify-center text-center p-8 bg-gray-50 rounded-lg" style={{ height }}>
        <MapPin size={32} className="text-gray-300 mb-2" />
        <p className="text-sm text-gray-500">No active technicians on the map.</p>
        <p className="text-xs text-gray-400 mt-1">Techs appear when they open the mobile app.</p>
      </div>
    );
  }

  return <div ref={mapRef} style={{ height, width: "100%", borderRadius: 8 }} />;
}
