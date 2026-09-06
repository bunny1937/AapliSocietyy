"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";
import gridStyles from "@/styles/BillingGrid.module.css";
import { produce } from "immer";

const CATEGORIES = [
  "Society Office",
  "Watchman/Security",
  "Plumber",
  "Electrician",
  "Gas Agency",
  "Housekeeping",
  "Pest Control",
  "Lift AMC",
  "Other",
];

let nextRowId = 0;
const blankRow = (category) => ({ _rowId: nextRowId++, category, name: "", numbers: [""] });

export default function SocietyContactsPage() {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState([]);
  const [successMessage, setSuccessMessage] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["society-contacts"],
    queryFn: () => apiClient.get("/api/admin/society-contacts"),
  });

  // Server rows come with 1-3 real numbers; a UI-only trailing blank input
  // is added when there's room to add one more, so the admin always has an
  // empty box ready without an extra click.
  useEffect(() => {
    if (!data?.contacts) return;
    setRows(
      data.contacts.map((c) => ({
        _rowId: nextRowId++,
        category: c.category,
        name: c.name || "",
        numbers: c.numbers.length < 3 ? [...c.numbers, ""] : c.numbers,
      })),
    );
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (contacts) => apiClient.put("/api/admin/society-contacts", { contacts }),
    onSuccess: () => {
      setSuccessMessage("✅ Essential contacts saved");
      setErrors([]);
      queryClient.invalidateQueries(["society-contacts"]);
      setTimeout(() => setSuccessMessage(""), 5000);
    },
    onError: (error) => {
      setErrors([error.message || "Save failed"]);
    },
  });

  const updateRow = (rowId, patch) =>
    setRows((prev) =>
      produce(prev, (draft) => {
        const row = draft.find((r) => r._rowId === rowId);
        if (row) Object.assign(row, patch);
      }),
    );

  const updateNumber = (rowId, idx, value) =>
    setRows((prev) =>
      produce(prev, (draft) => {
        const row = draft.find((r) => r._rowId === rowId);
        if (!row) return;
        row.numbers[idx] = value;
        // Keep exactly one trailing blank box while under the cap of 3.
        const filled = row.numbers.filter((n) => n.trim()).length;
        if (filled === row.numbers.length && row.numbers.length < 3) row.numbers.push("");
        row.numbers = row.numbers.filter((n, i) => n.trim() || i === row.numbers.length - 1);
      }),
    );

  const removeRow = (rowId) => setRows((prev) => prev.filter((r) => r._rowId !== rowId));

  const addRow = () => setRows((prev) => [...prev, blankRow(CATEGORIES[0])]);

  // Adds a blank row for every category not already present. Existing rows
  // (including ones the admin is mid-editing) are left untouched.
  const seedDefaults = () => {
    const present = new Set(rows.map((r) => r.category));
    const missing = CATEGORIES.filter((c) => !present.has(c)).map(blankRow);
    if (missing.length === 0) {
      setSuccessMessage("Every category already has a row.");
      setTimeout(() => setSuccessMessage(""), 4000);
      return;
    }
    setRows((prev) => [...prev, ...missing]);
  };

  const handleSave = () => {
    const payload = rows
      .map((r) => ({
        category: r.category,
        name: r.name.trim(),
        numbers: r.numbers.map((n) => n.trim()).filter(Boolean),
      }))
      .filter((r) => r.numbers.length > 0);
    saveMutation.mutate(payload);
  };

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "40px" }}>
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Essential Contacts</h1>
          <p className={styles.pageSubtitle}>
            Numbers a resident actually needs — society office, watchman, plumber, gas agency and
            more. Shown on the &ldquo;Essential contacts&rdquo; screen in the resident app.
          </p>
        </div>
        <div>
          <button type="button" onClick={seedDefaults} className="btn btn-secondary">
            🌱 Seed defaults
          </button>{" "}
          <button
            type="button"
            onClick={handleSave}
            className="btn btn-success"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <>
                <span className="loading-spinner"></span>
                Saving...
              </>
            ) : (
              <>💾 Save</>
            )}
          </button>
        </div>
      </div>

      {successMessage && (
        <div className="toast toast-success" style={{ position: "relative", marginBottom: "var(--spacing-lg)" }}>
          {successMessage}
        </div>
      )}
      {errors.length > 0 && (
        <div className={gridStyles.errorList}>
          <div className={gridStyles.errorListTitle}>❌ Could not save</div>
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      <div className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Contacts</h2>
        </div>
        <div style={{ padding: "0 1.25rem 1.25rem" }}>
          <p style={{ margin: "0 0 1rem", color: "var(--fg-3)", fontSize: "0.85rem" }}>
            Up to 3 numbers per contact — e.g. a plumber&rsquo;s own phone plus a WhatsApp or
            alternate number. A row with no number filled in is dropped when you save.
          </p>
          {rows.length === 0 && (
            <p style={{ color: "var(--fg-4)", fontSize: "0.85rem" }}>
              No contacts yet. Click &ldquo;Seed defaults&rdquo; to start from the standard
              categories, or &ldquo;+ Add contact&rdquo; below.
            </p>
          )}
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {rows.map((row) => (
              <div
                key={row._rowId}
                style={{
                  display: "grid",
                  gridTemplateColumns: "180px 1fr 1fr 1fr 1fr auto",
                  gap: "0.5rem",
                  alignItems: "center",
                  padding: "0.6rem",
                  border: "1px solid var(--primary-tint)",
                  borderRadius: "8px",
                }}
              >
                <select
                  value={row.category}
                  onChange={(e) => updateRow(row._rowId, { category: e.target.value })}
                  className="input"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => updateRow(row._rowId, { name: e.target.value })}
                  className="input"
                  placeholder={row.category === "Other" ? "Contact name *" : "Name (optional)"}
                />
                {[0, 1, 2].map((i) => (
                  <input
                    key={i}
                    type="tel"
                    value={row.numbers[i] ?? ""}
                    onChange={(e) => updateNumber(row._rowId, i, e.target.value)}
                    className="input"
                    placeholder={i === 0 ? "Phone number *" : `Number ${i + 1}`}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => removeRow(row._rowId)}
                  className="btn btn-secondary"
                  title="Remove contact"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addRow} className="btn btn-secondary" style={{ marginTop: "0.85rem" }}>
            + Add contact
          </button>
        </div>
      </div>
    </div>
  );
}
