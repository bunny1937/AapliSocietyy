"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";
import gridStyles from "@/styles/BillingGrid.module.css";

export default function SocietyConfigPage() {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: "",
    registrationNo: "",
    address: "",
    config: {
      maintenanceRate: 0,
      sinkingFundRate: 0,
      repairFundRate: 0,
      interestRate: 0,
      serviceTaxRate: 0,
      gracePeriodDays: 10,
      fixedCharges: {
        water: 0,
        security: 0,
        electricity: 0,
      },
    },
  });
  const [errors, setErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState("");

  const { data: societyData, isLoading } = useQuery({
    queryKey: ["society-config"],
    queryFn: () => apiClient.get("/api/society/config"),
  });

  useEffect(() => {
    if (societyData?.society) {
      setFormData(societyData.society);
    }
  }, [societyData]);

  const updateMutation = useMutation({
    mutationFn: (data) => apiClient.put("/api/society/update", data),
    onSuccess: () => {
      setSuccessMessage("✓ Society configuration updated successfully!");
      queryClient.invalidateQueries(["society-config"]);
      setTimeout(() => setSuccessMessage(""), 5000);
    },
    onError: (error) => {
      setErrors({ submit: error.message });
    },
  });

  const handleChange = (path, value) => {
    setFormData((prev) => {
      const newData = { ...prev };
      const keys = path.split(".");
      let current = newData;

      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]];
      }

      current[keys[keys.length - 1]] = value;
      return newData;
    });

    if (errors[path]) {
      setErrors((prev) => ({ ...prev, [path]: "" }));
    }
  };

  const validate = () => {
    const newErrors = {};

    if (!formData.name || formData.name.trim().length < 2) {
      newErrors.name = "Society name must be at least 2 characters";
    }

    if (formData.config.maintenanceRate < 0) {
      newErrors.maintenanceRate = "Maintenance rate cannot be negative";
    }

    if (
      formData.config.interestRate < 0 ||
      formData.config.interestRate > 100
    ) {
      newErrors.interestRate = "Interest rate must be between 0 and 100";
    }

    if (
      formData.config.serviceTaxRate < 0 ||
      formData.config.serviceTaxRate > 100
    ) {
      newErrors.serviceTaxRate = "Service tax rate must be between 0 and 100";
    }

    if (
      formData.config.gracePeriodDays < 0 ||
      formData.config.gracePeriodDays > 90
    ) {
      newErrors.gracePeriodDays = "Grace period must be between 0 and 90 days";
    }

    return newErrors;
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    updateMutation.mutate(formData);
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
        <h1 className={styles.pageTitle}>Society Configuration</h1>
        <p className={styles.pageSubtitle}>
          Manage society details and financial parameters
        </p>
      </div>

      {successMessage && (
        <div
          className="toast toast-success"
          style={{ position: "relative", marginBottom: "var(--spacing-lg)" }}
        >
          {successMessage}
        </div>
      )}

      {errors.submit && (
        <div className={gridStyles.errorList}>
          <div className={gridStyles.errorListTitle}>❌ Update Failed</div>
          <div>{errors.submit}</div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className={styles.contentCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Basic Information</h2>
          </div>

          <div className={gridStyles.configForm}>
            <div className={gridStyles.formGroup}>
              <label className="label">Society Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleChange("name", e.target.value)}
                className={`input ${errors.name ? "input-error" : ""}`}
                placeholder="Green Valley Apartments"
              />
              {errors.name && <p className="error-text">{errors.name}</p>}
            </div>

            <div className={gridStyles.formRow}>
              <div className={gridStyles.formGroup}>
                <label className="label">Registration Number</label>
                <input
                  type="text"
                  value={formData.registrationNo}
                  onChange={(e) =>
                    handleChange("registrationNo", e.target.value)
                  }
                  className="input"
                  placeholder="REG/2024/1234"
                />
              </div>
            </div>

            <div className={gridStyles.formGroup}>
              <label className="label">Address</label>
              <textarea
                value={formData.address}
                onChange={(e) => handleChange("address", e.target.value)}
                className="input"
                rows="3"
                placeholder="Complete society address"
              />
            </div>
          </div>
        </div>

        <div className={styles.contentCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Maintenance Rates (per sq.ft)</h2>
          </div>

          <div className={gridStyles.formRow}>
            <div className={gridStyles.formGroup}>
              <label className="label">Maintenance Rate (₹/sq.ft) *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.config.maintenanceRate}
                onChange={(e) =>
                  handleChange(
                    "config.maintenanceRate",
                    parseFloat(e.target.value) || 0
                  )
                }
                className={`input ${
                  errors.maintenanceRate ? "input-error" : ""
                }`}
                placeholder="0.00"
              />
              {errors.maintenanceRate && (
                <p className="error-text">{errors.maintenanceRate}</p>
              )}
              <span
                style={{
                  fontSize: "var(--font-xs)",
                  color: "var(--text-secondary)",
                }}
              >
                Base maintenance charge per square foot
              </span>
            </div>

            <div className={gridStyles.formGroup}>
              <label className="label">Sinking Fund Rate (₹/sq.ft)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.config.sinkingFundRate}
                onChange={(e) =>
                  handleChange(
                    "config.sinkingFundRate",
                    parseFloat(e.target.value) || 0
                  )
                }
                className="input"
                placeholder="0.00"
              />
              <span
                style={{
                  fontSize: "var(--font-xs)",
                  color: "var(--text-secondary)",
                }}
              >
                Long-term corpus fund
              </span>
            </div>

            <div className={gridStyles.formGroup}>
              <label className="label">Repair Fund Rate (₹/sq.ft)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.config.repairFundRate}
                onChange={(e) =>
                  handleChange(
                    "config.repairFundRate",
                    parseFloat(e.target.value) || 0
                  )
                }
                className="input"
                placeholder="0.00"
              />
              <span
                style={{
                  fontSize: "var(--font-xs)",
                  color: "var(--text-secondary)",
                }}
              >
                Major repair and renovation fund
              </span>
            </div>
          </div>
        </div>

        <div className={styles.contentCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Fixed Charges (per flat)</h2>
          </div>

          <div className={gridStyles.formRow}>
            <div className={gridStyles.formGroup}>
              <label className="label">Water Charges (₹)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.config.fixedCharges.water}
                onChange={(e) =>
                  handleChange(
                    "config.fixedCharges.water",
                    parseFloat(e.target.value) || 0
                  )
                }
                className="input"
                placeholder="0.00"
              />
            </div>

            <div className={gridStyles.formGroup}>
              <label className="label">Security Charges (₹)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.config.fixedCharges.security}
                onChange={(e) =>
                  handleChange(
                    "config.fixedCharges.security",
                    parseFloat(e.target.value) || 0
                  )
                }
                className="input"
                placeholder="0.00"
              />
            </div>

            <div className={gridStyles.formGroup}>
              <label className="label">Electricity Charges (₹)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.config.fixedCharges.electricity}
                onChange={(e) =>
                  handleChange(
                    "config.fixedCharges.electricity",
                    parseFloat(e.target.value) || 0
                  )
                }
                className="input"
                placeholder="0.00"
              />
            </div>
          </div>
        </div>

        <div className={styles.contentCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Financial Parameters</h2>
          </div>

          <div className={gridStyles.formRow}>
            <div className={gridStyles.formGroup}>
              <label className="label">Interest Rate on Arrears (%) *</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={formData.config.interestRate}
                onChange={(e) =>
                  handleChange(
                    "config.interestRate",
                    parseFloat(e.target.value) || 0
                  )
                }
                className={`input ${errors.interestRate ? "input-error" : ""}`}
                placeholder="0.00"
              />
              {errors.interestRate && (
                <p className="error-text">{errors.interestRate}</p>
              )}
              <span
                style={{
                  fontSize: "var(--font-xs)",
                  color: "var(--text-secondary)",
                }}
              >
                Monthly interest on overdue payments (e.g., 2% = 24% annual)
              </span>
            </div>

            <div className={gridStyles.formGroup}>
              <label className="label">Service Tax Rate (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={formData.config.serviceTaxRate}
                onChange={(e) =>
                  handleChange(
                    "config.serviceTaxRate",
                    parseFloat(e.target.value) || 0
                  )
                }
                className={`input ${
                  errors.serviceTaxRate ? "input-error" : ""
                }`}
                placeholder="0.00"
              />
              {errors.serviceTaxRate && (
                <p className="error-text">{errors.serviceTaxRate}</p>
              )}
              <span
                style={{
                  fontSize: "var(--font-xs)",
                  color: "var(--text-secondary)",
                }}
              >
                Tax applied on total charges (e.g., GST 18%)
              </span>
            </div>

            <div className={gridStyles.formGroup}>
              <label className="label">Grace Period (days) *</label>
              <input
                type="number"
                min="0"
                max="90"
                value={formData.config.gracePeriodDays}
                onChange={(e) =>
                  handleChange(
                    "config.gracePeriodDays",
                    parseInt(e.target.value) || 0
                  )
                }
                className={`input ${
                  errors.gracePeriodDays ? "input-error" : ""
                }`}
                placeholder="10"
              />
              {errors.gracePeriodDays && (
                <p className="error-text">{errors.gracePeriodDays}</p>
              )}
              <span
                style={{
                  fontSize: "var(--font-xs)",
                  color: "var(--text-secondary)",
                }}
              >
                Days after due date before interest is applied
              </span>
            </div>
          </div>
        </div>

        <div className={styles.contentCard}>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "var(--spacing-md)",
            }}
          >
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn btn-secondary"
            >
              🔄 Reset Changes
            </button>
            <button
              type="submit"
              className="btn btn-success"
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? (
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
      </form>
    </div>
  );
}
