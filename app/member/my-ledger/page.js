"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";
export default function MyLedgerPage() {
  const [page, setPage] = useState(1);
  const [financialYear, setFinancialYear] = useState("all");
  const { data, isLoading } = useQuery({
    queryKey: ["my-ledger", page, financialYear],
    queryFn: () =>
      apiClient.get(
        `/api/member/ledger?page=${page}&limit=30&financialYear=${financialYear}`,
      ),
  });
  const transactions = data?.transactions || [];
  const summary = data?.summary || {};
  const pagination = data?.pagination || {};
  const currentYear = new Date().getFullYear();
  const fyOptions = Array.from({ length: 4 }, (_, i) => {
    const y = currentYear - i;
    const label =
      new Date().getMonth() >= 3 ? `FY${y}-${y + 1}` : `FY${y - 1}-${y}`;
    return label;
  });
  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>📒 My Ledger</h1>
          <p className={styles.pageSubtitle}>
            Complete transaction history for your account
          </p>
        </div>
        <select
          value={financialYear}
          onChange={(e) => {
            setFinancialYear(e.target.value);
            setPage(1);
          }}
          className="input"
          style={{ width: "180px" }}
        >
          <option value="all">All Years</option>
          {fyOptions.map((fy) => (
            <option key={fy} value={fy}>
              {fy}
            </option>
          ))}
        </select>
      </div>
      {/* Summary Cards */}
      <div className={styles.statsGrid} style={{ marginBottom: "1.5rem" }}>
        <div
          className={styles.statCard}
          style={{ borderLeft: "4px solid var(--danger)" }}
        >
          <div className={styles.statLabel}>Total Billed</div>
          <h2 className={styles.statValue}>
            ₹{(summary.totalDebit || 0).toLocaleString("en-IN")}
          </h2>
        </div>
        <div
          className={styles.statCard}
          style={{ borderLeft: "4px solid var(--success)" }}
        >
          <div className={styles.statLabel}>Total Paid</div>
          <h2 className={styles.statValue} style={{ color: "var(--success)" }}>
            ₹{(summary.totalCredit || 0).toLocaleString("en-IN")}
          </h2>
        </div>
        <div
          className={styles.statCard}
          style={{
            borderLeft:
              summary.currentBalance > 0
                ? "4px solid var(--danger)"
                : "4px solid var(--success)",
          }}
        >
          <div className={styles.statLabel}>Current Balance</div>
          <h2
            className={styles.statValue}
            style={{
              color: summary.currentBalance > 0 ? "var(--danger)" : "var(--success)",
            }}
          >
            ₹{Math.abs(summary.currentBalance || 0).toLocaleString("en-IN")}
            <span
              style={{
                fontSize: "0.875rem",
                fontWeight: "600",
                marginLeft: "6px",
              }}
            >
              {summary.currentBalance > 0
                ? "DR"
                : summary.currentBalance < 0
                  ? "CR"
                  : ""}
            </span>
          </h2>
        </div>
      </div>
      <div className={styles.contentCard}>
        {isLoading ? (
          <div style={{ padding: "3rem", textAlign: "center" }}>
            <div className="loading-spinner" style={{ margin: "0 auto" }}></div>
          </div>
        ) : transactions.length === 0 ? (
          <div
            style={{ padding: "3rem", textAlign: "center", color: "var(--fg-5)" }}
          >
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📭</div>
            <p>No transactions found</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    background: "var(--bg-sunken)",
                    borderBottom: "2px solid var(--border)",
                  }}
                >
                  <th
                    style={{
                      padding: "12px 16px",
                      textAlign: "left",
                      fontSize: "13px",
                      color: "var(--fg-4)",
                    }}
                  >
                    Date
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      textAlign: "left",
                      fontSize: "13px",
                      color: "var(--fg-4)",
                    }}
                  >
                    Description
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      textAlign: "center",
                      fontSize: "13px",
                      color: "var(--fg-4)",
                    }}
                  >
                    Type
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      textAlign: "right",
                      fontSize: "13px",
                      color: "var(--fg-4)",
                    }}
                  >
                    Debit (₹)
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      textAlign: "right",
                      fontSize: "13px",
                      color: "var(--fg-4)",
                    }}
                  >
                    Credit (₹)
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      textAlign: "right",
                      fontSize: "13px",
                      color: "var(--fg-4)",
                    }}
                  >
                    Balance (₹)
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((txn, i) => (
                  <tr
                    key={txn._id}
                    style={{
                      borderBottom: "1px solid var(--bg-muted)",
                      background: i % 2 === 0 ? "white" : "var(--bg-sunken)",
                    }}
                  >
                    <td
                      style={{
                        padding: "12px 16px",
                        fontSize: "13px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {new Date(txn.date).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        fontSize: "13px",
                        maxWidth: "280px",
                      }}
                    >
                      <div style={{ fontWeight: "500", color: "var(--fg-2)" }}>
                        {txn.description}
                      </div>
                      {txn.billPeriodId && (
                        <div
                          style={{
                            fontSize: "11px",
                            color: "var(--fg-5)",
                            marginTop: "2px",
                          }}
                        >
                          {txn.billPeriodId}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "center" }}>
                      <span
                        style={{
                          background:
                            txn.category === "Interest"
                              ? "var(--warning-bg)"
                              : txn.type === "Credit"
                                ? "var(--success-bg)"
                                : "var(--danger-bg)",
                          color:
                            txn.category === "Interest"
                              ? "var(--warning-fg)"
                              : txn.type === "Credit"
                                ? "var(--success-fg)"
                                : "var(--danger-fg)",
                          padding: "3px 10px",
                          borderRadius: "12px",
                          fontSize: "11px",
                          fontWeight: "700",
                        }}
                      >
                        {txn.category}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        textAlign: "right",
                        color: "var(--danger)",
                        fontWeight: "600",
                        fontSize: "13px",
                      }}
                    >
                      {txn.type === "Debit"
                        ? `₹${txn.amount.toLocaleString("en-IN")}`
                        : "—"}
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        textAlign: "right",
                        color: "var(--success)",
                        fontWeight: "600",
                        fontSize: "13px",
                      }}
                    >
                      {txn.type === "Credit"
                        ? `₹${txn.amount.toLocaleString("en-IN")}`
                        : "—"}
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        textAlign: "right",
                        fontWeight: "700",
                        fontSize: "13px",
                      }}
                    >
                      ₹
                      {Math.abs(txn.balanceAfterTransaction).toLocaleString(
                        "en-IN",
                      )}
                      <span
                        style={{
                          fontSize: "11px",
                          color:
                            txn.balanceAfterTransaction > 0
                              ? "var(--danger)"
                              : "var(--success)",
                          marginLeft: "4px",
                        }}
                      >
                        {txn.balanceAfterTransaction > 0
                          ? "DR"
                          : txn.balanceAfterTransaction < 0
                            ? "CR"
                            : ""}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pagination.pages > 1 && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "1rem",
              padding: "1.5rem",
            }}
          >
            <button
              className="btn btn-secondary"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              ← Prev
            </button>
            <span style={{ padding: "0.5rem 1rem" }}>
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
    </div>
  );
}
