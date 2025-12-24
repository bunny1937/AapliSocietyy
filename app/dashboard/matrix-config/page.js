"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";
import gridStyles from "@/styles/BillingGrid.module.css";

export default function MatrixConfigPage() {
  const queryClient = useQueryClient();
  const [L, setL] = useState(5);
  const [R, setR] = useState(5);
  const [billingHeads, setBillingHeads] = useState([]);
  const [errors, setErrors] = useState([]);
  const [successMessage, setSuccessMessage] = useState("");

  const { data: societyData, isLoading } = useQuery({
    queryKey: ["society-config"],
    queryFn: () => apiClient.get("/api/society/config"),
  });

  useEffect(() => {
    if (societyData?.society) {
      const { matrixConfig, billingHeads: existingHeads } = societyData.society;
      if (matrixConfig?.L) setL(matrixConfig.L);
      if (matrixConfig?.R) setR(matrixConfig.R);
      if (existingHeads?.length > 0) {
        setBillingHeads(existingHeads);
      }
    }
  }, [societyData]);

  const saveMutation = useMutation({
    mutationFn: (data) => apiClient.post("/api/society/create", data),
    onSuccess: () => {
      setSuccessMessage("Matrix configuration saved successfully!");
      queryClient.invalidateQueries(["society-config"]);
      setTimeout(() => setSuccessMessage(""), 3000);
    },
    onError: (error) => {
      setErrors([error.message]);
    },
  });

  const generateMatrix = () => {
    const totalCells = L * R;
    const newHeads = [];

    for (let i = 0; i < totalCells; i++) {
      const rowIndex = Math.floor(i / R);
      const colIndex = i % R;
      const id = `L${rowIndex + 1}_R${colIndex + 1}`;

      const existing = billingHeads.find((h) => h.id === id);

      newHeads.push({
        id,
        label: existing?.label || `Charge ${rowIndex + 1}-${colIndex + 1}`,
      });
    }

    setBillingHeads(newHeads);
    setErrors([]);
  };

  const handleLabelChange = (id, newLabel) => {
    setBillingHeads((prev) =>
      prev.map((head) => (head.id === id ? { ...head, label: newLabel } : head))
    );
  };

  const handleRemoveHead = (id) => {
    setBillingHeads((prev) => prev.filter((head) => head.id !== id));
  };

  const handleAddCustom = () => {
    const newId = `CUSTOM_${Date.now()}`;
    setBillingHeads((prev) => [...prev, { id: newId, label: "Custom Charge" }]);
  };

  const validateAndSave = () => {
    const validationErrors = [];

    if (L < 1 || L > 50) {
      validationErrors.push("L must be between 1 and 50");
    }

    if (R < 1 || R > 50) {
      validationErrors.push("R must be between 1 and 50");
    }

    if (billingHeads.length === 0) {
      validationErrors.push("At least one billing head is required");
    }

    const emptyLabels = billingHeads.filter((h) => !h.label.trim());
    if (emptyLabels.length > 0) {
      validationErrors.push("All billing heads must have labels");
    }

    const uniqueLabels = new Set(
      billingHeads.map((h) => h.label.trim().toLowerCase())
    );
    if (uniqueLabels.size !== billingHeads.length) {
      validationErrors.push("Billing head labels must be unique");
    }

    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors([]);
    saveMutation.mutate({ L, R, billingHeads });
  };

  if (isLoading) {
    return (
      <div
        style={{ display: "flex", justifyContent: "center", padding: "40px" }}
      >
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Matrix Configuration</h1>
        <p className={styles.pageSubtitle}>
          Define your dynamic billing structure with L×R matrix
        </p>
      </div>

      {errors.length > 0 && (
        <div className={gridStyles.errorList}>
          <div className={gridStyles.errorListTitle}>
            ⚠️ Configuration Errors
          </div>
          <ul className={gridStyles.errorListItems}>
            {errors.map((error, index) => (
              <li key={index} className={gridStyles.errorListItem}>
                {error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {successMessage && (
        <div
          className="toast toast-success"
          style={{ position: "relative", marginBottom: "var(--spacing-lg)" }}
        >
          ✓ {successMessage}
        </div>
      )}

      <div className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Matrix Dimensions</h2>
        </div>

        <div className={gridStyles.configForm}>
          <div className={gridStyles.formRow}>
            <div className={gridStyles.formGroup}>
              <label className="label" htmlFor="L">
                L (Rows) - Number of billing categories
              </label>
              <input
                type="number"
                id="L"
                min="1"
                max="50"
                value={L}
                onChange={(e) => setL(parseInt(e.target.value) || 1)}
                className="input"
              />
              <span
                style={{
                  fontSize: "var(--font-xs)",
                  color: "var(--text-secondary)",
                }}
              >
                Recommended: 5-10 rows
              </span>
            </div>

            <div className={gridStyles.formGroup}>
              <label className="label" htmlFor="R">
                R (Columns) - Variations per category
              </label>
              <input
                type="number"
                id="R"
                min="1"
                max="50"
                value={R}
                onChange={(e) => setR(parseInt(e.target.value) || 1)}
                className="input"
              />
              <span
                style={{
                  fontSize: "var(--font-xs)",
                  color: "var(--text-secondary)",
                }}
              >
                Recommended: 3-7 columns
              </span>
            </div>
          </div>

          <div style={{ display: "flex", gap: "var(--spacing-md)" }}>
            <button onClick={generateMatrix} className="btn btn-primary">
              🔄 Generate Matrix ({L}×{R} = {L * R} cells)
            </button>

            <button onClick={handleAddCustom} className="btn btn-secondary">
              ➕ Add Custom Head
            </button>
          </div>
        </div>
      </div>

      {billingHeads.length > 0 && (
        <div className={styles.contentCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>
              Billing Heads Configuration ({billingHeads.length} items)
            </h2>
          </div>

          <div className={gridStyles.matrixPreview}>
            <div className={gridStyles.matrixPreviewTitle}>
              💡 Tip: These labels will appear as columns in your billing grid
              and Excel template
            </div>

            <div className={gridStyles.matrixGrid}>
              {billingHeads.map((head, index) => (
                <div key={head.id} className={gridStyles.matrixRow}>
                  <span
                    style={{
                      fontSize: "var(--font-sm)",
                      color: "var(--text-tertiary)",
                      minWidth: "40px",
                    }}
                  >
                    #{index + 1}
                  </span>

                  <div className={gridStyles.matrixLabel}>
                    <span
                      style={{
                        fontSize: "var(--font-xs)",
                        color: "var(--text-tertiary)",
                        fontFamily: "monospace",
                      }}
                    >
                      {head.id}
                    </span>
                    <input
                      type="text"
                      value={head.label}
                      onChange={(e) =>
                        handleLabelChange(head.id, e.target.value)
                      }
                      className="input"
                      style={{ flex: 1 }}
                      placeholder="Enter label"
                    />
                  </div>

                  <button
                    onClick={() => handleRemoveHead(head.id)}
                    className={gridStyles.deleteBtn}
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              marginTop: "var(--spacing-lg)",
              display: "flex",
              justifyContent: "flex-end",
              gap: "var(--spacing-md)",
            }}
          >
            <button
              onClick={validateAndSave}
              className="btn btn-success"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <>
                  <span className="loading-spinner"></span>
                  Saving...
                </>
              ) : (
                <>💾 Save Configuration</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
