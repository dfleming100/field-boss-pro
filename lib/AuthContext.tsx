"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface TenantUser {
  id: string;
  tenant_id: string;
  auth_uid: string;
  user_email: string;
  role: "admin" | "manager" | "dispatcher" | "technician";
  is_active: boolean;
  created_at: string;
  updated_at: string;
  technician_id?: number | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string;
  phone?: string | null;
}

interface AuthContextType {
  user: User | null;
  tenantUser: TenantUser | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Read from localStorage safely
function readCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeCache(key: string, value: any) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {}
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => readCache("fb_user"));
  const [tenantUser, setTenantUser] = useState<TenantUser | null>(() => readCache("fb_tenant_user"));
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(() => !readCache("fb_user"));
  const [error, setError] = useState<string | null>(null);
  const initDone = useRef(false);
  const tenantUserFetched = useRef(!!readCache("fb_tenant_user"));

  const clearAuth = useCallback(() => {
    setUser(null);
    setSession(null);
    setTenantUser(null);
    writeCache("fb_user", null);
    writeCache("fb_tenant_user", null);
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("sb-") || key.includes("supabase")) {
        localStorage.removeItem(key);
      }
    });
  }, []);

  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;

    let mounted = true;

    const init = async () => {
      try {
        // Clear expired tokens from localStorage before calling Supabase
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
            try {
              const parsed = JSON.parse(localStorage.getItem(key) || "");
              const exp = parsed?.expires_at || parsed?.currentSession?.expires_at;
              if (exp && exp * 1000 < Date.now()) localStorage.removeItem(key);
            } catch { localStorage.removeItem(key); }
          }
        });

        const { data: { session: s } } = await supabase.auth.getSession();
        if (!mounted) return;

        if (!s) {
          if (!readCache("fb_user")) clearAuth();
          setLoading(false);
          return;
        }

        setSession(s);
        setUser(s.user);
        writeCache("fb_user", s.user);

        // Only fetch tenant user if we don't have it cached
        if (!tenantUserFetched.current) {
          const { data } = await supabase
            .from("tenant_users")
            .select("*")
            .eq("auth_uid", s.user.id)
            .single();

          if (mounted && data) {
            setTenantUser(data as TenantUser);
            writeCache("fb_tenant_user", data);
            tenantUserFetched.current = true;
          }
        }
      } catch {
        // Don't clear cached data on error — let the app work from cache
      } finally {
        if (mounted) setLoading(false);
      }
    };

    // Safety timeout
    const timeout = setTimeout(() => { if (mounted) setLoading(false); }, 3000);
    init().then(() => clearTimeout(timeout));

    // Auth state change listener — only handle sign in/out, NOT token refreshes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;

      if (event === "SIGNED_OUT") {
        clearAuth();
        return;
      }

      if (event === "SIGNED_IN" && newSession) {
        setSession(newSession);
        setUser(newSession.user);
        writeCache("fb_user", newSession.user);

        // Fetch tenant user for new sign in
        supabase
          .from("tenant_users")
          .select("*")
          .eq("auth_uid", newSession.user.id)
          .single()
          .then(({ data }) => {
            if (data && mounted) {
              setTenantUser(data as TenantUser);
              writeCache("fb_tenant_user", data);
              tenantUserFetched.current = true;
            }
          });
      }

      // TOKEN_REFRESHED — just update the session, don't re-fetch anything
      if (event === "TOKEN_REFRESHED" && newSession) {
        setSession(newSession);
      }
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [clearAuth]);

  const signUp = async (email: string, password: string) => {
    try {
      setError(null);
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      setError(null);
      tenantUserFetched.current = false;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  };

  const signOut = async () => {
    clearAuth();
    try { await supabase.auth.signOut(); } catch {}
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ user, tenantUser, session, loading, error, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
