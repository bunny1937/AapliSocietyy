"use client";
// app/admin/generate-bills/ExcelBillUploadFlow.jsx
//
// Residential's bill-generation panel: preview + generate this period's
// bills, record collections, and set up next month's run.
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
import CollectionsPanel from "./CollectionsPanel";

export default function ExcelBillUploadFlow({
  periodLabel,
  hasValidPeriodLabel,
  isPreviewing,
  previewProgress,
  generatePreview,
  billMonth,
  billYear,
  nextGenScope,
  setNextGenScope,
  nextPushMode,
  setNextPushMode,
  nextPushDate,
  setNextPushDate,
  autoGenState,
  setAutoGenState,
  autoGenerateNextMonth,
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

        {/* Next month's generation — always visible once a period is loaded */}
        {billMonth !== null && billYear && (
          <div
            style={{
              padding: "1rem",
              background: "var(--primary-tint)",
              border: "1px solid var(--primary-tint)",
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: "0.82rem", color: "var(--info)", fontWeight: 600, marginBottom: "0.75rem" }}>
              Next Month Generation
            </div>
            <div
              style={{
                display: "grid",
                gap: "0.75rem",
                marginBottom: "0.75rem",
                gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
              }}
            >
              <label style={{ fontSize: 13 }}>
                Generate for
                <select
                  value={nextGenScope}
                  onChange={(e) => setNextGenScope(e.target.value)}
                  style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
                >
                  <option value="paid">Only successfully paid members</option>
                  <option value="all">All active members (society-wide)</option>
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                Member visibility
                <select
                  value={nextPushMode}
                  onChange={(e) => setNextPushMode(e.target.value)}
                  style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
                >
                  <option value="now">Push now</option>
                  <option value="schedule">Schedule to date</option>
                </select>
              </label>
              {nextPushMode === "schedule" && (
                <label style={{ fontSize: 13 }}>
                  Push date
                  <input
                    type="date"
                    min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                    value={nextPushDate}
                    onChange={(e) => setNextPushDate(e.target.value)}
                    style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
                  />
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
                <div style={{ width: 160, height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      background: "var(--primary)",
                      width: `${(autoGenState.progress.current / autoGenState.progress.total) * 100}%`,
                      transition: "width 0.2s",
                    }}
                  />
                </div>
              )}
              {autoGenState?.status === "done" && (
                <span style={{ color: "var(--success)", fontWeight: 600, fontSize: 14 }}>
                  ✅ {autoGenState.count} bills generated for {autoGenState.label}
                </span>
              )}
              {autoGenState?.status === "error" && (
                <span style={{ color: "var(--danger)", fontSize: 13 }}>
                  ❌ {autoGenState.error}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
