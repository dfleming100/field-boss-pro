"use client";

import React, { useEffect, useState } from "react";
import { loadStripe, Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { X } from "lucide-react";

interface ChargeCardModalProps {
  invoiceId: number | string;
  amountCents: number;
  invoiceNumber: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ChargeCardModal({ invoiceId, amountCents, invoiceNumber, onClose, onSuccess }: ChargeCardModalProps) {
  const [stripePromise, setStripePromise] = useState<Promise<StripeJs | null> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/invoices/charge-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoice_id: invoiceId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to initialize payment");
        setClientSecret(data.client_secret);
        setStripePromise(loadStripe(data.publishable_key, { stripeAccount: data.connect_account_id }));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [invoiceId]);

  const totalLabel = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amountCents / 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Charge Card</h2>
            <p className="text-xs text-gray-500 mt-0.5">Invoice {invoiceNumber} — {totalLabel}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <div className="p-5">
          {loading && <p className="text-sm text-gray-500">Initializing...</p>}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">{error}</div>
          )}
          {stripePromise && clientSecret && (
            <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
              <CheckoutForm invoiceId={invoiceId} onSuccess={onSuccess} totalLabel={totalLabel} />
            </Elements>
          )}
        </div>
      </div>
    </div>
  );
}

function CheckoutForm({ invoiceId, onSuccess, totalLabel }: { invoiceId: number | string; onSuccess: () => void; totalLabel: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setErr(null);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setErr(submitError.message || "Card validation failed");
      setSubmitting(false);
      return;
    }

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (error) {
      setErr(error.message || "Payment failed");
      setSubmitting(false);
    } else if (paymentIntent && paymentIntent.status === "succeeded") {
      // Record payment server-side (Connect PIs don't fire on platform webhook)
      try {
        await fetch("/api/invoices/charge-card/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoice_id: invoiceId, payment_intent_id: paymentIntent.id }),
        });
      } catch {}
      onSuccess();
    } else {
      setErr("Payment did not complete");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {err && <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">{err}</div>}
      <button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full px-4 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
      >
        {submitting ? "Processing..." : `Charge ${totalLabel}`}
      </button>
    </form>
  );
}
