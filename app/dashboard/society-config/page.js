"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";
import gridStyles from "@/styles/BillingGrid.module.css";
import { produce } from "immer";

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
      billDueDay: 10,
      interestCalculationMethod: "COMPOUND",
      interestCompoundingFrequency: "MONTHLY",
      fixedCharges: {
        water: 0,
        security: 0,
        electricity: 0,
      },
    },
  });
  const [errors, setErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState("");
  const [templateFile, setTemplateFile] = useState(null);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);

  const { data: societyData, isLoading } = useQuery({
    queryKey: ["society-config"],
    queryFn: () => apiClient.get("/api/society/config"),
  });

  useEffect(() => {
    if (societyData?.society) {
      // ✅ COMPLETE FIX 5: Ensure all fields are defined with fallbacks
      setFormData({
        name: societyData.society.name || "",
        registrationNo: societyData.society.registrationNo || "",
        address: societyData.society.address || "",
        config: {
          maintenanceRate: societyData.society.config?.maintenanceRate ?? 0,
          sinkingFundRate: societyData.society.config?.sinkingFundRate ?? 0,
          repairFundRate: societyData.society.config?.repairFundRate ?? 0,
          interestRate: societyData.society.config?.interestRate ?? 0,
          serviceTaxRate: societyData.society.config?.serviceTaxRate ?? 0,
          gracePeriodDays: societyData.society.config?.gracePeriodDays ?? 10,
          billDueDay: societyData.society.config?.billDueDay ?? 10, // ✅ CRITICAL: Prevents undefined
          interestCalculationMethod:
            societyData.society.config?.interestCalculationMethod ?? "COMPOUND",
          interestCompoundingFrequency:
            societyData.society.config?.interestCompoundingFrequency ??
            "MONTHLY",
          fixedCharges: {
            water: societyData.society.config?.fixedCharges?.water ?? 0,
            security: societyData.society.config?.fixedCharges?.security ?? 0,
            electricity:
              societyData.society.config?.fixedCharges?.electricity ?? 0,
          },
        },
      });

      console.log(
        "✅ Loaded billDueDay from DB:",
        societyData.society.config?.billDueDay
      ); // Debug
    }
  }, [societyData]);

  const updateMutation = useMutation({
    mutationFn: (data) => apiClient.put("/api/society/update", data),
    onSuccess: (data) => {
      setSuccessMessage("✅ Society configuration updated successfully!");

      // ✅ UPDATE FORM STATE WITH SERVER RESPONSE
      if (data.society) {
        setFormData({
          name: data.society.name || "",
          registrationNo: data.society.registrationNo || "",
          address: data.society.address || "",
          config: {
            maintenanceRate: data.society.config?.maintenanceRate ?? 0,
            sinkingFundRate: data.society.config?.sinkingFundRate ?? 0,
            repairFundRate: data.society.config?.repairFundRate ?? 0,
            interestRate: data.society.config?.interestRate ?? 0,
            serviceTaxRate: data.society.config?.serviceTaxRate ?? 0,
            gracePeriodDays: data.society.config?.gracePeriodDays ?? 10,
            billDueDay: data.society.config?.billDueDay ?? 10, // ✅ THIS
            interestCalculationMethod:
              data.society.config?.interestCalculationMethod ?? "COMPOUND",
            interestCompoundingFrequency:
              data.society.config?.interestCompoundingFrequency ?? "MONTHLY",
            fixedCharges: {
              water: data.society.config?.fixedCharges?.water ?? 0,
              security: data.society.config?.fixedCharges?.security ?? 0,
              electricity: data.society.config?.fixedCharges?.electricity ?? 0,
            },
          },
        });

        console.log("✅ Form state updated with server data");
      }

      queryClient.invalidateQueries(["society-config"]);
      setTimeout(() => setSuccessMessage(""), 5000);
    },
    onError: (error) => {
      setErrors({ submit: error.message });
    },
  });
  const handleTemplateUpload = async () => {
    if (!templateFile) {
      alert("Please select a PDF file");
      return;
    }

    setUploadingTemplate(true);
    try {
      const formData = new FormData();
      formData.append("template", templateFile);

      const response = await fetch("/api/society/upload-template", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        alert("Template uploaded successfully!");
        setTemplateFile(null);
        queryClient.invalidateQueries(["society-config"]);
      } else {
        alert(result.error || "Upload failed");
      }
    } catch (error) {
      console.error("Upload error:", error);
      alert("Failed to upload template");
    } finally {
      setUploadingTemplate(false);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!confirm("Delete uploaded template and use default?")) return;

    try {
      const response = await fetch("/api/society/upload-template", {
        method: "DELETE",
      });

      if (response.ok) {
        alert("Template deleted");
        queryClient.invalidateQueries(["society-config"]);
      }
    } catch (error) {
      alert("Failed to delete template");
    }
  };
  const handleChange = (path, value) => {
    setFormData((prev) =>
      produce(prev, (draft) => {
        const keys = path.split(".");
        let current = draft;

        // Navigate to the parent of the target key
        for (let i = 0; i < keys.length - 1; i++) {
          if (!current[keys[i]]) {
            current[keys[i]] = {}; // Create if doesn't exist
          }
          current = current[keys[i]];
        }

        // Set the final value
        current[keys[keys.length - 1]] = value;
        console.log(`✅ Updated ${path} to:`, value);
      })
    );

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

  const handleSubmit = async (e) => {
    e.preventDefault();

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    try {
      await updateMutation.mutateAsync(formData);

      // ✅ CRITICAL: Update state with response data
      // This ensures the form shows the saved values
      console.log("✅ Save successful, state updated");
    } catch (error) {
      console.error("❌ Save failed:", error);
      setErrors({ submit: error.message });
    }
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
            {/* Interest Rate on Arrears */}
            <div className={gridStyles.formGroup}>
              <label className="label">
                Interest Rate on Arrears (% per annum) *
              </label>
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
                placeholder="21.00"
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
                Annual interest rate on overdue payments (e.g., 21% p.a.)
              </span>
            </div>

            {/* Service Tax Rate */}
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
                placeholder="2.00"
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
                Tax applied on total charges (e.g., GST 2%)
              </span>
            </div>

            {/* Grace Period Days */}
            <div className={gridStyles.formGroup}>
              <label className="label">Interest Grace Period (days) *</label>
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
                placeholder="15"
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
                Days after due date before interest starts accruing
              </span>
            </div>
            {/* Bill Template Section */}
            <div
              className={styles.contentCard}
              style={{ marginBottom: "var(--spacing-lg)" }}
            >
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>📄 Bill Template</h2>
              </div>

              <div style={{ padding: "var(--spacing-lg)" }}>
                {societyData?.society?.billTemplate?.type === "uploaded" ? (
                  <div
                    style={{
                      padding: "var(--spacing-md)",
                      backgroundColor: "var(--bg-secondary)",
                      borderRadius: "var(--radius-md)",
                      marginBottom: "var(--spacing-md)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div
                          style={{ fontWeight: "bold", marginBottom: "5px" }}
                        >
                          ✅ Custom Template Uploaded
                        </div>
                        <div
                          style={{
                            fontSize: "var(--font-sm)",
                            color: "var(--text-secondary)",
                          }}
                        >
                          {societyData.society.billTemplate.fileName}
                        </div>
                        <div
                          style={{
                            fontSize: "var(--font-xs)",
                            color: "var(--text-secondary)",
                          }}
                        >
                          Uploaded:{" "}
                          {new Date(
                            societyData.society.billTemplate.uploadedAt
                          ).toLocaleString()}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "10px" }}>
                        <a
                          href={societyData.society.billTemplate.filePath}
                          target="_blank"
                          className="btn btn-secondary"
                        >
                          👁️ Preview
                        </a>
                        <button
                          onClick={handleDeleteTemplate}
                          className="btn btn-danger"
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: "var(--spacing-md)",
                      backgroundColor: "#FEF3C7",
                      borderRadius: "var(--radius-md)",
                      marginBottom: "var(--spacing-md)",
                    }}
                  >
                    ⚠️ Using default system template. Upload your custom PDF
                    template below.
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    gap: "var(--spacing-md)",
                    alignItems: "center",
                  }}
                >
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => setTemplateFile(e.target.files[0])}
                    style={{ flex: 1 }}
                    className="input"
                  />
                  <button
                    onClick={handleTemplateUpload}
                    disabled={!templateFile || uploadingTemplate}
                    className="btn btn-primary"
                  >
                    {uploadingTemplate ? "Uploading..." : "📤 Upload Template"}
                  </button>
                </div>

                <p
                  style={{
                    fontSize: "var(--font-sm)",
                    color: "var(--text-secondary)",
                    marginTop: "var(--spacing-sm)",
                  }}
                >
                  Upload a blank PDF template. The system will overlay member
                  data on it when generating bills.
                </p>
              </div>
            </div>
            {/* Bill Due Day */}
            <div className={gridStyles.formGroup}>
              <label className="label">Bill Due Day of Month *</label>
              <input
                type="number"
                min="1"
                max="31"
                value={formData.config?.billDueDay ?? 10}
                onChange={(e) => {
                  const value =
                    e.target.value === "" ? 10 : parseInt(e.target.value);
                  handleChange("config.billDueDay", value);
                }}
                className="input"
                placeholder="10"
              />
              {errors["config.billDueDay"] && (
                <p className="error-text">{errors["config.billDueDay"]}</p>
              )}
              <span
                style={{
                  fontSize: "var(--font-xs)",
                  color: "var(--text-secondary)",
                }}
              >
                Day of month when bills are due (e.g., 10 for 10th of every
                month)
              </span>
            </div>

            {/* Interest Calculation Method */}
            <div className={gridStyles.formGroup}>
              <label className="label">Interest Calculation Method</label>
              <select
                value={formData.config.interestCalculationMethod}
                onChange={(e) =>
                  handleChange(
                    "config.interestCalculationMethod",
                    e.target.value
                  )
                }
                className="input"
              >
                <option value="SIMPLE">Simple Interest</option>
                <option value="COMPOUND">Compound Interest</option>
              </select>
              <span
                style={{
                  fontSize: "var(--font-xs)",
                  color: "var(--text-secondary)",
                }}
              >
                How interest is calculated on overdue amounts
              </span>
            </div>

            {/* Compounding Frequency */}
            <div className={gridStyles.formGroup}>
              <label className="label">Interest Compounding Frequency</label>
             <select 
  value={formData.config.interestCompoundingFrequency}
  onChange={(e) => handleChange('config.interestCompoundingFrequency', e.target.value)}
  className="input"
  disabled={formData.config.interestCalculationMethod === 'SIMPLE'}
>
  <option value="MONTHLY">Monthly</option>
</select>

              <span
                style={{
                  fontSize: "var(--font-xs)",
                  color: "var(--text-secondary)",
                }}
              >
                Only applies when Compound Interest is selected
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
