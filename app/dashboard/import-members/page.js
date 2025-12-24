"use client";

import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";
import gridStyles from "@/styles/BillingGrid.module.css";

export default function ImportMembersPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [errors, setErrors] = useState([]);

  const importMutation = useMutation({
    mutationFn: async (formData) => {
      return apiClient.post("/api/members/import", formData);
    },
    onSuccess: (data) => {
      setImportResult(data);
      setErrors(data.errors || []);
      queryClient.invalidateQueries(["members-list"]);
    },
    onError: (error) => {
      setErrors([{ error: error.message }]);
      setImportResult(null);
    },
  });

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files[0]) {
      handleFile(files[0]);
    }
  };

  const handleFile = async (file) => {
    if (!file.name.endsWith(".xlsx")) {
      setErrors([{ error: "Please upload a valid .xlsx file" }]);
      return;
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

    importMutation.mutate({
      filename: file.name,
      fileData: base64,
    });
  };

  const downloadCredentials = async () => {
    if (!importResult?.userCredentials) return;

    try {
      // Create credentials Excel locally
      const { generateCredentialsExcel } = await import("@/lib/excel-handler");
      const buffer = await generateCredentialsExcel(
        importResult.userCredentials
      );

      // Download
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `member_credentials_${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download error:", error);
      alert("Failed to download credentials file");
    }
  };

  return (
    <div>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Import Members</h1>
        <p className={styles.pageSubtitle}>
          Bulk import members from Excel file with automatic login credential
          generation
        </p>
      </div>

      {importResult?.success && (
        <div className={styles.contentCard}>
          <div
            style={{
              padding: "var(--spacing-lg)",
              backgroundColor: "#d1fae5",
              borderLeft: "4px solid #10b981",
              borderRadius: "var(--radius-md)",
              marginBottom: "var(--spacing-lg)",
            }}
          >
            <h3 style={{ margin: "0 0 var(--spacing-sm) 0", color: "#065f46" }}>
              ✓ Import Successful!
            </h3>
            <p
              style={{
                margin: 0,
                color: "#047857",
                fontSize: "var(--font-sm)",
              }}
            >
              {importResult.message}
            </p>
          </div>

          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Members Created</div>
              <h2 className={styles.statValue}>
                {importResult.createdMembers.length}
              </h2>
            </div>
            {importResult.errors?.length > 0 && (
              <div className={styles.statCard}>
                <div className={styles.statLabel}>Failed Imports</div>
                <h2
                  className={styles.statValue}
                  style={{ color: "var(--danger)" }}
                >
                  {importResult.errors.length}
                </h2>
              </div>
            )}
          </div>

          <div
            className={styles.contentCard}
            style={{ marginTop: "var(--spacing-lg)" }}
          >
            <div className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>
                Next Step: Distribute Credentials
              </h3>
            </div>
            <p
              style={{
                color: "var(--text-secondary)",
                marginBottom: "var(--spacing-lg)",
              }}
            >
              Download the credentials file below and distribute it to members.
              Each member has:
            </p>
            <ul
              style={{
                paddingLeft: "var(--spacing-lg)",
                marginBottom: "var(--spacing-lg)",
              }}
            >
              <li>✓ Unique email address</li>
              <li>✓ Auto-generated 6-digit password</li>
              <li>✓ Portal login instructions</li>
            </ul>

            <button
              onClick={downloadCredentials}
              className="btn btn-success"
              style={{ width: "100%", justifyContent: "center" }}
            >
              📥 Download Member Credentials (.xlsx)
            </button>
          </div>

          {importResult.createdMembers.length > 0 && (
            <div
              className={styles.contentCard}
              style={{ marginTop: "var(--spacing-lg)" }}
            >
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>Imported Members</h3>
              </div>
              <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                <table style={{ width: "100%" }}>
                  <thead>
                    <tr
                      style={{
                        backgroundColor: "var(--bg-tertiary)",
                        position: "sticky",
                        top: 0,
                      }}
                    >
                      <th
                        style={{
                          padding: "var(--spacing-md)",
                          textAlign: "left",
                        }}
                      >
                        Flat No
                      </th>
                      <th
                        style={{
                          padding: "var(--spacing-md)",
                          textAlign: "left",
                        }}
                      >
                        Owner Name
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResult.createdMembers.map((member) => (
                      <tr
                        key={member.id}
                        style={{ borderBottom: "1px solid var(--border)" }}
                      >
                        <td style={{ padding: "var(--spacing-md)" }}>
                          {member.wing}-{member.roomNo}
                        </td>
                        <td style={{ padding: "var(--spacing-md)" }}>
                          {member.ownerName}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {!importResult && (
        <div className={styles.contentCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Upload Member File</h2>
          </div>

          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={gridStyles.uploadZone}
            style={{
              backgroundColor: dragActive ? "#dbeafe" : "var(--bg-secondary)",
              borderColor: dragActive ? "var(--primary)" : "var(--border)",
              cursor: "pointer",
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className={gridStyles.uploadIcon}>📋</div>
            <div className={gridStyles.uploadText}>
              Drag & drop your Excel file here
            </div>
            <div className={gridStyles.uploadSubtext}>
              or click to select from your computer
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  handleFile(e.target.files[0]);
                }
              }}
              className={gridStyles.fileInput}
            />
          </div>

          <div style={{ marginTop: "var(--spacing-lg)" }}>
            <button
              onClick={() => {
                // Download template
                const link = document.createElement("a");
                link.href = "/api/members/template";
                link.download = "member_template.xlsx";
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
              className="btn btn-secondary"
            >
              📥 Download Template
            </button>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div
          className={gridStyles.errorList}
          style={{ marginTop: "var(--spacing-lg)" }}
        >
          <div className={gridStyles.errorListTitle}>❌ Errors Found</div>
          <ul className={gridStyles.errorListItems}>
            {errors.map((err, idx) => (
              <li key={idx} className={gridStyles.errorListItem}>
                {err.error || `Row ${err.row}: ${err.reason}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
