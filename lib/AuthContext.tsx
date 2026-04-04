"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
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
  // Convenience aliases
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

  useEffect(() => {
    const getSession = async () => {
      try {
        console.log("[Auth] getSession starting...");
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        console.log("[Auth] getSession done:", session ? "has session" : "no session", sessionError || "");

        setSession(session);
        setUser(session?.user || null);

        if (session?.user) {
          console.log("[Auth] Fetching tenant user for:", session.user.id);
          const { data, error: fetchError } = await supabase
            .from("tenant_users")
            .select("*")
            .eq("auth_uid", session.user.id)
            .single();

          console.log("[Auth] Tenant user result:", data ? "found" : "not found", fetchError?.message || "");

          if (data) {
            setTenantUser(data as TenantUser);
          }
        }
      } catch (err) {
        console.error("[Auth] Error in getSession:", err);
      } finally {
        console.log("[Auth] Setting loading=false");
        setLoading(false);
      }
    };

    getSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      setUser(session?.user || null);

      if (session?.user) {
        const { data } = await supabase
          .from("tenant_users")
          .select("*")
          .eq("auth_uid", session.user.id)
          .single();

        if (data) {
          setTenantUser(data as TenantUser);
        }
      } else {
        setTenantUser(null);
      }
    });

    return () => subscription?.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string) => {
    try {
      setError(null);
      const { error } = await supabase.auth.signUp({
        email,
        password,
      });
      if (error) throw error;
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      setError(null);
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      // The onAuthStateChange listener in useEffect handles updating
      // session, user, and tenantUser state automatically.
      // The session cookie is set by @supabase/ssr so middleware can read it.
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  };

  const signOut = async () => {
    try {
      setError(null);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setUser(null);
      setTenantUser(null);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        tenantUser,
        session,
        loading,
        error,
        signUp,
        signIn,
        signOut,
      }}
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
