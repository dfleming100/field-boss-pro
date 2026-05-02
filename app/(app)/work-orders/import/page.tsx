"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Upload, CheckCircle2, AlertCircle, RefreshCcw } from "lucide-react";

// ── CSV parser (RFC 4180-ish, handles quoted multi-line fields) ──────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim().length > 0));
}

// dispatch.me export: row 1 is metadata, row 2 is header, rest are data
function parseDispatchCsv(text: string): { header: string[]; rows: Record<string, string>[] } {
  const all = parseCsv(text);
  if (all.length < 2) return { header: [], rows: [] };
  // Row 1 is the metadata blob (e.g., "AllJobsCreatedinselectedDateRange..."). Header is row 2.
  const headerIdx = all[0].length === 1 ? 1 : 0;
  const header = all[headerIdx].map((h) => h.trim());
  const rows = all.slice(headerIdx + 1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
  return { header, rows };
}

interface ParsedRow {
  raw: Record<string, string>;
  jobId: string;             // dispatch.me job id (e.g., 110466919) → ahs_dispatch_id
  ahsWoNumber: string;       // from title prefix (e.g., 38984009) → work_order_number
  priority: string;          // NORMAL | XFERVENDOR
  customerName: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
  appliances: string[];      // Admin sets in the preview before confirming (multi-select)
  willSkip: boolean;
  skipReason?: string;
}

const APPLIANCE_TYPES = [
  "Refrigerator", "Freezer", "Ice Maker",
  "Washer", "Dryer",
  "Dishwasher",
  "Oven", "Range", "Cooktop", "Microwave", "Range Hood",
  "Garbage Disposal", "Wine Cooler",
  "Other",
];

function normalizePhone(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function parseTitle(title: string): { ahsWoNumber: string; priority: string } {
  // Format: "38984009 APL Normal:NORMAL" or "38641669 APL Normal:XFERVENDOR"
  const t = (title || "").trim();
  const firstSpace = t.indexOf(" ");
  const woNum = firstSpace > 0 ? t.slice(0, firstSpace) : t;
  const colon = t.lastIndexOf(":");
  const priority = colon > 0 ? t.slice(colon + 1).trim() : "";
  return { ahsWoNumber: woNum, priority };
}

function shapeRow(raw: Record<string, string>): ParsedRow {
  const { ahsWoNumber, priority } = parseTitle(raw["title"] || "");
  return {
    raw,
    jobId: (raw["job id"] || "").trim(),
    ahsWoNumber,
    priority: priority || "NORMAL",
    customerName: (raw["customer"] || "").trim(),
    email: (raw["customer_email"] || "").trim(),
    phone: normalizePhone(raw["customer_mobile"] || ""),
    street: (raw["street"] || "").trim(),
    city: (raw["city"] || "").trim(),
    state: "TX", // dispatch.me CSV doesn't include state; all our jobs are TX
    zip: (raw["postal_code"] || "").trim(),
    notes: (raw["notes"] || "").trim(),
    appliances: [],
    willSkip: false,
  };
}

export default function AhsCsvImportPage() {
  const router = useRouter();
  const { tenantUser, loading } = useAuth();

  const [csvText, setCsvText] = useState("");
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState("");
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);

  const tenantId = tenantUser?.tenant_id;
  const isAdmin = tenantUser?.role === "admin" || tenantUser?.role === "manager";

  const toCreate = useMemo(() => parsed.filter((r) => !r.willSkip), [parsed]);
  const toSkip = useMemo(() => parsed.filter((r) => r.willSkip), [parsed]);
  const missingAppliance = useMemo(() => toCreate.filter((r) => r.appliances.length === 0).length, [toCreate]);
  const [appliancePopoverFor, setAppliancePopoverFor] = useState<string | null>(null);

  const toggleAppliance = (rowJobId: string, appliance: string) => {
    setParsed((prev) => prev.map((r) => {
      if (r.jobId !== rowJobId) return r;
      const has = r.appliances.includes(appliance);
      return { ...r, appliances: has ? r.appliances.filter((a) => a !== appliance) : [...r.appliances, appliance] };
    }));
  };

  if (loading) {
    return <div className="p-8 text-gray-500">Loading…</div>;
  }
  if (!isAdmin) {
    return <div className="p-8 text-red-600">Admin access required.</div>;
  }

  const handleFile = async (file: File) => {
    const text = await file.text();
    setCsvText(text);
  };

  const handleParse = async () => {
    setParseError("");
    setResult(null);
    setParsed([]);
    if (!csvText.trim()) {
      setParseError("Paste a CSV or upload a file first.");
      return;
    }
    let parsed: ParsedRow[];
    try {
      const { rows } = parseDispatchCsv(csvText);
      parsed = rows
        .filter((r) => (r["job id"] || "").trim().length > 0)
        .map(shapeRow);
    } catch (err) {
      setParseError("Could not parse CSV: " + (err as Error).message);
      return;
    }
    if (parsed.length === 0) {
      setParseError("No data rows found. Check that this is the dispatch.me export CSV.");
      return;
    }

    // Mark dupes by ahs_dispatch_id within this tenant
    setChecking(true);
    try {
      const ids = parsed.map((p) => Number(p.jobId)).filter((n) => !isNaN(n));
      if (ids.length > 0 && tenantId) {
        const { data: existing } = await supabase
          .from("work_orders")
          .select("ahs_dispatch_id")
          .eq("tenant_id", tenantId)
          .in("ahs_dispatch_id", ids);
        const existingSet = new Set((existing || []).map((e: any) => String(e.ahs_dispatch_id)));
        parsed = parsed.map((r) =>
          existingSet.has(r.jobId)
            ? { ...r, willSkip: true, skipReason: "Already imported" }
            : r
        );
      }
    } finally {
      setChecking(false);
    }

    setParsed(parsed);
  };

  const handleImport = async () => {
    if (!tenantId || toCreate.length === 0) return;
    setImporting(true);
    setResult(null);
    const errors: string[] = [];
    let created = 0;

    for (const row of toCreate) {
      try {
        // Find-or-create customer
        let customerId: number | null = null;
        if (row.phone && row.phone.length >= 7) {
          const last7 = row.phone.slice(-7);
          const { data: phoneMatch } = await supabase
            .from("customers")
            .select("id")
            .eq("tenant_id", tenantId)
            .ilike("phone", `%${last7}%`)
            .limit(1);
          if (phoneMatch && phoneMatch.length > 0) customerId = phoneMatch[0].id;
        }
        if (!customerId && row.street) {
          const { data: addrMatch } = await supabase
            .from("customers")
            .select("id")
            .eq("tenant_id", tenantId)
            .ilike("service_address", `%${row.street}%`)
            .limit(1);
          if (addrMatch && addrMatch.length > 0) customerId = addrMatch[0].id;
        }
        if (!customerId) {
          const { data: newCust, error: custErr } = await supabase
            .from("customers")
            .insert({
              tenant_id: tenantId,
              customer_name: row.customerName,
              phone: row.phone || null,
              email: row.email || null,
              service_address: row.street || null,
              city: row.city || null,
              state: row.state || null,
              zip: row.zip || null,
            })
            .select("id")
            .single();
          if (custErr) {
            errors.push(`${row.ahsWoNumber} (${row.customerName}): customer create — ${custErr.message}`);
            continue;
          }
          customerId = newCust!.id;
        }

        const jobIdNum = Number(row.jobId);
        const isXfer = row.priority === "XFERVENDOR";
        const { error: woErr } = await supabase
          .from("work_orders")
          .insert({
            tenant_id: tenantId,
            customer_id: customerId,
            work_order_number: row.ahsWoNumber || null,
            status: "New Hold",
            source: "ahs",
            warranty_company: "AHS",
            warranty_wo_number: row.ahsWoNumber || null,
            ahs_dispatch_id: !isNaN(jobIdNum) ? jobIdNum : null,
            priority: "Normal",
            dispatch_type: isXfer ? "Vendor Transfer" : "Original",
            appliance_type: row.appliances.length > 0 ? row.appliances.join(", ") : null,
            notes: row.notes || null,
            description: `Imported from dispatch.me CSV${isXfer ? " (Vendor Transfer)" : ""}`,
          });
        if (woErr) {
          errors.push(`${row.ahsWoNumber} (${row.customerName}): WO create — ${woErr.message}`);
          continue;
        }
        created++;
      } catch (err) {
        errors.push(`${row.ahsWoNumber}: ${(err as Error).message}`);
      }
    }

    setResult({ created, skipped: toSkip.length, errors });
    setImporting(false);
  };

  const handleReset = () => {
    setCsvText("");
    setParsed([]);
    setParseError("");
    setResult(null);
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <button
        onClick={() => router.push("/work-orders")}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
      >
        <ArrowLeft size={16} /> Back to Work Orders
      </button>

      <h1 className="text-2xl font-bold mb-1">Import AHS CSV</h1>
      <p className="text-gray-600 mb-6">
        Paste or upload the dispatch.me <em>New Calls</em> CSV export. Rows land in status{" "}
        <span className="font-medium">New Hold</span> — no outreach fires until you Release them.
      </p>

      {!result && parsed.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-5 mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Upload CSV file</label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="block mb-4 text-sm"
          />
          <label className="block text-sm font-medium text-gray-700 mb-2">…or paste CSV text</label>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={8}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-xs"
            placeholder="job id,created date,customer,..."
          />
          {parseError && (
            <div className="mt-3 flex items-start gap-2 text-red-700 bg-red-50 border border-red-200 rounded p-3 text-sm">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{parseError}</span>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button
              onClick={handleParse}
              disabled={checking || !csvText.trim()}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Upload size={16} /> {checking ? "Checking duplicates…" : "Preview Import"}
            </button>
          </div>
        </div>
      )}

      {parsed.length > 0 && !result && (
        <div className="bg-white rounded-lg border border-gray-200 mb-4">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <div className="font-medium">
                {parsed.length} row{parsed.length === 1 ? "" : "s"} parsed
              </div>
              <div className="text-sm text-gray-600">
                {toCreate.length} will be created · {toSkip.length} skipped (already imported)
              </div>
              {missingAppliance > 0 && (
                <div className="text-xs text-amber-700 mt-1">
                  {missingAppliance} row{missingAppliance === 1 ? "" : "s"} missing appliance type — AI scheduler can't route until it's set
                </div>
              )}
            </div>
            <button
              onClick={handleReset}
              className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
            >
              <RefreshCcw size={14} /> Start over
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">AHS WO #</th>
                  <th className="text-left px-3 py-2">Customer</th>
                  <th className="text-left px-3 py-2">Address</th>
                  <th className="text-left px-3 py-2">Phone</th>
                  <th className="text-left px-3 py-2">Appliance *</th>
                  <th className="text-left px-3 py-2">Priority</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((r, idx) => (
                  <tr key={r.jobId + idx} className={r.willSkip ? "bg-gray-50 text-gray-400" : ""}>
                    <td className="px-3 py-2">
                      {r.willSkip ? (
                        <span className="inline-flex items-center gap-1 text-amber-600 text-xs">
                          <AlertCircle size={12} /> Skip
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-600 text-xs">
                          <CheckCircle2 size={12} /> Create
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono">{r.ahsWoNumber}</td>
                    <td className="px-3 py-2">{r.customerName}</td>
                    <td className="px-3 py-2">
                      {r.street}, {r.city} {r.zip}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.phone}</td>
                    <td className="px-3 py-2">
                      {!r.willSkip && (
                        <button
                          type="button"
                          onClick={() => setAppliancePopoverFor(r.jobId)}
                          className={`text-xs border rounded px-2 py-1 text-left min-w-[140px] ${r.appliances.length > 0 ? "border-gray-300 bg-white" : "border-amber-300 bg-amber-50"}`}
                        >
                          {r.appliances.length > 0 ? r.appliances.join(", ") : "— pick —"}
                          <span className="ml-1 text-gray-400">▾</span>
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.priority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-4 border-t border-gray-200 flex gap-2 justify-end">
            <button
              onClick={handleReset}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={importing || toCreate.length === 0}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {importing ? "Importing…" : `Confirm Import (${toCreate.length})`}
            </button>
          </div>
        </div>
      )}

      {/* Appliance picker modal — centered so it never gets clipped by table edges */}
      {appliancePopoverFor && (() => {
        const row = parsed.find((p) => p.jobId === appliancePopoverFor);
        if (!row) return null;
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setAppliancePopoverFor(null)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-gray-200">
                <h3 className="text-base font-semibold text-gray-900">Pick appliances</h3>
                <p className="text-xs text-gray-500 mt-0.5">{row.customerName} · WO {row.ahsWoNumber}</p>
              </div>
              <div className="px-3 py-2 overflow-y-auto flex-1">
                {APPLIANCE_TYPES.map((a) => {
                  const checked = row.appliances.includes(a);
                  return (
                    <label key={a} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-gray-50 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAppliance(row.jobId, a)}
                        className="w-4 h-4"
                      />
                      <span className="text-gray-800">{a}</span>
                    </label>
                  );
                })}
              </div>
              <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
                <button
                  type="button"
                  onClick={() => setAppliancePopoverFor(null)}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {result && (
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-lg font-bold mb-3">Import complete</h2>
          <ul className="space-y-1 text-sm mb-4">
            <li>
              <span className="font-medium text-emerald-600">{result.created}</span> work orders
              created in <span className="font-medium">New Hold</span>
            </li>
            <li>
              <span className="font-medium text-amber-600">{result.skipped}</span> skipped (already
              imported)
            </li>
            {result.errors.length > 0 && (
              <li>
                <span className="font-medium text-red-600">{result.errors.length}</span> errors
              </li>
            )}
          </ul>
          {result.errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-xs space-y-1 mb-4">
              {result.errors.map((e, i) => (
                <div key={i} className="text-red-700">
                  {e}
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/work-orders?status=New+Hold")}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              View New Hold WOs
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Import another CSV
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
