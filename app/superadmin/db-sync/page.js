"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import notify from "@/lib/notify";

async function adminFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function DbSyncPage() {
  const qc = useQueryClient();
  const [lastResult, setLastResult] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["db-sync-status"],
    queryFn: () => adminFetch("/api/superadmin/db-sync"),
  });

  const copyMutation = useMutation({
    mutationFn: () => adminFetch("/api/superadmin/db-sync", { method: "POST" }),
    onSuccess: (res) => {
      setLastResult(res);
      notify.success(`Copied ${res.totalInserted} missing document(s) into staging.`);
      qc.invalidateQueries({ queryKey: ["db-sync-status"] });
    },
    onError: (err) => notify.error(err.message),
  });

  const collections = data?.collections || [];
  const totalMissing = data?.totalMissing ?? 0;
  const allInSync = !isLoading && !error && totalMissing === 0 && collections.length > 0;

  return (
    <div style={{ padding: 0, maxWidth: 1100, margin: "0 auto", color: "var(--fg-2)" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: "var(--fg-2)" }}>DB Sync — Test → Staging</h1>
        <p style={{ color: "var(--fg-4)", fontSize: "0.85rem", marginTop: 4 }}>
          One-way copy from the test cluster into staging. Skips documents that already exist in
          staging — never overwrites, never deletes.
        </p>
      </div>

      {error && (
        <div style={{ padding: "1rem 1.25rem", borderRadius: 8, background: "var(--danger-bg, #fee)", border: "1px solid var(--danger)", color: "var(--danger)", marginBottom: "1.25rem" }}>
          {error.message}
          {error.message?.includes("MONGODB_STAGING_URI") && (
            <div style={{ marginTop: 6, fontSize: 13 }}>
              Add <code>MONGODB_STAGING_URI</code> to your env vars (Vercel project settings or
              .env.local) with the staging cluster's connection string.
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          padding: "1rem 1.25rem",
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "var(--bg-surface)",
          marginBottom: "1.25rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 600 }}>
          <span style={{ fontSize: 20 }}>{allInSync ? "✅" : isLoading ? "⏳" : "🟡"}</span>
          {isLoading
            ? "Checking status..."
            : allInSync
            ? "All collections in sync"
            : `${totalMissing} document(s) missing in staging`}
        </div>
        <button
          onClick={() => copyMutation.mutate()}
          disabled={copyMutation.isPending || isLoading || totalMissing === 0}
          style={{
            padding: "0.65rem 1.4rem",
            borderRadius: 8,
            border: "none",
            fontWeight: 700,
            cursor: totalMissing > 0 ? "pointer" : "not-allowed",
            background: totalMissing > 0 ? "var(--primary)" : "var(--border)",
            color: totalMissing > 0 ? "#fff" : "var(--fg-5)",
          }}
        >
          {copyMutation.isPending ? "Copying..." : "⬇ Copy Missing to Staging"}
        </button>
      </div>

      {lastResult && (
        <div style={{ padding: "0.9rem 1.25rem", borderRadius: 8, background: "var(--success-bg)", border: "1px solid var(--success)", color: "var(--success-fg)", marginBottom: "1.25rem", fontSize: 13 }}>
          Last sync: inserted {lastResult.totalInserted} document(s) across{" "}
          {lastResult.results.filter((r) => r.inserted > 0).length} collection(s).
        </div>
      )}

      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--bg-sunken)" }}>
              {["Collection", "Test", "Staging", "Missing", "Status"].map((h) => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} style={{ padding: "2rem", textAlign: "center", color: "var(--fg-4)" }}>Loading...</td></tr>
            ) : collections.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: "2rem", textAlign: "center", color: "var(--fg-4)" }}>No collections found.</td></tr>
            ) : (
              collections.map((c) => (
                <tr key={c.name} style={{ borderBottom: "1px solid var(--bg-muted)" }}>
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "var(--fg-2)" }}>{c.name}</td>
                  <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{c.testCount}</td>
                  <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{c.stagingCount}</td>
                  <td style={{ padding: "10px 12px", color: c.missing > 0 ? "var(--warning)" : "var(--fg-3)" }}>{c.missing}</td>
                  <td style={{ padding: "10px 12px" }}>
                    {c.inSync ? (
                      <span style={{ color: "var(--success)" }}>✅ in sync</span>
                    ) : (
                      <span style={{ color: "var(--warning)" }}>🟡 {c.missing} missing</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
