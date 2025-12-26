"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";

export default function GeneratedBillsPage() {
  const [selectedPeriod, setSelectedPeriod] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewingBill, setViewingBill] = useState(null);

  // Fetch generated bills
  const { data: billsData, isLoading } = useQuery({
    queryKey: ["generated-bills"],
    queryFn: () => apiClient.get("/api/billing/generated"),
  });

  const bills = billsData?.bills || [];

  // Get unique periods
  const periods = [...new Set(bills.map((b) => b.billPeriodId))]
    .sort()
    .reverse();

  // Filter bills
  const filteredBills = bills.filter((bill) => {
    const matchesPeriod =
      selectedPeriod === "all" || bill.billPeriodId === selectedPeriod;
    const matchesSearch =
      searchTerm === "" ||
      bill.memberId?.roomNo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      bill.memberId?.ownerName
        ?.toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      bill.memberId?.wing?.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesPeriod && matchesSearch;
  });

  const handlePrint = (bill) => {
    const printWindow = window.open("", "_blank");
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Bill - ${bill.memberId?.wing}-${bill.memberId?.roomNo}</title>
          <style>
            body { margin: 0; padding: 20px; font-family: Arial, sans-serif; }
            @media print {
              body { margin: 0; padding: 0; }
            }
          </style>
        </head>
        <body>
          ${bill.billHtml || "No bill data available"}
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleDownloadAll = () => {
    if (filteredBills.length === 0) {
      alert("No bills to download");
      return;
    }

    const printWindow = window.open("", "_blank");
    const allBillsHtml = filteredBills
      .map(
        (bill, idx) => `
      ${bill.billHtml || ""}
      ${
        idx < filteredBills.length - 1
          ? '<div style="page-break-after: always;"></div>'
          : ""
      }
    `
      )
      .join("");

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>All Bills - ${selectedPeriod}</title>
          <style>
            body { margin: 0; padding: 20px; font-family: Arial, sans-serif; }
            @media print {
              body { margin: 0; padding: 0; }
            }
          </style>
        </head>
        <body>
          ${allBillsHtml}
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div>
      {/* PAGE HEADER */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>📋 Generated Bills</h1>
          <p className={styles.pageSubtitle}>
            View and print all generated bills
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button onClick={handleDownloadAll} className="btn btn-primary">
            🖨️ Print All ({filteredBills.length})
          </button>
        </div>
      </div>

      {/* FILTERS */}
      <div className={styles.contentCard} style={{ marginBottom: "1.5rem" }}>
        <div
          style={{
            padding: "1rem",
            display: "flex",
            gap: "1rem",
            alignItems: "center",
          }}
        >
          <input
            type="text"
            placeholder="🔍 Search by room, name, or wing..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input"
            style={{ flex: 1 }}
          />
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className="input"
            style={{ width: "200px" }}
          >
            <option value="all">All Periods</option>
            {periods.map((period) => (
              <option key={period} value={period}>
                {period}
              </option>
            ))}
          </select>
          <span
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#DBEAFE",
              borderRadius: "8px",
              fontWeight: "600",
              color: "#1E40AF",
            }}
          >
            {filteredBills.length} BILLS
          </span>
        </div>
      </div>

      {/* BILLS TABLE */}
      <div className={styles.contentCard}>
        {isLoading ? (
          <div style={{ padding: "3rem", textAlign: "center" }}>
            <div
              className="loading-spinner"
              style={{ margin: "0 auto 1rem" }}
            ></div>
            <p>Loading bills...</p>
          </div>
        ) : filteredBills.length === 0 ? (
          <div
            style={{ padding: "3rem", textAlign: "center", color: "#9CA3AF" }}
          >
            <p>No bills found</p>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  backgroundColor: "#F9FAFB",
                  borderBottom: "2px solid #E5E7EB",
                }}
              >
                <th style={{ padding: "1rem", textAlign: "left" }}>
                  Bill Period
                </th>
                <th style={{ padding: "1rem", textAlign: "left" }}>Member</th>
                <th style={{ padding: "1rem", textAlign: "right" }}>Amount</th>
                <th style={{ padding: "1rem", textAlign: "center" }}>Status</th>
                <th style={{ padding: "1rem", textAlign: "center" }}>
                  Generated On
                </th>
                <th style={{ padding: "1rem", textAlign: "center" }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredBills.map((bill) => (
                <tr
                  key={bill._id}
                  style={{ borderBottom: "1px solid #F3F4F6" }}
                >
                  <td style={{ padding: "1rem" }}>
                    <strong>{bill.billPeriodId}</strong>
                  </td>
                  <td style={{ padding: "1rem" }}>
                    <div>
                      <strong>
                        {bill.memberId?.wing}-{bill.memberId?.roomNo}
                      </strong>
                      <br />
                      <span style={{ fontSize: "0.875rem", color: "#6B7280" }}>
                        {bill.memberId?.ownerName}
                      </span>
                    </div>
                  </td>
                  <td
                    style={{
                      padding: "1rem",
                      textAlign: "right",
                      fontWeight: "600",
                    }}
                  >
                    ₹{bill.amount?.toLocaleString("en-IN")}
                  </td>
                  <td style={{ padding: "1rem", textAlign: "center" }}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "0.25rem 0.75rem",
                        backgroundColor:
                          bill.balanceAfterTransaction < 0
                            ? "#FEE2E2"
                            : "#D1FAE5",
                        color:
                          bill.balanceAfterTransaction < 0
                            ? "#991B1B"
                            : "#065F46",
                        borderRadius: "12px",
                        fontSize: "0.75rem",
                        fontWeight: "600",
                      }}
                    >
                      {bill.balanceAfterTransaction < 0 ? "Pending" : "Paid"}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "1rem",
                      textAlign: "center",
                      fontSize: "0.875rem",
                      color: "#6B7280",
                    }}
                  >
                    {new Date(bill.date).toLocaleDateString("en-IN")}
                  </td>
                  <td style={{ padding: "1rem", textAlign: "center" }}>
                    <div
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        justifyContent: "center",
                      }}
                    >
                      <button
                        onClick={() => setViewingBill(bill)}
                        className="btn btn-secondary"
                        style={{ fontSize: "0.875rem", padding: "0.5rem 1rem" }}
                      >
                        👁️ View
                      </button>
                      <button
                        onClick={() => handlePrint(bill)}
                        className="btn btn-primary"
                        style={{ fontSize: "0.875rem", padding: "0.5rem 1rem" }}
                      >
                        🖨️ Print
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* VIEW BILL OVERLAY */}
      {viewingBill && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.8)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
          }}
          onClick={() => setViewingBill(null)}
        >
          <div
            style={{
              backgroundColor: "white",
              borderRadius: "12px",
              maxWidth: "900px",
              width: "100%",
              maxHeight: "90vh",
              overflow: "auto",
              position: "relative",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "1.5rem",
                borderBottom: "2px solid #E5E7EB",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                position: "sticky",
                top: 0,
                backgroundColor: "white",
                zIndex: 1,
              }}
            >
              <h2 style={{ margin: 0 }}>
                Bill: {viewingBill.memberId?.wing}-
                {viewingBill.memberId?.roomNo}
              </h2>
              <button
                onClick={() => setViewingBill(null)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "2rem",
                  cursor: "pointer",
                  color: "#9CA3AF",
                }}
              >
                ✕
              </button>
            </div>
            <div
              style={{ padding: "2rem" }}
              dangerouslySetInnerHTML={{
                __html: viewingBill.billHtml || "No bill data",
              }}
            />
            <div
              style={{
                padding: "1.5rem",
                borderTop: "2px solid #E5E7EB",
                position: "sticky",
                bottom: 0,
                backgroundColor: "white",
                textAlign: "center",
              }}
            >
              <button
                onClick={() => handlePrint(viewingBill)}
                className="btn btn-primary"
                style={{ minWidth: "200px" }}
              >
                🖨️ Print This Bill
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
