"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import Link from "next/link";
export default function MemberDashboardPage() {
  const { data: billsData, isLoading: billsLoading } = useQuery({
    queryKey: ["member-dashboard-bills"],
    queryFn: () => apiClient.get("/api/member/bills?limit=5&status=all"),
  });
  const { data: ledgerData, isLoading: ledgerLoading } = useQuery({
    queryKey: ["member-dashboard-ledger"],
    queryFn: () => apiClient.get("/api/member/ledger?limit=5"),
  });
  const summary = billsData?.summary || {};
  const recentBills = billsData?.bills || [];
  const recentTxns = ledgerData?.transactions || [];
  const statusColors = {
    Paid: { bg: "var(--success-bg)", color: "var(--success-fg)" },
    Unpaid: { bg: "var(--danger-bg)", color: "var(--danger-fg)" },
    Partial: { bg: "var(--warning-bg)", color: "var(--warning-fg)" },
    Overdue: { bg: "var(--danger-bg)", color: "var(--danger-fg)" },
  };
  return (
    <div style={{ padding: "0 0 2rem 0" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: "700", color: "var(--fg-1)", margin: 0 }}>
          📊 Dashboard
        </h1>
        <p style={{ color: "var(--fg-4)", marginTop: "4px", fontSize: "0.9rem" }}>
          Welcome back! Here's your account overview.
        </p>
      </div>
      {/* Stats Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        {[
          {
            label: "Total Bills",
            value: summary.total || 0,
            color: "var(--primary)",
            icon: "📄",
          },
          {
            label: "Total Paid",
            value: `₹${(summary.totalPaid || 0).toLocaleString("en-IN")}`,
            color: "var(--success)",
            icon: "✅",
          },
          {
            label: "Outstanding",
            value: `₹${(summary.totalOutstanding || 0).toLocaleString("en-IN")}`,
            color: "var(--danger)",
            icon: "⚠️",
          },
          {
            label: "Total Billed",
            /* TODO: unmapped color, needs design review */
            color: "var(--accent)",
            value: `₹${(summary.totalAmount || 0).toLocaleString("en-IN")}`,
            icon: "💰",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              background: "var(--bg-surface)",
              borderRadius: "10px",
              padding: "20px",
              boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
              border: "1px solid var(--border)",
              borderLeft: `4px solid ${stat.color}`,
            }}
          >
            <div style={{ fontSize: "1.4rem", marginBottom: "6px" }}>{stat.icon}</div>
            <div style={{ fontSize: "0.78rem", color: "var(--fg-4)", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {stat.label}
            </div>
            <div style={{ fontSize: "1.35rem", fontWeight: "700", color: "var(--fg-1)", marginTop: "4px" }}>
              {billsLoading ? "..." : stat.value}
            </div>
          </div>
        ))}
      </div>
      {/* Quick Links */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1.75rem",
        }}
      >
        {[
          { label: "My Bills", path: "/member/my-bills", icon: "📄" },
          { label: "My Ledger", path: "/member/my-ledger", icon: "📒" },
          { label: "Make Payment", path: "/member/make-payment", icon: "💳" },
          { label: "Receipts", path: "/member/receipts", icon: "🧾" },
          { label: "Notices", path: "/member/notices", icon: "📢" },
          { label: "Complaints", path: "/member/complaints", icon: "📝" },
        ].map((link) => (
          <Link
            key={link.path}
            href={link.path}
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              padding: "16px 12px",
              textAlign: "center",
              textDecoration: "none",
              color: "var(--fg-3)",
              fontWeight: "600",
              fontSize: "0.85rem",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              transition: "box-shadow 0.15s",
              display: "block",
            }}
          >
            <div style={{ fontSize: "1.6rem", marginBottom: "6px" }}>{link.icon}</div>
            {link.label}
          </Link>
        ))}
      </div>
      {/* Two column: recent bills + recent transactions */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "1.25rem",
        }}
      >
        {/* Recent Bills */}
        <div
          style={{
            background: "var(--bg-surface)",
            borderRadius: "10px",
            border: "1px solid var(--border)",
            boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: "700", color: "var(--fg-1)" }}>
              📄 Recent Bills
            </h2>
            <Link href="/member/my-bills" style={{ fontSize: "0.8rem", color: "var(--primary)", textDecoration: "none" }}>
              View all →
            </Link>
          </div>
          <div style={{ padding: "0 12px 12px" }}>
            {billsLoading ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--fg-5)" }}>Loading...</div>
            ) : recentBills.length === 0 ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--fg-5)" }}>No bills yet</div>
            ) : (
              recentBills.map((bill) => {
                const sc = statusColors[bill.status] || statusColors.Unpaid;
                return (
                  <div
                    key={bill._id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 8px",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: "600", fontSize: "0.875rem", color: "var(--fg-2)" }}>
                        {bill.billPeriodId}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--fg-4)" }}>
                        Due: {new Date(bill.dueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: "700", fontSize: "0.9rem", color: "var(--fg-1)" }}>
                        ₹{bill.totalAmount?.toLocaleString("en-IN")}
                      </div>
                      <span
                        style={{
                          background: sc.bg,
                          color: sc.color,
                          padding: "2px 8px",
                          borderRadius: "10px",
                          fontSize: "11px",
                          fontWeight: "700",
                        }}
                      >
                        {bill.status}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
        {/* Recent Transactions */}
        <div
          style={{
            background: "var(--bg-surface)",
            borderRadius: "10px",
            border: "1px solid var(--border)",
            boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: "700", color: "var(--fg-1)" }}>
              📒 Recent Transactions
            </h2>
            <Link href="/member/my-ledger" style={{ fontSize: "0.8rem", color: "var(--primary)", textDecoration: "none" }}>
              View all →
            </Link>
          </div>
          <div style={{ padding: "0 12px 12px" }}>
            {ledgerLoading ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--fg-5)" }}>Loading...</div>
            ) : recentTxns.length === 0 ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--fg-5)" }}>No transactions yet</div>
            ) : (
              recentTxns.map((txn, i) => (
                <div
                  key={txn._id || i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 8px",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: "600", fontSize: "0.875rem", color: "var(--fg-2)" }}>
                      {txn.description || txn.type || "Transaction"}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--fg-4)" }}>
                      {txn.date
                        ? new Date(txn.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                        : "—"}
                    </div>
                  </div>
                  <div
                    style={{
                      fontWeight: "700",
                      fontSize: "0.9rem",
                      color: txn.type === "Credit" || txn.credit > 0 ? "var(--success)" : "var(--danger)",
                    }}
                  >
                    {txn.credit > 0
                      ? `+₹${txn.credit.toLocaleString("en-IN")}`
                      : `₹${(txn.debit || txn.amount || 0).toLocaleString("en-IN")}`}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
