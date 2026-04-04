"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [tenantUser, setTenantUser] = useState<TenantUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTenantUser = useCallback(async (userId: string) => {
    try {
      const { data } = await supabase
        .from("tenant_users")
        .select("*")
        .eq("auth_uid", userId)
        .single();
      if (data) setTenantUser(data as TenantUser);
    } catch {
      // Silent fail — tenant user may not exist yet (onboarding)
    }
  }, []);

  const clearAuth = useCallback(() => {
    setUser(null);
    setSession(null);
    setTenantUser(null);
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        // BEFORE calling Supabase, check localStorage for expired tokens
        // If expired, clear them so getSession() returns null instantly
        try {
          const storageKeys = Object.keys(localStorage);
          for (const key of storageKeys) {
            if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
              const raw = localStorage.getItem(key);
              if (raw) {
                const parsed = JSON.parse(raw);
                const expiresAt = parsed?.expires_at || parsed?.currentSession?.expires_at;
                if (expiresAt && expiresAt * 1000 < Date.now()) {
                  localStorage.removeItem(key);
                }
              }
            }
          }
        } catch {
          // If parsing fails, clear all supabase keys
          Object.keys(localStorage).forEach((key) => {
            if (key.startsWith("sb-") || key.includes("supabase")) {
              localStorage.removeItem(key);
            }
          });
        }

        const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();

        if (!mounted) return;

        if (sessionError || !currentSession) {
          clearAuth();
          setLoading(false);
          return;
        }

        setSession(currentSession);
        setUser(currentSession.user);
        await fetchTenantUser(currentSession.user.id);
      } catch {
        clearAuth();
      } finally {
        if (mounted) setLoading(false);
      }
    };

    // Don't wait forever — 3 second max
    const timeout = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 3000);

    init().then(() => clearTimeout(timeout));

    // Listen for auth changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!mounted) return;

        if (event === "SIGNED_OUT" || !newSession) {
          clearAuth();
          return;
        }

        if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
          setSession(newSession);
          setUser(newSession.user);
          await fetchTenantUser(newSession.user.id);
        }
      }
    );

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [fetchTenantUser, clearAuth]);

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
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  };

  const signOut = async () => {
    try {
      setError(null);
      await supabase.auth.signOut();
      clearAuth();
    } catch (err) {
      // Force clear even if signOut API fails
      clearAuth();
      setError((err as Error).message);
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, tenantUser, session, loading, error, signUp, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};
