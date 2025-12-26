"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";
import gridStyles from "@/styles/BillingGrid.module.css";

export default function GenerateBillsPage() {
  const queryClient = useQueryClient();
  const currentDate = new Date();

  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth());
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [generationResult, setGenerationResult] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const { data: membersData } = useQuery({
    queryKey: ["members-list"],
    queryFn: () => apiClient.get("/api/members/list?limit=1000"),
  });

  // ADD THESE TWO QUERIES
  const { data: billingConfig } = useQuery({
    queryKey: ["billing-config"],
    queryFn: () => apiClient.get("/api/billing-config"),
  });

  const { data: societyData } = useQuery({
    queryKey: ["society-config"],
    queryFn: () => apiClient.get("/api/society/config"),
  });

  const generateMutation = useMutation({
    mutationFn: (data) => apiClient.post("/api/billing/generate", data),
    onSuccess: (data) => {
      setGenerationResult(data.result);
      setShowConfirm(false);
      queryClient.invalidateQueries(["bills-list"]);
    },
  });

  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const years = Array.from(
    { length: 10 },
    (_, i) => currentDate.getFullYear() - 2 + i
  );

  const members = membersData?.members || [];
  const billingHeads = billingConfig?.billingHeads || [];

  const handleGenerate = () => {
    if (members.length === 0) {
      alert("No members found. Please import members first.");
      return;
    }
    setShowConfirm(true);
  };

  const confirmGeneration = () => {
    generateMutation.mutate({
      month: selectedMonth,
      year: selectedYear,
      customCharges: {},
    });
  };

  const downloadPDFBill = async (member, billingHeads, billPeriodId) => {
    try {
      // Calculate amounts
      const items = billingHeads.map((head) => {
        let amount = 0;
        if (head.calculationType === "Fixed") {
          amount = head.defaultAmount;
        } else if (head.calculationType === "Per Sq Ft") {
          amount = head.defaultAmount * (member.areaSqFt || 0);
        }
        return {
          description: head.headName,
          amount: Math.round(amount),
        };
      });

      const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
      const tax = subtotal * 0.02; // 2% tax
      const currentBillTotal = subtotal + tax;

      // You can fetch previous balance from member or calculate
      const previousBalance = member.previousBalance || 0;
      const interestCharged = previousBalance > 0 ? previousBalance * 0.21 : 0;
      const totalPayable = currentBillTotal + previousBalance + interestCharged;

      const response = await fetch("/api/billing/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: member.id,
          billPeriod: billPeriodId,
          billDate: new Date().toLocaleDateString("en-IN"),
          dueDate: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000
          ).toLocaleDateString("en-IN"),
          items,
          subtotal,
          tax,
          currentBillTotal,
          interestCharged,
          previousBalance,
          totalPayable,
        }),
      });

      if (!response.ok) throw new Error("PDF generation failed");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      // Open in new tab (editable)
      window.open(url, "_blank");

      // Also offer download
      const a = document.createElement("a");
      a.href = url;
      a.download = `Bill-${member.wing}-${member.roomNo}-${billPeriodId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("PDF download error:", error);
      alert("Failed to download PDF");
    }
  };

  return (
    <div>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Generate Bills</h1>
        <p className={styles.pageSubtitle}>
          Create monthly bills for all members with automatic calculations
        </p>
      </div>

      {generationResult && (
        <div className={styles.contentCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>
              {generationResult.success
                ? "✓ Generation Successful"
                : "⚠️ Generation Completed with Errors"}
            </h2>
          </div>

          <div
            className={gridStyles.gridSummary}
            style={{ flexDirection: "column", gap: "var(--spacing-md)" }}
          >
            <div className={gridStyles.gridSummaryItem}>
              <span className={gridStyles.gridSummaryLabel}>Bill Period:</span>
              <span className={gridStyles.gridSummaryValue}>
                {generationResult.billPeriodId}
              </span>
            </div>
            <div className={gridStyles.gridSummaryItem}>
              <span className={gridStyles.gridSummaryLabel}>
                Total Members:
              </span>
              <span className={gridStyles.gridSummaryValue}>
                {generationResult.totalMembers}
              </span>
            </div>
            <div className={gridStyles.gridSummaryItem}>
              <span className={gridStyles.gridSummaryLabel}>
                Successfully Generated:
              </span>
              <span
                className={gridStyles.gridSummaryValue}
                style={{ color: "var(--success)" }}
              >
                {generationResult.successCount}
              </span>
            </div>
            {generationResult.failedCount > 0 && (
              <div className={gridStyles.gridSummaryItem}>
                <span className={gridStyles.gridSummaryLabel}>Failed:</span>
                <span
                  className={gridStyles.gridSummaryValue}
                  style={{ color: "var(--danger)" }}
                >
                  {generationResult.failedCount}
                </span>
              </div>
            )}
          </div>

          {generationResult.failedMembers &&
            generationResult.failedMembers.length > 0 && (
              <div
                className={gridStyles.errorList}
                style={{ marginTop: "var(--spacing-lg)" }}
              >
                <div className={gridStyles.errorListTitle}>Failed Members:</div>
                <ul className={gridStyles.errorListItems}>
                  {generationResult.failedMembers.map((failed, index) => (
                    <li key={index} className={gridStyles.errorListItem}>
                      {failed.wing}-{failed.roomNo} ({failed.ownerName}):{" "}
                      {failed.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          {generationResult.createdBills &&
            generationResult.createdBills.length > 0 && (
              <div style={{ marginTop: "var(--spacing-lg)" }}>
                <h3 style={{ marginBottom: "var(--spacing-md)" }}>
                  📄 Download Bills
                </h3>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  {generationResult.createdBills.slice(0, 10).map((bill) => (
                    <div
                      key={bill.memberId}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "12px",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-md)",
                        backgroundColor: "var(--bg-secondary)",
                      }}
                    >
                      <span style={{ flex: 1 }}>
                        {bill.wing}-{bill.roomNo} - {bill.memberName}
                      </span>
                      <span style={{ fontWeight: "bold", marginRight: "15px" }}>
                        ₹{bill.amount}
                      </span>
                      <button
                        className="btn btn-secondary"
                        style={{ minWidth: "140px" }}
                        onClick={() =>
                          downloadPDFBill(
                            {
                              ownerName: bill.memberName,
                              roomNo: bill.roomNo,
                              wing: bill.wing,
                              contact: bill.contact,
                            },
                            billingHeads,
                            generationResult.billPeriodId
                          )
                        }
                      >
                        📄 Download PDF
                      </button>
                    </div>
                  ))}
                  {generationResult.createdBills.length > 10 && (
                    <p
                      style={{
                        fontSize: "var(--font-sm)",
                        color: "var(--text-secondary)",
                        textAlign: "center",
                        marginTop: "10px",
                      }}
                    >
                      Showing first 10 bills. Total:{" "}
                      {generationResult.createdBills.length}
                    </p>
                  )}
                </div>
              </div>
            )}
          <div style={{ marginTop: "var(--spacing-lg)" }}>
            <button
              className="btn btn-primary"
              onClick={() => (window.location.href = "/dashboard/ledger")}
            >
              View Ledger →
            </button>
          </div>
        </div>
      )}

      <div className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Billing Period</h2>
        </div>

        <div className={gridStyles.formRow}>
          <div className={gridStyles.formGroup}>
            <label className="label">Month</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
              className="input"
            >
              {months.map((month, index) => (
                <option key={index} value={index}>
                  {month}
                </option>
              ))}
            </select>
          </div>

          <div className={gridStyles.formGroup}>
            <label className="label">Year</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="input"
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          style={{
            marginTop: "var(--spacing-lg)",
            padding: "var(--spacing-md)",
            backgroundColor: "#dbeafe",
            borderRadius: "var(--radius-md)",
            fontSize: "var(--font-sm)",
          }}
        >
          <strong>Selected Period:</strong> {months[selectedMonth]}{" "}
          {selectedYear}
        </div>
      </div>

      <div className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Preview Summary</h2>
        </div>

        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Total Members</div>
            <h2 className={styles.statValue}>{members.length}</h2>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statLabel}>Bills to Generate</div>
            <h2 className={styles.statValue}>{members.length}</h2>
          </div>
        </div>

        <div style={{ marginTop: "var(--spacing-lg)" }}>
          <button
            onClick={handleGenerate}
            className="btn btn-success"
            disabled={generateMutation.isPending || members.length === 0}
            style={{ width: "100%", justifyContent: "center", padding: "16px" }}
          >
            {generateMutation.isPending ? (
              <>
                <span className="loading-spinner"></span>
                Generating Bills...
              </>
            ) : (
              <>
                🚀 Generate Bills for {months[selectedMonth]} {selectedYear}
              </>
            )}
          </button>
        </div>
      </div>

      {showConfirm && (
        <div className={styles.modal} onClick={() => setShowConfirm(false)}>
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Confirm Bill Generation</h3>
              <button
                className={styles.modalClose}
                onClick={() => setShowConfirm(false)}
              >
                ✕
              </button>
            </div>
            <div className={styles.modalBody}>
              <p style={{ marginBottom: "var(--spacing-md)" }}>
                You are about to generate bills for:
              </p>
              <div
                style={{
                  padding: "var(--spacing-md)",
                  backgroundColor: "var(--bg-secondary)",
                  borderRadius: "var(--radius-md)",
                  marginBottom: "var(--spacing-md)",
                }}
              >
                <strong>
                  {months[selectedMonth]} {selectedYear}
                </strong>
                <br />
                Total Members: <strong>{members.length}</strong>
              </div>
              <p
                style={{
                  fontSize: "var(--font-sm)",
                  color: "var(--text-secondary)",
                }}
              >
                ⚠️ This action will create bills with automatic calculations
                including maintenance, arrears, interest, and service tax for
                all members.
              </p>
            </div>
            <div className={styles.modalFooter}>
              <button
                onClick={() => setShowConfirm(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button onClick={confirmGeneration} className="btn btn-success">
                ✓ Confirm & Generate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
