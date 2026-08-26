"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useState } from "react";
import styles from "@/styles/Dashboard.module.css";
import notify from "@/lib/notify";
export default function ReceiptsPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["my-receipts", page],
    queryFn: () => apiClient.get(`/api/member/receipts?page=${page}&limit=20`),
  });
  const receipts = data?.receipts || [];
  const pagination = data?.pagination || {};
  const downloadReceipt = async (receiptId) => {
    const response = await fetch(`/api/member/receipts/${receiptId}/download`, {
      credentials: "include",
    });
    if (!response.ok) {
      notify.error("Download failed");
      return;
    }
    const html = await response.text();
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (!w) notify.warning("Popup blocked");
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>🧾 My Receipts</h1>
          <p className={styles.pageSubtitle}>
            All payment receipts for your account
          </p>
        </div>
      </div>
      {isLoading ? (
        <div style={{ padding: "3rem", textAlign: "center" }}>
          <div className="loading-spinner" style={{ margin: "0 auto" }}></div>
        </div>
      ) : receipts.length === 0 ? (
        <div style={{ padding: "3rem", textAlign: "center", color: "var(--fg-5)" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🧾</div>
          <p
            style={{ fontSize: "1.1rem", fontWeight: "600", color: "var(--fg-3)" }}
          >
            No receipts yet
          </p>
          <p style={{ marginTop: "6px" }}>
            Receipts will appear here after you make payments
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {receipts.map((receipt) => (
            <div
              key={receipt._id}
              style={{
                background: "var(--bg-surface)",
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
                style={{ display: "flex", gap: "16px", alignItems: "center" }}
              >
                <div
                  style={{
                    width: "44px",
                    height: "44px",
                    background: "var(--success-bg)",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "20px",
                  }}
                >
                  🧾
                </div>
                <div>
                  <div
                    style={{
                      fontWeight: "700",
                      color: "var(--fg-2)",
                      fontSize: "1rem",
                    }}
                  >
                    {receipt.receiptNo}
                  </div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--fg-4)",
                      marginTop: "3px",
                    }}
                  >
                    {receipt.billPeriodId} • {receipt.paymentMode} •{" "}
                    {new Date(receipt.paidAt).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </div>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--fg-5)",
                      marginTop: "2px",
                      fontFamily: "monospace",
                    }}
                  >
                    {receipt.filename}
                  </div>
                </div>
              </div>
              <div
                style={{ display: "flex", alignItems: "center", gap: "16px" }}
              >
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontSize: "1.25rem",
                      fontWeight: "700",
                      color: "var(--success)",
                    }}
                  >
                    ₹{receipt.amount.toLocaleString("en-IN")}
                  </div>
                  <span
                    style={{
                      fontSize: "11px",
                      padding: "2px 8px",
                      borderRadius: "12px",
                      fontWeight: "600",
                      background:
                        receipt.status === "Downloaded" ? "var(--primary-tint)" : "var(--success-bg)",
                      color:
                        receipt.status === "Downloaded" ? "var(--info)" : "var(--success-fg)",
                    }}
                  >
                    {receipt.status}
                  </span>
                </div>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: "0.875rem" }}
                  onClick={() => downloadReceipt(receipt._id)}
                >
                  ⬇️ Download
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
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
              background: "var(--bg-surface)",
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
    </div>
  );
}
