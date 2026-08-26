"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/admin-api";
export default function AdminDashboard() {
  const [admin, setAdmin] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const router = useRouter();
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        const user = data.user || data;
        if (user.role !== "SuperAdmin") router.push("/superadmin/login");
        else setAdmin(user);
      })
      .catch(() => router.push("/superadmin/login"));
  }, [router]);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-societies"],
    queryFn: adminApi.fetchSocieties,
    staleTime: 5 * 60 * 1000,
    enabled: !!admin,
  });
  const societies = data?.societies || [];
  const stats = {
    totalSocieties: societies.length,
    totalMembers: societies.reduce((sum, s) => sum + (s.stats?.members || 0), 0),
    totalBills: societies.reduce((sum, s) => sum + (s.stats?.bills || 0), 0),
    activeSocieties: societies.filter((s) => s.subscription?.status === "Active").length,
  };
  const filteredSocieties = societies.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.contactEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.registrationNo?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === "all" || s.subscription?.status === statusFilter;
    return matchesSearch && matchesStatus;
  });
  if (!admin) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "var(--fg-4)", background: "var(--fg-1)", minHeight: "100vh" }}>
        Loading...
      </div>
    );
  }
  if (isLoading) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "var(--fg-4)", background: "var(--fg-1)", minHeight: "100vh" }}>
        Loading societies...
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "var(--danger)", background: "var(--fg-1)", minHeight: "100vh" }}>
        Error loading data: {error.message}
      </div>
    );
  }
  const statusBadgeStyle = (status) => {
    const map = {
      Active: { background: "color-mix(in srgb, var(--success) 13%, transparent)", color: "var(--success)" },
      Trial: { background: "color-mix(in srgb, var(--accent) 13%, transparent)", color: "var(--accent)" },
      Suspended: { background: "color-mix(in srgb, var(--danger) 13%, transparent)", color: "var(--danger)" },
      Expired: { background: "color-mix(in srgb, var(--fg-4) 13%, transparent)", color: "var(--fg-4)" },
    };
    return { padding: "2px 10px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 700, ...(map[status] || map.Trial) };
  };
  const filterCount = (status) =>
    status === "all" ? societies.length : societies.filter((s) => s.subscription?.status === status).length;
  return (
    <div style={{ padding: 0, maxWidth: 1400, margin: "0 auto", color: "var(--fg-2)" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: "var(--fg-2)" }}>Dashboard</h1>
        <p style={{ color: "var(--fg-4)", fontSize: "0.85rem", marginTop: 4 }}>
          Managing {stats.totalSocieties} societies · Cached data (refreshes every 5 min)
        </p>
      </div>
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
        {[
          { icon: "🏢", label: "Total Societies", value: stats.totalSocieties, accent: "var(--accent)" },
          { icon: "✅", label: "Active", value: stats.activeSocieties, accent: "var(--success)" },
          { icon: "👥", label: "Total Members", value: stats.totalMembers, accent: "#7c3aed" /* TODO: unmapped color, needs design review */ },
          { icon: "📄", label: "Total Bills", value: stats.totalBills, accent: "var(--warning)" },
        ].map((s) => (
          <div key={s.label} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px", display: "flex", alignItems: "center", gap: "1rem", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: "1.75rem" }}>{s.icon}</div>
            <div>
              <div style={{ color: "var(--fg-4)", fontSize: "13px", fontWeight: 500, marginBottom: 4 }}>{s.label}</div>
              <div style={{ color: s.accent, fontSize: "26px", fontWeight: 700, lineHeight: 1.1 }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>
      {/* Search & Filters */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text"
          placeholder="Search societies by name, email, or reg no..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            flex: 1,
            minWidth: 260,
            padding: "0.6rem 0.9rem",
            borderRadius: 8,
            border: "1px solid var(--border-strong)",
            background: "var(--bg-surface)",
            color: "var(--fg-2)",
            fontSize: "0.85rem",
            outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {["all", "Active", "Trial", "Suspended"].map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              style={{
                padding: "0.45rem 1rem",
                borderRadius: 20,
                border: "1px solid",
                borderColor: statusFilter === f ? "var(--primary)" : "var(--border)",
                background: statusFilter === f ? "var(--primary)" : "var(--bg-surface)",
                color: statusFilter === f ? "var(--bg-surface)" : "var(--fg-4)",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {f === "all" ? "All" : f} ({filterCount(f)})
            </button>
          ))}
        </div>
      </div>
      {/* Table */}
      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ background: "var(--bg-sunken)" }}>
              {["Society Name", "Admin Credentials", "Registration No", "Contact", "Members", "Bills", "Transactions", "Status", "Plan", "Actions"].map((h) => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredSocieties.map((society, i) => (
              <tr key={society._id} style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px 12px", color: "var(--fg-2)", fontWeight: 600 }}>{society.name}</td>
                <td style={{ padding: "10px 12px", fontSize: "12px" }}>
                  {society.credentials?.adminEmail ? (
                    <div>
                      <div style={{ color: "var(--fg-4)" }}>{society.credentials.adminEmail}</div>
                      <div style={{ fontFamily: "monospace", color: "var(--success)", fontWeight: 700 }}>
                        {society.credentials.plainPassword || "—"}
                      </div>
                    </div>
                  ) : "—"}
                </td>
                <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{society.registrationNo || "-"}</td>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ color: "var(--fg-3)" }}>{society.contactEmail || "-"}</div>
                  <div style={{ color: "var(--fg-5)", fontSize: "12px" }}>{society.contactPhone || "-"}</div>
                </td>
                <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{society.stats?.members || 0}</td>
                <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{society.stats?.bills || 0}</td>
                <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{society.stats?.transactions || 0}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={statusBadgeStyle(society.subscription?.status || "Trial")}>
                    {society.subscription?.status || "Trial"}
                  </span>
                </td>
                <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>{society.subscription?.planType || "Free"}</td>
                <td style={{ padding: "10px 12px" }}>
                  <button
                    onClick={() => router.push(`/superadmin/societies/${society._id}`)}
                    style={{
                      padding: "5px 14px",
                      borderRadius: 6,
                      border: "1px solid var(--primary)",
                      background: "transparent",
                      color: "var(--primary)",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Details →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredSocieties.length === 0 && (
          <div style={{ padding: "4rem", textAlign: "center", color: "var(--fg-5)", fontSize: "14px" }}>
            No societies found matching your filters
          </div>
        )}
      </div>
    </div>
  );
}
