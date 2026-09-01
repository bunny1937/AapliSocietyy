"use client";
// app/admin/generate-bills/ExcelBillUploadFlow.jsx
//
// Residential's bill-generation panel: preview + generate this period's
// bills, record collections.
//
// This used to be a full Excel download/edit/upload round trip ("Unified
// Template" — download a spreadsheet, fill AmountPaid columns, re-upload,
// let the system diff it against its own calculation). That workflow is no
// longer how this gets done — bills are generated straight from the Preview
// modal below (client-computed, same code path Commercial uses), and
// payments are recorded directly in the browser via <CollectionsPanel/>.
// The Excel round trip was left rendering after it stopped being used,
// which is why this screen used to show two full "download a template /
// upload a template" steps that no admin was actually following anymore.
//
// A second "Next Month Generation" panel used to sit below this one, with
// its own Generate-for/Push-now-or-schedule controls and a duplicate
// generation code path (autoGenerateNextMonth in BillGenerationFlow.jsx).
// Removed — it was redundant with the two real ways to move to next month
// (CollectionsPanel's own "Push & schedule" choice, or just opening Preview
// Bills manually once the period rolls over), and it carried a real bug: it
// built `new Date(nextPushDate + "T09:00...")` and called .toISOString() on
// it BEFORE checking whether nextPushDate was even set, so picking "Push
// now" after the scope dropdown had reset back to its "schedule" default (as
// happened when member visibility got re-picked after an earlier validation
// error) threw on an Invalid Date and left the button stuck on "Generating…"
// forever, with no bill ever created and no error shown.
import CollectionsPanel from "./CollectionsPanel";

export default function ExcelBillUploadFlow({
  periodLabel,
  hasValidPeriodLabel,
  isPreviewing,
  previewProgress,
  generatePreview,
}) {
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "2px solid var(--accent-tint)",
        borderRadius: "12px",
        marginBottom: "1.5rem",
        overflowX: "visible",
        overflowY: "hidden",
      }}
    >
      <div
        style={{
          background: "var(--accent-tint)",
          padding: "1rem 1.5rem",
          borderBottom: "1px solid var(--accent-tint)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1.1rem", color: "var(--primary)" }}>
          Residential Bill Generation &amp; Payment Collection
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "var(--accent)" }}>
          Preview every flat&apos;s bill, generate, then record collections directly in the browser.
        </p>
      </div>

      <div style={{ padding: "1.5rem" }}>
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            flexWrap: "wrap",
            // Without this the collections panel inherits min-width:auto
            // from its 1380px table and can never shrink, so no scrollbar
            // is generated and the right-hand columns are unreachable.
            minWidth: 0,
            marginBottom: "1.5rem",
          }}
        >
          {hasValidPeriodLabel ? (
            <CollectionsPanel periodId={periodLabel} />
          ) : (
            <div
              style={{
                fontSize: "0.82rem",
                color: "var(--fg-4)",
                padding: "0.6rem 0.9rem",
                border: "1px dashed var(--border-strong)",
                borderRadius: "8px",
                background: "var(--bg-sunken)",
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
              <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
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
    </div>
  );
}
