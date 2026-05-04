"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// Landed here from the password-reset email link.
// Supabase appends the recovery token in the URL hash (e.g. #access_token=...&type=recovery)
// and the supabase-js client picks it up automatically, putting the user in
// a temporary recovery session. From there we just call updateUser({ password }).
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Wait for supabase to consume the URL hash and surface a session.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setReady(true);
      } else {
        timer = setTimeout(check, 200);
      }
    };
    check();
    // Hard timeout after 5s so user gets a clear error instead of a stuck spinner.
    const fallback = setTimeout(() => {
      if (!ready) {
        setError(
          "We couldn't read the reset link. The link may have expired — request a new one from the login page."
        );
      }
    }, 5000);
    return () => {
      if (timer) clearTimeout(timer);
      clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      // Sign out the temporary recovery session so the user logs in cleanly with the new password.
      await supabase.auth.signOut();
      setTimeout(() => router.push("/login"), 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Set a new password</h1>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          {!ready && !error && (
            <p className="text-sm text-gray-500 text-center py-4">Verifying reset link…</p>
          )}

          {error && !success && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700 mb-4">
              Password updated. Redirecting to login…
            </div>
          )}

          {ready && !success && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  New password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm new password
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Update Password"}
              </button>
            </form>
          )}

          <div className="mt-4 text-center">
            <Link href="/login" className="text-sm text-gray-500 hover:text-gray-700">
              Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
