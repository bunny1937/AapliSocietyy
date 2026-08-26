"use client";
export default function ExcelPreviewGrid({ columns, rows, title, onReupload, onContinue, onCancel, summary }) {
  const validRows = rows.filter((r) => r.status !== "error");
  const errorRows = rows.filter((r) => r.status === "error");
  const warningRows = rows.filter((r) => r.status === "warning");
  const rowBg = (status) => ({ valid: "transparent", warning: "var(--warning-bg)", error: "var(--danger-bg)", skipped: "var(--bg-canvas)" }[status] || "transparent");
  const cellStyle = (cellStatus) => {
    const base = {
      padding: "6px 10px",
      border: "1px solid var(--border)",
      fontSize: "0.78rem",
      whiteSpace: "nowrap",
      maxWidth: "180px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      verticalAlign: "top",
    };
    if (cellStatus === "error") return { ...base, background: "var(--danger-bg)", border: "1px solid var(--danger)", color: "var(--danger-fg)", fontWeight: 600 };
    if (cellStatus === "warning") return { ...base, background: "var(--warning-bg)", border: "1px solid var(--warning)", color: "var(--warning-fg)" };
    return base;
  };
  return (
    <div style={{ background: "var(--bg-surface)", border: "2px solid var(--border)", borderRadius: "12px", overflow: "hidden", marginBottom: "1.5rem" }}>
      {/* Header */}
      <div style={{ background: "var(--bg-sunken)", padding: "1rem 1.5rem", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", color: "var(--fg-1)" }}>{title || "Upload Preview"}</h3>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          {[
            ["Valid", validRows.length, "var(--success)", "var(--success-bg)"],
            ["Warnings", warningRows.length, "var(--warning)", "var(--warning-bg)"],
            ["Errors", errorRows.length, "var(--danger)", "var(--danger-bg)"],
          ].map(([label, count, color, bg]) => (
            <div key={label} style={{ background: bg, border: `1px solid ${color}`, borderRadius: "6px", padding: "4px 12px", textAlign: "center", minWidth: "70px" }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color }}>{count}</div>
              <div style={{ fontSize: "0.7rem", color }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
      {/* Grid */}
      <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "440px" }}>
        <table style={{ borderCollapse: "collapse", width: "max-content", minWidth: "100%" }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--bg-muted)" }}>
            <tr>
              <th style={{ padding: "8px 10px", border: "1px solid var(--border-strong)", background: "var(--border)", fontSize: "0.75rem", color: "var(--fg-3)", fontWeight: 700, minWidth: "50px" }}>#</th>
              <th style={{ padding: "8px 10px", border: "1px solid var(--border-strong)", background: "var(--border)", fontSize: "0.75rem", color: "var(--fg-3)", fontWeight: 700, minWidth: "80px" }}>Status</th>
              {columns.map((col) => (
                <th key={col} style={{ padding: "8px 10px", border: "1px solid var(--border-strong)", fontSize: "0.75rem", color: "var(--fg-3)", fontWeight: 700, textAlign: "left", whiteSpace: "nowrap" }}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowNum} style={{ background: rowBg(row.status) }}>
                <td style={{ padding: "6px 10px", border: "1px solid var(--border)", fontSize: "0.75rem", color: "var(--fg-5)", textAlign: "center" }}>{row.rowNum}</td>
                <td style={{ padding: "6px 10px", border: "1px solid var(--border)", textAlign: "center" }}>
                  {row.status === "valid" && <span style={{ background: "var(--success-bg)", color: "var(--success-fg)", padding: "2px 8px", borderRadius: "10px", fontSize: "0.7rem", fontWeight: 700 }}>✓ Valid</span>}
                  {row.status === "warning" && <span style={{ background: "var(--warning-bg)", color: "var(--warning-fg)", padding: "2px 8px", borderRadius: "10px", fontSize: "0.7rem", fontWeight: 700 }}>⚠ Warn</span>}
                  {row.status === "error" && <span style={{ background: "var(--danger-bg)", color: "var(--danger-fg)", padding: "2px 8px", borderRadius: "10px", fontSize: "0.7rem", fontWeight: 700 }}>✗ Error</span>}
                  {row.status === "skipped" && <span style={{ background: "var(--bg-muted)", color: "var(--fg-4)", padding: "2px 8px", borderRadius: "10px", fontSize: "0.7rem", fontWeight: 700 }}>— No Payment</span>}
                </td>
                {columns.map((col) => {
                  const cell = row.cells[col] || { value: "" };
                  return (
                    <td key={col} style={cellStyle(cell.status)} title={cell.message || ""}>
                      {cell.value === undefined || cell.value === null ? "" : String(cell.value)}
                      {cell.message && (
                        <div style={{ fontSize: "0.65rem", color: cell.status === "error" ? "var(--danger)" : "var(--warning)", marginTop: "2px", whiteSpace: "normal" }}>
                          {cell.message}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Footer Actions */}
      <div style={{ padding: "1rem 1.5rem", borderTop: "2px solid var(--border)", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
       <button className="btn btn-secondary" onClick={onReupload}>↩ Re-upload</button>
<button className="btn btn-danger" style={{ marginLeft: "auto" }} onClick={onCancel}>✕ Cancel Upload</button></div>
    </div>
  );
}
