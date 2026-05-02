"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import { CheckCircle2, XCircle, PlayCircle, Plus, Trash2 } from "lucide-react";

type SimRow = { tech_id: string; date: string; appointments: string; repairs: string };

export default function ScheduleTesterPage() {
  const { tenantUser } = useAuth();
  const [tab, setTab] = useState<"interactive" | "regression">("interactive");

  const [techs, setTechs] = useState<any[]>([]);
  useEffect(() => {
    if (!tenantUser?.tenant_id) return;
    supabase.from("technicians").select("id, tech_name, max_daily_appointments, max_daily_repairs")
      .eq("tenant_id", tenantUser.tenant_id).eq("is_active", true)
      .then(({ data }) => setTechs(data || []));
  }, [tenantUser?.tenant_id]);

  // Interactive
  const [zip, setZip] = useState("75034");
  const [appliance, setAppliance] = useState("Dishwasher");
  const [jobType, setJobType] = useState("Diagnosis");
  const [assignedTech, setAssignedTech] = useState("");
  const [sims, setSims] = useState<SimRow[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  const runInteractive = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/schedule-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantUser?.tenant_id,
          zip,
          appliance_type: appliance,
          job_type: jobType,
          assigned_tech_id: assignedTech ? Number(assignedTech) : null,
          simulated_capacity: sims.map((s) => ({
            tech_id: Number(s.tech_id),
            date: s.date,
            appointments: Number(s.appointments) || 0,
            repairs: Number(s.repairs) || 0,
          })),
        }),
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ error: (err as Error).message });
    } finally {
      setRunning(false);
    }
  };

  // Regression
  const [regResults, setRegResults] = useState<any | null>(null);
  const [regRunning, setRegRunning] = useState(false);
  const runRegression = async () => {
    setRegRunning(true);
    setRegResults(null);
    try {
      const res = await fetch("/api/admin/regression-tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantUser?.tenant_id }),
      });
      const data = await res.json();
      setRegResults(data);
    } catch (err) {
      setRegResults({ error: (err as Error).message });
    } finally {
      setRegRunning(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Schedule Tester</h1>
      <p className="text-sm text-gray-500 mb-6">
        Verify scheduling rules — capacity, days off, skills, time windows. All test data is created and cleaned up automatically.
      </p>

      <div className="flex border-b border-gray-200 mb-6">
        <button
          onClick={() => setTab("interactive")}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === "interactive" ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-500"}`}
        >
          Interactive Tester
        </button>
        <button
          onClick={() => setTab("regression")}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === "regression" ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-500"}`}
        >
          Regression Tests
        </button>
      </div>

      {tab === "interactive" && (
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Inputs</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Customer ZIP</label>
                <input value={zip} onChange={(e) => setZip(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Appliance Type</label>
                <input value={appliance} onChange={(e) => setAppliance(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg" placeholder="Dishwasher, Microwave, etc." />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Job Type</label>
                <select value={jobType} onChange={(e) => setJobType(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg">
                  <option>Diagnosis</option>
                  <option>Repair Follow-up</option>
                  <option>Recall</option>
                </select>
              </div>
              {jobType === "Repair Follow-up" && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Assigned Tech (required for Repair)</label>
                  <select value={assignedTech} onChange={(e) => setAssignedTech(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg">
                    <option value="">— pick —</option>
                    {techs.map((t) => <option key={t.id} value={t.id}>{t.tech_name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-500 uppercase">Simulated Capacity (overrides for test)</label>
                  <button
                    onClick={() => setSims([...sims, { tech_id: String(techs[0]?.id || ""), date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), appointments: "0", repairs: "0" }])}
                    className="flex items-center gap-1 text-xs text-indigo-600 font-medium"
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>
                {sims.map((s, i) => (
                  <div key={i} className="flex gap-2 mb-2 items-center">
                    <select value={s.tech_id} onChange={(e) => setSims(sims.map((x, idx) => idx === i ? { ...x, tech_id: e.target.value } : x))} className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded">
                      {techs.map((t) => <option key={t.id} value={t.id}>{t.tech_name}</option>)}
                    </select>
                    <input type="date" value={s.date} onChange={(e) => setSims(sims.map((x, idx) => idx === i ? { ...x, date: e.target.value } : x))} className="px-2 py-1.5 text-xs border border-gray-300 rounded" />
                    <input type="number" value={s.appointments} onChange={(e) => setSims(sims.map((x, idx) => idx === i ? { ...x, appointments: e.target.value } : x))} className="w-14 px-2 py-1.5 text-xs border border-gray-300 rounded" placeholder="appts" />
                    <input type="number" value={s.repairs} onChange={(e) => setSims(sims.map((x, idx) => idx === i ? { ...x, repairs: e.target.value } : x))} className="w-14 px-2 py-1.5 text-xs border border-gray-300 rounded" placeholder="rep" />
                    <button onClick={() => setSims(sims.filter((_, idx) => idx !== i))} className="text-red-500"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
              <button
                onClick={runInteractive}
                disabled={running}
                className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                <PlayCircle size={16} />
                {running ? "Running..." : "Run Test"}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Result</h2>
            {!result ? (
              <p className="text-sm text-gray-400">Run a test to see results</p>
            ) : result.error ? (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">{result.error}</div>
            ) : (
              <pre className="text-xs bg-gray-50 p-3 rounded-lg overflow-auto whitespace-pre-wrap">{JSON.stringify(result.slots, null, 2)}</pre>
            )}
          </div>
        </div>
      )}

      {tab === "regression" && (
        <div>
          <button
            onClick={runRegression}
            disabled={regRunning}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 mb-4"
          >
            <PlayCircle size={16} />
            {regRunning ? "Running tests..." : "Run All Regression Tests"}
          </button>

          {regResults?.error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg">{regResults.error}</div>
          )}

          {regResults?.results && (
            <div>
              <div className="mb-4 flex gap-4 text-sm">
                <span className="text-green-700 font-semibold">{regResults.passed} passed</span>
                <span className="text-red-700 font-semibold">{regResults.failed} failed</span>
                <span className="text-gray-500">of {regResults.total} total</span>
              </div>
              <div className="space-y-2">
                {regResults.results.map((r: any, i: number) => (
                  <div key={i} className={`p-4 rounded-lg border ${r.passed ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
                    <div className="flex items-start gap-3">
                      {r.passed ? <CheckCircle2 size={18} className="text-green-600 flex-shrink-0 mt-0.5" /> : <XCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />}
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-900">{r.name}</p>
                        <p className="text-xs text-gray-600 mt-1"><strong>Expected:</strong> {r.expected}</p>
                        <p className="text-xs text-gray-600"><strong>Actual:</strong> {r.actual}</p>
                        {!r.passed && <p className="text-xs text-red-700 mt-1">{r.message}</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
