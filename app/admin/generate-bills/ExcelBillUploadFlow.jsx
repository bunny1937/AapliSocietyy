"use client";
// app/admin/generate-bills/ExcelBillUploadFlow.jsx
//
// The legacy Excel download/edit/upload round trip — RESIDENTIAL ONLY.
// Commercial has no bill-template/Excel system; its wizard skips straight
// from period-detect to a server-computed preview. Lifted verbatim out of
// page.js — same state, same behavior, just relocated so it can be
// conditionally rendered by segment.
import CollectionsPanel from "./CollectionsPanel";
import ExcelPreviewGrid from "../../components/ExcelPreviewGrid";
import DropZone from "components/DropZone";
import { postNdjson } from "@/lib/ndjson-client";

export default function ExcelBillUploadFlow({
  periodLabel,
  billingHeadsData,
  hasValidPeriodLabel,
  isPreviewing,
  previewProgress,
  generatePreview,
  excelFile,
  setExcelFile,
  excelValidating,
  billGrid,
  setBillGrid,
  excelValidation,
  setExcelValidation,
  diffIssues,
  approvedDiffs,
  setApprovedDiffs,
  allDiffsApproved,
  billMonth,
  billYear,
  queryClient,
  excelImporting,
  setExcelImporting,
  canGenerate,
  setBillsGeneratedForPeriod,
  payGrid,
  setPayGrid,
  payPreview,
  setPayPreview,
  payBatchKey,
  setPayBatchKey,
  payConfirming,
  setPayConfirming,
  payConfirmProgress,
  setPayConfirmProgress,
  payResults,
  setPayResults,
  nextGenScope,
  setNextGenScope,
  nextPushMode,
  setNextPushMode,
  nextPushDate,
  setNextPushDate,
  autoGenState,
  setAutoGenState,
  autoGenerateNextMonth,
  runValidation,
}) {
  return (
    <>
      {/* UNIFIED TEMPLATE SECTION */}
      <div
        style={{
          background: "#fff",
          border: "2px solid #c7d2fe",
          borderRadius: "12px",
          marginBottom: "1.5rem",
          // Was `overflow: "hidden"`, which clipped the 1380px collections
          // table instead of letting its own scroller move. Only the vertical
          // axis is clipped now; the inner .tableScroll owns the horizontal one.
          overflowX: "visible",
          overflowY: "hidden",
        }}
      >
        <div
          style={{
            background: "#eef2ff",
            padding: "1rem 1.5rem",
            borderBottom: "1px solid #c7d2fe",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "#3730a3" }}>
            Unified Template - Bill Generation & Payment Collection
          </h2>
          <p
            style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "#6366f1" }}
          >
            Download then review charge columns then optionally fill
            AmountPaid/Method/Date then upload and system detects what to do
          </p>
        </div>
        <div style={{ padding: "1.5rem" }}>
          {/* Download */}
          <div
            style={{
              background: "#f5f3ff",
              border: "1px solid #ddd6fe",
              borderRadius: "10px",
              padding: "1.25rem",
              marginBottom: "1.5rem",
            }}
          >
            <h3
              style={{
                margin: "0 0 0.5rem",
                fontSize: "0.95rem",
                color: "#4338ca",
              }}
            >
              Step 1 - Download Unified Template
            </h3>
            <p
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.8rem",
                color: "#6b7280",
                lineHeight: 1.5,
              }}
            >
              Pre-filled with opening balances, charge heads, interest, bill
              totals. Leave{" "}
              <strong>AmountPaid / PaymentMethod / PaymentDate</strong> blank
              for bill-only generation, or fill them to also record payments in
              the same upload.
            </p>
            <div
              style={{
                fontSize: "0.78rem",
                color: "#3730a3",
                background: "#ede9fe",
                borderRadius: "6px",
                padding: "0.5rem 0.75rem",
                marginBottom: "1rem",
              }}
            >
              <strong>Columns:</strong> Wing-FlatNo - OwnerName - Period -
              CurrentCharges -{" "}
              {billingHeadsData?.heads
                ?.filter((h) => h.isActive && !h.isDeleted)
                .map((h) => h.headName)
                .join(" - ")}{" "}
              - OpeningPrincipal - OpeningInterest - CurrentInterest -
              BillPrincipal - BillInterest - TotalBillDue - AlreadyPaid -
              AdvanceCredit - RemainingDue -{" "}
              <strong>AmountPaid - PaymentMethod - PaymentDate</strong> -
              Remarks
            </div>
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                flexWrap: "wrap",
                // See the same note in BillGenerationFlow: a flex item defaults
                // to min-width:auto, which here resolves to the table's 1380px
                // min-content and suppresses the scrollbar entirely.
                minWidth: 0,
              }}
            >
              {hasValidPeriodLabel ? (
                <CollectionsPanel periodId={periodLabel} />
              ) : (
                <div
                  style={{
                    fontSize: "0.82rem",
                    color: "#6b7280",
                    padding: "0.6rem 0.9rem",
                    border: "1px dashed #d1d5db",
                    borderRadius: "8px",
                    background: "#f9fafb",
                  }}
                >
                  Preparing billing period…
                </div>
              )}
              <button
                className="btn btn-secondary"
                disabled={isPreviewing}
                onClick={generatePreview}
                style={{ fontSize: "0.875rem" }}
              >
                {isPreviewing ? (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    <span className="loading-spinner" />
                    {previewProgress.label === "fetching"
                      ? "Fetching balances..."
                      : `Calculating ${previewProgress.current}/${previewProgress.total}`}
                  </span>
                ) : (
                  "Preview Bills"
                )}
              </button>
            </div>
          </div>
          {/* Upload */}
          <div
            style={{
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: "10px",
              padding: "1.25rem",
            }}
          >
            <h3
              style={{
                margin: "0 0 0.5rem",
                fontSize: "0.95rem",
                color: "#374151",
              }}
            >
              Step 2 - Upload Filled Template
            </h3>
            <p
              style={{
                margin: "0 0 1rem",
                fontSize: "0.8rem",
                color: "#6b7280",
                lineHeight: 1.5,
              }}
            >
              Upload the template after filling it. System auto-detects:
              <br />- <strong>AmountPaid blank</strong> then validate charges
              and generate bills
              <br />- <strong>AmountPaid filled</strong> then validate both and
              generate bills plus record payments (or choose)
            </p>
            {/* File upload */}
            <DropZone
              accept=".xlsx,.xls"
              file={excelFile}
              onFile={(f) => {
                setExcelFile(f);
                setPayGrid(null);
                setPayPreview(null);
                setPayBatchKey(null);
                runValidation(f);
              }}
              onClear={() => {
                setExcelFile(null);
                setExcelValidation(null);
                setBillGrid(null);
                setPayGrid(null);
                setApprovedDiffs(new Set());
                setPayPreview(null);
                setPayBatchKey(null);
              }}
              label="Click or drag & drop Unified Template here"
              hint=".xlsx or .xls — max 5MB"
              style={{ marginBottom: "1rem" }}
            />
            {/* Auto-validating spinner */}
            {excelValidating && (
              <div
                style={{
                  textAlign: "center",
                  padding: "1rem",
                  color: "#6b7280",
                }}
              >
                Validating...
              </div>
            )}
            {/* Bill grid preview */}
            {billGrid && (
              <ExcelPreviewGrid
                title={`Template Preview - ${periodLabel}`}
                columns={billGrid.columns}
                rows={billGrid.gridRows}
                onReupload={() => {
                  setExcelFile(null);
                  setExcelValidation(null);
                  setBillGrid(null);
                  setApprovedDiffs(new Set());
                }}
                onContinue={(validRows) => {}}
                onCancel={() => {
                  setExcelFile(null);
                  setExcelValidation(null);
                  setBillGrid(null);
                  setApprovedDiffs(new Set());
                }}
              />
            )}
            {/* Validation results */}
            {excelValidation && (
              <div style={{ marginTop: "1.5rem" }}>
                {/* Summary badges */}
                <div
                  style={{
                    display: "flex",
                    gap: "0.75rem",
                    marginBottom: "1rem",
                  }}
                >
                  {[
                    ["Errors", "#dc2626", excelValidation.errorCount],
                    ["Warnings", "#d97706", excelValidation.warningCount],
                    ["Duplicates", "#7c3aed", excelValidation.duplicateCount],
                  ].map(([l, c, v]) => (
                    <div
                      key={l}
                      style={{
                        textAlign: "center",
                        padding: "0.75rem",
                        borderRadius: "8px",
                        background: "white",
                        border: `2px solid ${c}`,
                      }}
                    >
                      <div
                        style={{
                          fontSize: "1.5rem",
                          fontWeight: 700,
                          color: c,
                        }}
                      >
                        {v}
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                        {l}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Issues list */}
                {excelValidation.issues?.filter((i) => i.type !== "diff")
                  .length > 0 && (
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "0.8rem",
                      marginBottom: "1rem",
                    }}
                  >
                    <thead>
                      <tr style={{ background: "#fca5a5" }}>
                        {["Row", "Type", "What went wrong", "How to fix"].map(
                          (h) => (
                            <th
                              key={h}
                              style={{
                                padding: "6px 10px",
                                textAlign: "left",
                                border: "1px solid #fca5a5",
                              }}
                            >
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {excelValidation.issues
                        .filter((i) => i.type !== "diff")
                        .map((issue, i) => (
                          <tr
                            key={i}
                            style={{
                              background: i % 2 === 0 ? "#fff" : "#fef9f9",
                            }}
                          >
                            <td
                              style={{
                                padding: "6px 10px",
                                border: "1px solid #fca5a5",
                                fontWeight: 600,
                              }}
                            >
                              {issue.row ?? "-"}
                            </td>
                            <td
                              style={{
                                padding: "6px 10px",
                                border: "1px solid #fca5a5",
                              }}
                            >
                              <span
                                style={{
                                  background:
                                    issue.type === "error"
                                      ? "#dc2626"
                                      : issue.type === "warning"
                                        ? "#d97706"
                                        : "#7c3aed",
                                  color: "white",
                                  padding: "2px 8px",
                                  borderRadius: "4px",
                                  fontSize: "0.75rem",
                                }}
                              >
                                {issue.type}
                              </span>
                            </td>
                            <td
                              style={{
                                padding: "6px 10px",
                                border: "1px solid #fca5a5",
                              }}
                            >
                              {issue.message}
                            </td>
                            <td
                              style={{
                                padding: "6px 10px",
                                border: "1px solid #fca5a5",
                                color: "#059669",
                              }}
                            >
                              {issue.fix}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
                {/* Diff approvals */}
                {diffIssues.length > 0 && (
                  <div
                    style={{
                      background: "#fff7ed",
                      border: "2px solid #f97316",
                      borderRadius: "10px",
                      padding: "1.25rem",
                      marginBottom: "1.5rem",
                    }}
                  >
                    <h4
                      style={{
                        margin: "0 0 0.75rem",
                        color: "#9a3412",
                        fontSize: "0.95rem",
                        fontWeight: 700,
                      }}
                    >
                      {diffIssues.length} Amount Mismatch
                      {diffIssues.length > 1 ? "es" : ""} — Fix in Excel &amp;
                      Re-upload
                    </h4>
                    {diffIssues.map((issue, i) => (
                      <div
                        key={i}
                        style={{
                          background: approvedDiffs.has(issue.memberId)
                            ? "#f0fdf4"
                            : "#fff",
                          border: `2px solid ${approvedDiffs.has(issue.memberId) ? "#86efac" : "#f97316"}`,
                          borderRadius: "8px",
                          padding: "1rem",
                          marginBottom: "0.75rem",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: "1rem",
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div
                              style={{
                                fontWeight: 700,
                                color: "#7c2d12",
                                fontSize: "0.95rem",
                                marginBottom: "0.5rem",
                              }}
                            >
                              {issue.flat} - {issue.name}
                            </div>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr 1fr",
                                gap: "0.5rem",
                                marginBottom: "0.75rem",
                              }}
                            >
                              {[
                                [
                                  "Excel Total",
                                  `Rs ${issue.excelTotal}`,
                                  "#dc2626",
                                ],
                                [
                                  "System Calc",
                                  `Rs ${issue.autoTotal}`,
                                  "#059669",
                                ],
                                [
                                  "Difference",
                                  `Rs ${issue.diff > 0 ? "+" : ""}${issue.diff}`,
                                  issue.diff < 0 ? "#dc2626" : "#d97706",
                                ],
                              ].map(([l, v, c]) => (
                                <div
                                  key={l}
                                  style={{
                                    background: "#f9fafb",
                                    borderRadius: "6px",
                                    padding: "0.5rem",
                                    textAlign: "center",
                                    border: "1px solid #e5e7eb",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: "0.7rem",
                                      color: "#6b7280",
                                      marginBottom: "2px",
                                    }}
                                  >
                                    {l}
                                  </div>
                                  <div
                                    style={{
                                      fontWeight: 700,
                                      color: c,
                                      fontSize: "1rem",
                                    }}
                                  >
                                    {v}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div
                              style={{
                                fontSize: "0.8rem",
                                color: "#92400e",
                                background: "#fef3c7",
                                borderRadius: "6px",
                                padding: "0.5rem 0.75rem",
                              }}
                            >
                              {issue.why} - {issue.fix}
                            </div>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              textAlign: "center",
                              minWidth: 90,
                              fontSize: "0.7rem",
                              fontWeight: 800,
                              color: "#dc2626",
                              lineHeight: 1.3,
                            }}
                          >
                            FIX &amp;
                            <br />
                            RE-UPLOAD
                          </div>
                        </div>
                      </div>
                    ))}
                    {!allDiffsApproved && (
                      <div
                        style={{
                          background: "#fef2f2",
                          border: "1px solid #fca5a5",
                          borderRadius: "8px",
                          padding: "0.75rem",
                          marginTop: "0.5rem",
                          fontSize: "0.8rem",
                          color: "#991b1b",
                          fontWeight: 600,
                          textAlign: "center",
                        }}
                      >
                        Generation blocked. {diffIssues.length} flat
                        {diffIssues.length > 1 ? "s have" : " has"} an Excel
                        amount that doesn&apos;t match the system calculation.
                        Correct those charge amounts in your Excel (or clear the
                        amount to accept the system value), then re-upload the
                        file. Nothing is generated until every row matches.
                      </div>
                    )}
                  </div>
                )}
                {/* Matched rows */}
                {excelValidation.comparison?.filter((r) => !r.hasDiff).length >
                  0 && (
                  <div style={{ marginBottom: "1.5rem" }}>
                    <h4
                      style={{
                        margin: "0 0 0.75rem",
                        color: "#374151",
                        fontSize: "0.95rem",
                        fontWeight: 700,
                      }}
                    >
                      Matched Rows (
                      {
                        excelValidation.comparison.filter((r) => !r.hasDiff)
                          .length
                      }
                      )
                    </h4>
                    <div
                      style={{
                        overflowX: "auto",
                        maxHeight: 260,
                        overflowY: "auto",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                      }}
                    >
                      <table
                        style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          fontSize: "0.8rem",
                        }}
                      >
                        <thead
                          style={{
                            position: "sticky",
                            top: 0,
                            background: "#d1fae5",
                            zIndex: 1,
                          }}
                        >
                          <tr>
                            {[
                              "Flat",
                              "Member",
                              "Excel Total",
                              "Auto Total",
                              "Status",
                            ].map((h) => (
                              <th
                                key={h}
                                style={{
                                  padding: "8px 10px",
                                  border: "1px solid #a7f3d0",
                                  fontWeight: 700,
                                  color: "#065f46",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {excelValidation.comparison
                            .filter((r) => !r.hasDiff)
                            .map((row, i) => (
                              <tr
                                key={i}
                                style={{
                                  background: i % 2 === 0 ? "#fff" : "#f0fdf4",
                                }}
                              >
                                <td
                                  style={{
                                    padding: "6px 10px",
                                    border: "1px solid #d1fae5",
                                    fontWeight: 600,
                                  }}
                                >
                                  {row.flat}
                                </td>
                                <td
                                  style={{
                                    padding: "6px 10px",
                                    border: "1px solid #d1fae5",
                                  }}
                                >
                                  {row.name}
                                </td>
                                <td
                                  style={{
                                    padding: "6px 10px",
                                    border: "1px solid #d1fae5",
                                    textAlign: "right",
                                  }}
                                >
                                  Rs {row.excelTotal}
                                </td>
                                <td
                                  style={{
                                    padding: "6px 10px",
                                    border: "1px solid #d1fae5",
                                    textAlign: "right",
                                  }}
                                >
                                  Rs {row.autoTotal}
                                </td>
                                <td
                                  style={{
                                    padding: "6px 10px",
                                    border: "1px solid #d1fae5",
                                    textAlign: "center",
                                  }}
                                >
                                  <span
                                    style={{
                                      background: "#059669",
                                      color: "white",
                                      padding: "2px 8px",
                                      borderRadius: "4px",
                                      fontSize: "0.75rem",
                                    }}
                                  >
                                    Match
                                  </span>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {/* Action buttons — Generate and Record-Payments are two
                    independent actions. A single upload can mix flats that
                    need a new bill with flats that are already billed and
                    just need a payment recorded; each row is routed by the
                    validator (excelValidation.bills = generate rows only,
                    excelValidation.alreadyBilledRows = payment-only rows). */}
                {(() => {
                  const hasPayments = excelValidation.hasPaymentData;
                  const hasErrors = (excelValidation.errorCount || 0) > 0;
                  const alreadyBilledRows = excelValidation.alreadyBilledRows || [];
                  const hasGenerateRows = (excelValidation.bills || []).length > 0;
                  const doGenerateBills = async () => {
                    setExcelImporting(true);
                    try {
                      const res = await fetch(
                        "/api/billing/generate-from-excel",
                        {
                          method: "POST",
                          credentials: "include",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            bills: excelValidation.bills,
                            billMonth,
                            billYear,
                          }),
                        },
                      );
                      const data = await res.json();
                      if (!data.success)
                        throw new Error(data.error || "Generation failed");
                      queryClient.invalidateQueries(["bills-list"]);
                      return data.count;
                    } finally {
                      setExcelImporting(false);
                    }
                  };
                  const doPaymentPreview = async () => {
                    const fd = new FormData();
                    fd.append("file", excelFile);
                    const payRes = await fetch(
                      "/api/billing/upload-payments?action=preview",
                      { method: "POST", credentials: "include", body: fd },
                    );
                    const payData = await payRes.json();
                    if (!payData.success)
                      throw new Error(
                        payData.error || "Payment preview failed",
                      );
                    setPayPreview(payData);
                    setPayBatchKey(payData.batchKey);
                    if (payData.gridRows && payData.gridColumns)
                      setPayGrid({
                        gridRows: payData.gridRows,
                        columns: payData.gridColumns,
                      });
                  };
                  return (
                    <div
                      style={{
                        display: "flex",
                        gap: "0.75rem",
                        alignItems: "center",
                        borderTop: "2px solid #e5e7eb",
                        paddingTop: "1.25rem",
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          setExcelFile(null);
                          setExcelValidation(null);
                          setBillGrid(null);
                          setApprovedDiffs(new Set());
                        }}
                      >
                        Re-upload
                      </button>
                      {hasGenerateRows && (
                        <button
                          className={`btn ${canGenerate ? "btn-success" : "btn-secondary"}`}
                          style={{
                            opacity: canGenerate ? 1 : 0.5,
                            cursor: canGenerate ? "pointer" : "not-allowed",
                          }}
                          disabled={!canGenerate || excelImporting}
                          onClick={async () => {
                            setExcelImporting(true);
                            try {
                              const count = await doGenerateBills();
                              alert(`${count} bills generated.`);
                              setBillsGeneratedForPeriod(periodLabel);
                              setExcelFile(null);
                              setExcelValidation(null);
                            } catch (e) {
                              alert("Failed: " + e.message);
                            } finally {
                              setExcelImporting(false);
                            }
                          }}
                        >
                          {excelImporting
                            ? "Generating..."
                            : !canGenerate
                              ? `Fix ${diffIssues.length} conflict(s) & re-upload`
                              : `Generate ${excelValidation.bills.length} Bill(s)`}
                        </button>
                      )}
                      {/* Record-Payments is independent of generation — usable
                          whenever any row (already-billed or just-generated)
                          has AmountPaid filled, for one member or all of them
                          in a single confirm. Not gated on whether OTHER rows
                          in the same file still need bills generated. */}
                      {hasPayments && (
                        <button
                          className="btn btn-primary"
                          disabled={excelImporting || hasErrors}
                          style={{ opacity: hasErrors ? 0.5 : 1 }}
                          onClick={async () => {
                            setExcelImporting(true);
                            try {
                              await doPaymentPreview();
                            } catch (e) {
                              alert("Failed: " + e.message);
                            } finally {
                              setExcelImporting(false);
                            }
                          }}
                        >
                          {excelImporting
                            ? "Loading..."
                            : `💳 Preview & Record Payments`}
                        </button>
                      )}
                      {!hasGenerateRows && !hasPayments && alreadyBilledRows.length > 0 && (
                        <div
                          style={{
                            fontSize: "0.85rem",
                            color: "#6b7280",
                            padding: "0.5rem",
                          }}
                        >
                          {alreadyBilledRows.length} flat(s) already billed for
                          their period ({alreadyBilledRows.map((r) => r.flat).join(", ")}).
                          Fill AmountPaid/PaymentMethod/PaymentDate then re-upload
                          to record payments.
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
            {/* Payment preview grid */}
            {payGrid && (
              <div style={{ marginTop: "1.5rem" }}>
                <ExcelPreviewGrid
                  title={`Payment Preview - ${periodLabel}`}
                  columns={payGrid.columns}
                  rows={payGrid.gridRows}
                  onReupload={() => {
                    setExcelFile(null);
                    setPayPreview(null);
                    setPayBatchKey(null);
                    setPayGrid(null);
                  }}
                  onContinue={() => {}}
                  onCancel={() => {
                    setExcelFile(null);
                    setPayPreview(null);
                    setPayBatchKey(null);
                    setPayGrid(null);
                  }}
                />
              </div>
            )}
            {/* Payment confirmation */}
            {payPreview && payBatchKey && (
              <div
                style={{
                  marginTop: "1.5rem",
                  background: "#f0fdf4",
                  border: "1px solid #86efac",
                  borderRadius: "10px",
                  padding: "1.25rem",
                }}
              >
                <h4 style={{ margin: "0 0 0.75rem", color: "#166534" }}>
                  Payment Batch Ready
                </h4>
                <div
                  style={{
                    fontSize: "0.875rem",
                    color: "#166534",
                    marginBottom: "1rem",
                  }}
                >
                  {payPreview.validRows} valid payments - Rs{" "}
                  {payPreview.totalAmount?.toFixed(2)} total
                  {payPreview.warningRows > 0 &&
                    ` - ${payPreview.warningRows} warnings`}
                </div>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button
                    className="btn btn-success"
                    disabled={payConfirming}
                    onClick={async () => {
                      if (
                        !confirm(
                          `Process ${payPreview.validRows} payment(s) totalling Rs ${payPreview.totalAmount?.toFixed(2)}? This cannot be undone.`,
                        )
                      )
                        return;
                      setPayConfirming(true);
                      setPayConfirmProgress({ current: 0, total: payPreview.validRows || 0 });
                      try {
                        const data = await postNdjson(
                          "/api/billing/upload-payments?action=confirm",
                          { batchKey: payBatchKey },
                          (p) => setPayConfirmProgress({ current: p.done, total: p.total }),
                        );
                        if (!data.success)
                          throw new Error(data.error || "Confirm failed");
                        setPayResults(data);
                        setPayPreview(null);
                        setPayBatchKey(null);
                        setExcelFile(null);
                        setExcelValidation(null);
                      } catch (e) {
                        alert("Payment processing failed: " + e.message);
                      } finally {
                        setPayConfirming(false);
                      }
                    }}
                  >
                    {payConfirming
                      ? payConfirmProgress.total
                        ? `Processing... ${payConfirmProgress.current}/${payConfirmProgress.total}`
                        : "Processing..."
                      : "Confirm & Record Payments"}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setPayPreview(null);
                      setPayBatchKey(null);
                      setPayGrid(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
                {payConfirming && payConfirmProgress.total > 0 && (
                  <div style={{ width: 220, height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden", marginTop: "0.75rem" }}>
                    <div
                      style={{
                        height: "100%",
                        background: "#16a34a",
                        width: `${(payConfirmProgress.current / payConfirmProgress.total) * 100}%`,
                        transition: "width 0.2s",
                      }}
                    />
                  </div>
                )}
              </div>
            )}
            {/* Payment results */}
            {payResults && (
              <div style={{ marginTop: "1.5rem" }}>
                <div
                  style={{
                    background: "#f0fdf4",
                    border: "1px solid #86efac",
                    borderRadius: 8,
                    padding: "1rem",
                    marginBottom: "1rem",
                  }}
                >
                  <strong style={{ color: "#166534" }}>
                    Payments Processed
                  </strong>
                  <div
                    style={{
                      marginTop: "0.5rem",
                      fontSize: "0.875rem",
                      color: "#166534",
                    }}
                  >
                    {payResults.successRows} succeeded · {payResults.failedRows} failed · Total ₹{(payResults.totalAmountProcessed || 0).toFixed(2)} · Interest cleared ₹{(payResults.totalInterestCleared || 0).toFixed(2)} · Principal cleared ₹{(payResults.totalPrincipalCleared || 0).toFixed(2)}
                  </div>
                  {payResults.results?.filter(r => r.status === "Failed").map((r, i) => (
                    <div key={i} style={{ marginTop: "0.5rem", padding: "0.5rem 0.75rem", background: "#fee2e2", borderRadius: 6, fontSize: "0.8rem", color: "#991b1b" }}>
                      ❌ {r.flat} ({r.memberName}): {r.errorMessage}
                    </div>
                  ))}
                </div>
                <div
                  style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}
                >
                  <button
                    className="btn btn-secondary"
                    onClick={() => setPayResults(null)}
                  >
                    Upload Another Batch
                  </button>
                </div>
              </div>
            )}
            {/* Auto-generate next month — always visible once a period is loaded */}
            {billMonth !== null && billYear && (
              <div style={{ marginTop: "1.5rem", padding: "1rem", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8 }}>
                <div style={{ fontSize: "0.82rem", color: "#1e40af", fontWeight: 600, marginBottom: "0.75rem" }}>
                  Next Month Generation
                </div>
                <div style={{ display: "grid", gap: "0.75rem", marginBottom: "0.75rem", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
                  <label style={{ fontSize: 13 }}>
                    Generate for
                    <select value={nextGenScope} onChange={(e) => setNextGenScope(e.target.value)} style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}>
                      <option value="paid">Only successfully paid members</option>
                      <option value="all">All active members (society-wide)</option>
                    </select>
                  </label>
                  <label style={{ fontSize: 13 }}>
                    Member visibility
                    <select value={nextPushMode} onChange={(e) => setNextPushMode(e.target.value)} style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}>
                      <option value="now">Push now</option>
                      <option value="schedule">Schedule to date</option>
                    </select>
                  </label>
                  {nextPushMode === "schedule" && (
                    <label style={{ fontSize: 13 }}>
                      Push date
                      <input type="date" min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} value={nextPushDate} onChange={(e) => setNextPushDate(e.target.value)} style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }} />
                    </label>
                  )}
                </div>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    className="btn btn-primary"
                    disabled={autoGenState?.status === "running"}
                    onClick={() => {
                      setAutoGenState(null);
                      autoGenerateNextMonth();
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    {autoGenState?.status === "running"
                      ? autoGenState.progress?.total
                        ? `Generating... ${autoGenState.progress.current}/${autoGenState.progress.total}`
                        : "Generating..."
                      : `Auto-Generate ${new Date(billYear, billMonth + 1, 1).toLocaleString("en-IN", { month: "short", year: "numeric" })} Bills`}
                  </button>
                  {autoGenState?.status === "running" && autoGenState.progress?.total > 0 && (
                    <div style={{ width: 160, height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          background: "#2563eb",
                          width: `${(autoGenState.progress.current / autoGenState.progress.total) * 100}%`,
                          transition: "width 0.2s",
                        }}
                      />
                    </div>
                  )}
                  {autoGenState?.status === "done" && (
                    <span style={{ color: "#16a34a", fontWeight: 600, fontSize: 14 }}>
                      ✅ {autoGenState.count} bills generated for {autoGenState.label}
                    </span>
                  )}
                  {autoGenState?.status === "error" && (
                    <span style={{ color: "#dc2626", fontSize: 13 }}>
                      ❌ {autoGenState.error}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}