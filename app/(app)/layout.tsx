"use client";

import React, { useState, useEffect, createContext, useContext } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import Sidebar from "@/app/components/Sidebar";
import TopNav from "@/app/components/TopNav";
import Softphone from "@/app/components/Softphone";

// Softphone context so any page can trigger a call
interface SoftphoneContextType {
  openSoftphone: (number?: string, name?: string) => void;
}
const SoftphoneContext = createContext<SoftphoneContextType>({ openSoftphone: () => {} });
export const useSoftphone = () => useContext(SoftphoneContext);

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Softphone state
  const [softphoneOpen, setSoftphoneOpen] = useState(false);
  const [dialNumber, setDialNumber] = useState("");
  const [contactName, setContactName] = useState("");

  const openSoftphone = (number?: string, name?: string) => {
    if (number) setDialNumber(number);
    if (name) setContactName(name);
    setSoftphoneOpen(true);
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!loading && !user && mounted) {
      router.push("/login");
    }
  }, [loading, user, router, mounted]);

  return (
    <SoftphoneContext.Provider value={{ openSoftphone }}>
      <div className="min-h-screen bg-gray-50">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        <div
          className={`transition-all duration-200 ${
            sidebarCollapsed ? "ml-[68px]" : "ml-[240px]"
          }`}
        >
          <TopNav />
          <main className="p-6">{children}</main>
        </div>

        <Softphone
          isOpen={softphoneOpen}
          onClose={() => setSoftphoneOpen(false)}
          dialNumber={dialNumber}
          contactName={contactName}
        />
      </div>
    </SoftphoneContext.Provider>
  );
}
