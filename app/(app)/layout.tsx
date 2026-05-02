"use client";

import React, { useState, useEffect, createContext, useContext } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import Sidebar from "@/app/components/Sidebar";
import TopNav from "@/app/components/TopNav";
import Softphone from "@/app/components/Softphone";
import BillingBanner from "@/app/components/BillingBanner";

// Softphone context so any page can trigger a call
interface SoftphoneContextType {
  openSoftphone: (number?: string, name?: string) => void;
}
const SoftphoneContext = createContext<SoftphoneContextType>({ openSoftphone: () => {} });
export const useSoftphone = () => useContext(SoftphoneContext);

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, tenantUser, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [sessionStuck, setSessionStuck] = useState(false);
  const [billingMessage, setBillingMessage] = useState<string | null>(null);

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

  // Subscription gate: check billing status; lock app or show banner
  useEffect(() => {
    if (!tenantUser?.tenant_id) return;
    // Skip the gate on the billing page itself so users can resubscribe
    const isBillingPage = pathname?.startsWith("/dashboard/billing");
    fetch(`/api/billing/status?tenantId=${tenantUser.tenant_id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.locked && !isBillingPage) {
          router.push("/billing-required");
          return;
        }
        if (d.message) setBillingMessage(d.message);
        else setBillingMessage(null);
      })
      .catch(() => {});
  }, [tenantUser?.tenant_id, pathname, router]);

  // Detect stuck session: user exists but tenantUser never loads
  useEffect(() => {
    if (!loading && user && !tenantUser) {
      const timer = setTimeout(() => {
        setSessionStuck(true);
      }, 5000);
      return () => clearTimeout(timer);
    }
    if (tenantUser) {
      setSessionStuck(false);
    }
  }, [loading, user, tenantUser]);

  // Force sign out — clears everything including localStorage
  const forceSignOut = () => {
    // Clear all Supabase keys from localStorage
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("sb-") || key.includes("supabase")) {
        localStorage.removeItem(key);
      }
    });
    window.location.href = "/login";
  };

  return (
    <SoftphoneContext.Provider value={{ openSoftphone }}>
      <div className="min-h-screen bg-gray-50">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          mobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
        />
        <div
          className={`transition-all duration-200 ${
            sidebarCollapsed ? "md:ml-[68px]" : "md:ml-[240px]"
          }`}
        >
          <TopNav onMobileMenuOpen={() => setMobileMenuOpen(true)} />
          {billingMessage && <BillingBanner message={billingMessage} />}
          <main className="p-6">
            {sessionStuck ? (
              <div className="flex items-center justify-center py-24">
                <div className="text-center">
                  <p className="text-gray-500 mb-2">Session expired or failed to load.</p>
                  <button
                    onClick={forceSignOut}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
                  >
                    Sign Out & Log In Again
                  </button>
                </div>
              </div>
            ) : (
              children
            )}
          </main>
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
