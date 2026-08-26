"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";
import notify from "@/lib/notify";
export default function MyBillsPage() {
  const [filterStatus, setFilterStatus] = useState("all");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["my-bills", filterStatus, page],
    queryFn: () =>
      apiClient.get(
        `/api/member/bills?status=${filterStatus}&page=${page}&limit=20`,
      ),
  });
  const bills = data?.bills || [];
  const summary = data?.summary || {};
  const pagination = data?.pagination || {};
  const downloadBill = async (bill) => {
    try {
      const res = await fetch(`/api/bills/download?id=${bill._id}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        notify.error("Failed to load bill: " + (err.error || res.statusText));
        return;
      }
      const contentType = res.headers.get("content-type") || "";
      const blob = await res.blob();
      const blobWithType = new Blob([blob], {
        type: contentType.includes("pdf") ? "application/pdf" : "text/html",
      });
      const url = URL.createObjectURL(blobWithType);
      const w = window.open(url, "_blank");
      if (!w) notify.warning("Popup blocked. Please allow popups.");
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      notify.error("Download failed: " + e.message);
    }
  };
  const statusColors = {
    Paid: { bg: "var(--success-bg)", color: "var(--success-fg)" },
    Unpaid: { bg: "var(--danger-bg)", color: "var(--danger-fg)" },
    Partial: { bg: "var(--warning-bg)", color: "var(--warning-fg)" },
    Overdue: { bg: "var(--danger-bg)", color: "var(--danger-fg)" },
  };
  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>📄 My Bills</h1>
          <p className={styles.pageSubtitle}>
            View your maintenance bills
          </p>
        </div>
      </div>
      {/* Summary */}
      <div className={styles.statsGrid} style={{ marginBottom: "1.5rem" }}>
        <div
          className={styles.statCard}
          style={{ borderLeft: "4px solid var(--accent)" }}
        >
          <div className={styles.statLabel}>Total Bills</div>
          <h2 className={styles.statValue}>{pagination.total || 0}</h2>
        </div>
        <div
          className={styles.statCard}
          style={{ borderLeft: "4px solid var(--danger)" }}
        >
          <div className={styles.statLabel}>Outstanding</div>
          <h2 className={styles.statValue} style={{ color: "var(--danger)" }}>
            ₹{(summary.totalOutstanding || 0).toLocaleString("en-IN")}
          </h2>
        </div>
        <div
          className={styles.statCard}
          style={{ borderLeft: "4px solid var(--success)" }}
        >
          <div className={styles.statLabel}>Total Paid</div>
          <h2 className={styles.statValue} style={{ color: "var(--success)" }}>
            ₹{(summary.totalPaid || 0).toLocaleString("en-IN")}
          </h2>
        </div>
      </div>
      {/* Filters + Select All */}
      <div className={styles.contentCard} style={{ marginBottom: "1.5rem" }}>
        <div
          style={{
            padding: "1rem",
            display: "flex",
            gap: "1rem",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {/* Partial isn't a separate tab — "Unpaid" already covers it
              server-side (see api/member/bills/route.js); each bill still
              shows its own Partial badge with the remaining amount. */}
          {["all", "Unpaid", "Overdue", "Paid"].map((s) => (
            <button
              key={s}
              onClick={() => {
                setFilterStatus(s);
                setPage(1);
              }}
              className={
                filterStatus === s ? "btn btn-primary" : "btn btn-secondary"
              }
              style={{ fontSize: "0.875rem" }}
            >
              {s === "all" ? "All" : s}
            </button>
          ))}
          <div style={{ marginLeft: "auto" }}></div>
        </div>
      </div>
      {/* Bills List */}
      {isLoading ? (
        <div style={{ padding: "3rem", textAlign: "center" }}>
          <div className="loading-spinner" style={{ margin: "0 auto" }}></div>
        </div>
      ) : bills.length === 0 ? (
        <div style={{ padding: "3rem", textAlign: "center", color: "var(--fg-5)" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📭</div>
          <p>No bills found</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {bills.map((bill) => {
            const id = bill._id || bill.id;
            const sc = statusColors[bill.status] || statusColors.Unpaid;
            return (
              <div
                key={id}
                style={{
                  background: "white",
                  borderRadius: "10px",
                  padding: "20px 24px",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
                  border: "1px solid var(--border)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "14px" }}
                >
                  <div>
                    <div
                      style={{
                        fontWeight: "700",
                        fontSize: "1rem",
                        color: "var(--fg-2)",
                      }}
                    >
                      {bill.billPeriodId}
                    </div>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--fg-4)",
                        marginTop: "3px",
                      }}
                    >
                      Due:{" "}
                      {new Date(bill.dueDate).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </div>
                    {bill.previousBalance > 0 && (
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--danger)",
                          marginTop: "2px",
                        }}
                      >
                        Includes prev balance: ₹
                        {bill.previousBalance.toLocaleString("en-IN")}
                      </div>
                    )}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ textAlign: "right" }}>
                    <div
                      style={{
                        fontSize: "1.25rem",
                        fontWeight: "700",
                        color: "var(--fg-2)",
                      }}
                    >
                      ₹{bill.totalAmount?.toLocaleString("en-IN")}
                    </div>
                    {bill.amountPaid > 0 && (
                      <div style={{ fontSize: "0.75rem", color: "var(--success)" }}>
                        Paid: ₹{bill.amountPaid.toLocaleString("en-IN")}
                      </div>
                    )}
                    {bill.totalAmount > 0 && bill.status !== "Paid" && (
                      <div style={{ fontSize: "0.75rem", color: "var(--danger)" }}>
                        Due: ₹{bill.balanceAmount.toLocaleString("en-IN")}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
                    <span
                      style={{
                        background: sc.bg,
                        color: sc.color,
                        padding: "4px 12px",
                        borderRadius: "12px",
                        fontSize: "12px",
                        fontWeight: "700",
                      }}
                    >
                      {bill.status}
                    </span>
                    {(bill.isHistoricalArchive === true) && (
                      <span style={{ background: "var(--bg-muted)", color: "var(--fg-4)", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: "600" }}>
                        📜 Historical
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {!bill.isHistoricalArchive && (
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: "0.8rem", padding: "6px 12px" }}
                        onClick={() => downloadBill(bill)}
                      >
                        ⬇️ Bill
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* Pagination */}
      {pagination.pages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "1rem",
            marginTop: "1.5rem",
          }}
        >
          <button
            className="btn btn-secondary"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            ← Prev
          </button>
          <span
            style={{
              padding: "0.5rem 1rem",
              background: "white",
              borderRadius: "6px",
            }}
          >
            Page {page} of {pagination.pages}
          </span>
          <button
            className="btn btn-secondary"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= pagination.pages}
          >
            Next →
          </button>
        </div>
      )}
      {/* Payment Confirm Modal */}
    </div>
  );
}
