"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";
import gridStyles from "@/styles/BillingGrid.module.css";

export default function BillingGridPage() {
  const queryClient = useQueryClient();

  // State
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedWing, setSelectedWing] = useState("all");
  const [gridData, setGridData] = useState({});
  const [modifiedRows, setModifiedRows] = useState(new Set());
  const [customColumns, setCustomColumns] = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [previewMemberIndex, setPreviewMemberIndex] = useState(0);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);

  // Fetch data
  const { data: societyData } = useQuery({
    queryKey: ["society-config"],
    queryFn: () => apiClient.get("/api/society/config"),
  });

  const { data: membersData, isLoading } = useQuery({
    queryKey: ["members-list"],
    queryFn: () => apiClient.get("/api/members/list?limit=1000"),
  });

  const { data: templateData } = useQuery({
    queryKey: ["bill-template"],
    queryFn: () => apiClient.get("/api/billing/template"),
  });

  const society = societyData?.society;
  const members = membersData?.members || [];
  const billTemplate = templateData?.template;

  // Wings filter
  const wings = useMemo(() => {
    const uniqueWings = [
      ...new Set(members.map((m) => m.wing).filter(Boolean)),
    ];
    return uniqueWings.sort();
  }, [members]);

  // Filtered members
  const filteredMembers = useMemo(() => {
    return members
      .filter((member) => {
        const matchesSearch =
          member.roomNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
          member.ownerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (member.wing &&
            member.wing.toLowerCase().includes(searchTerm.toLowerCase()));
        const matchesWing =
          selectedWing === "all" || member.wing === selectedWing;
        return matchesSearch && matchesWing;
      })
      .sort((a, b) => {
        const wingCompare = (a.wing || "").localeCompare(b.wing || "");
        if (wingCompare !== 0) return wingCompare;
        return (parseInt(a.roomNo) || 0) - (parseInt(b.roomNo) || 0);
      });
  }, [members, searchTerm, selectedWing]);

  // Calculate row total
  const calculateRowTotal = useCallback(
    (memberId, member) => {
      const rowData = gridData[memberId] || {};

      // Base charges
      const maintenance =
        member.areaSqFt * (society?.config?.maintenanceRate || 2.5);
      const sinkingFund =
        member.areaSqFt * (society?.config?.sinkingFundRate || 0.5);
      const repairFund =
        member.areaSqFt * (society?.config?.repairFundRate || 0.5);
      const fixedCharges =
        (society?.config?.fixedCharges?.water || 0) +
        (society?.config?.fixedCharges?.security || 0) +
        (society?.config?.fixedCharges?.electricity || 0);

      // Custom columns
      const customTotal = customColumns.reduce((sum, col) => {
        return sum + (parseFloat(rowData[col.id]) || 0);
      }, 0);

      const subtotal =
        maintenance + sinkingFund + repairFund + fixedCharges + customTotal;
      const serviceTax =
        (subtotal * (society?.config?.serviceTaxRate || 0)) / 100;
      const total = Math.round((subtotal + serviceTax) * 100) / 100;

      return {
        maintenance,
        sinkingFund,
        repairFund,
        fixedCharges,
        customTotal,
        subtotal,
        serviceTax,
        total,
        breakdown: {
          Maintenance: maintenance,
          "Sinking Fund": sinkingFund,
          "Repair Fund": repairFund,
          "Fixed Charges": fixedCharges,
          ...customColumns.reduce((acc, col) => {
            acc[col.name] = parseFloat(rowData[col.id]) || 0;
            return acc;
          }, {}),
        },
      };
    },
    [gridData, society, customColumns]
  );

  // Add custom column
  const handleAddColumn = () => {
    const name = prompt("Enter column name:");
    if (name && name.trim()) {
      setCustomColumns([
        ...customColumns,
        {
          id: `custom_${Date.now()}`,
          name: name.trim(),
        },
      ]);
    }
  };

  // Edit column name
  const handleEditColumn = (colId) => {
    const col = customColumns.find((c) => c.id === colId);
    if (col) {
      const newName = prompt("Enter new column name:", col.name);
      if (newName && newName.trim()) {
        setCustomColumns(
          customColumns.map((c) =>
            c.id === colId ? { ...c, name: newName.trim() } : c
          )
        );
      }
    }
  };

  // Delete column
  const handleDeleteColumn = (colId) => {
    if (confirm("Delete this column?")) {
      setCustomColumns(customColumns.filter((c) => c.id !== colId));
      // Remove data for this column
      const newGridData = { ...gridData };
      Object.keys(newGridData).forEach((memberId) => {
        delete newGridData[memberId][colId];
      });
      setGridData(newGridData);
    }
  };

  // Cell change handler
  const handleCellChange = useCallback((memberId, colId, value) => {
    const numValue = parseFloat(value) || 0;
    setGridData((prev) => ({
      ...prev,
      [memberId]: {
        ...prev[memberId],
        [colId]: numValue,
      },
    }));
    setModifiedRows((prev) => new Set(prev).add(memberId));
  }, []);

  // Generate preview
  const handlePreview = () => {
    if (filteredMembers.length === 0) {
      alert("No members to preview");
      return;
    }
    setPreviewMemberIndex(0);
    setShowPreview(true);
  };

  // Generate bills mutation
  const generateBillsMutation = useMutation({
    mutationFn: (data) => apiClient.post("/api/billing/generate", data),
    onSuccess: (data) => {
      alert(`✅ Generated ${data.billsGenerated} bills!`);
      setShowPreview(false);
      setGridData({});
      setModifiedRows(new Set());
      queryClient.invalidateQueries(["generated-bills"]);
    },
    onError: (error) => {
      alert(`❌ Error: ${error.message}`);
    },
  });

  // Confirm generation
  const handleGenerate = () => {
    if (
      !confirm(
        `Generate bills for ${
          filteredMembers.length
        } members for ${year}-${String(month).padStart(2, "0")}?`
      )
    ) {
      return;
    }

    const billsData = filteredMembers.map((member) => {
      const calc = calculateRowTotal(member._id, member);
      return {
        memberId: member._id,
        breakdown: calc.breakdown,
        totalAmount: calc.total,
      };
    });

    generateBillsMutation.mutate({
      year,
      month,
      bills: billsData,
    });
  };

  // Render bill preview
  const renderBillPreview = () => {
    if (!billTemplate || filteredMembers.length === 0) return null;

    const member = filteredMembers[previewMemberIndex];
    const calc = calculateRowTotal(member._id, member);

    // Replace variables in template
    let html = billTemplate.html || "";

    const replacements = {
      "{{societyName}}": society?.name || "",
      "{{societyAddress}}": society?.address || "",
      "{{memberName}}": member.ownerName,
      "{{memberWing}}": member.wing || "",
      "{{memberRoomNo}}": member.roomNo,
      "{{memberArea}}": member.areaSqFt,
      "{{memberContact}}": member.contact || "",
      "{{billPeriod}}": `${year}-${String(month).padStart(2, "0")}`,
      "{{billDate}}": new Date().toLocaleDateString("en-IN"),
      "{{dueDate}}": new Date(year, month - 1, 10).toLocaleDateString("en-IN"),
      "{{totalAmount}}": `₹${calc.total.toLocaleString("en-IN")}`,
      "{{previousBalance}}": "₹0",
      "{{currentBalance}}": `₹${calc.total.toLocaleString("en-IN")}`,
    };

    Object.entries(replacements).forEach(([key, value]) => {
      html = html.replace(new RegExp(key, "g"), value);
    });

    // Insert billing table
    const tableHtml = `
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <thead>
          <tr style="background-color: #f3f4f6;">
            <th style="border: 1px solid #000; padding: 8px; text-align: left;">Sr.</th>
            <th style="border: 1px solid #000; padding: 8px; text-align: left;">Description</th>
            <th style="border: 1px solid #000; padding: 8px; text-align: right;">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(calc.breakdown)
            .map(
              ([desc, amt], idx) => `
            <tr>
              <td style="border: 1px solid #ddd; padding: 8px;">${idx + 1}</td>
              <td style="border: 1px solid #ddd; padding: 8px;">${desc}</td>
              <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">₹${amt.toFixed(
                2
              )}</td>
            </tr>
          `
            )
            .join("")}
          <tr style="font-weight: bold; background-color: #f9fafb;">
            <td colspan="2" style="border: 1px solid #000; padding: 8px; text-align: right;">TOTAL</td>
            <td style="border: 1px solid #000; padding: 8px; text-align: right;">₹${calc.total.toLocaleString(
              "en-IN"
            )}</td>
          </tr>
        </tbody>
      </table>
    `;

    html = html.replace("{{BILLING_TABLE}}", tableHtml);

    return html;
  };

  if (isLoading) {
    return (
      <div className={styles.pageHeader}>
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div>
      {/* PAGE HEADER */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>📊 Billing Grid</h1>
          <p className={styles.pageSubtitle}>
            Enter dynamic charges for {filteredMembers.length} members
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button onClick={handleAddColumn} className="btn btn-secondary">
            ➕ Add Column
          </button>
          <button onClick={handlePreview} className="btn btn-primary">
            👁️ Preview Bills
          </button>
        </div>
      </div>

      {/* FILTERS */}
      <div className={styles.contentCard} style={{ marginBottom: "1.5rem" }}>
        <div
          style={{
            padding: "1rem",
            display: "flex",
            gap: "1rem",
            alignItems: "center",
          }}
        >
          <input
            type="text"
            placeholder="🔍 Search by room, name, or wing..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input"
            style={{ flex: 1 }}
          />
          <select
            value={selectedWing}
            onChange={(e) => setSelectedWing(e.target.value)}
            className="input"
            style={{ width: "150px" }}
          >
            <option value="all">All Wings</option>
            {wings.map((wing) => (
              <option key={wing} value={wing}>
                Wing {wing}
              </option>
            ))}
          </select>
          <span
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#DBEAFE",
              borderRadius: "8px",
              fontWeight: "600",
              color: "#1E40AF",
            }}
          >
            {filteredMembers.length} MEMBERS
          </span>
        </div>
      </div>

      {/* BILLING TABLE */}
      <div className={styles.contentCard}>
        <div style={{ overflowX: "auto" }}>
          <table className={gridStyles.billingTable}>
            <thead>
              <tr>
                <th>Wing</th>
                <th>Room</th>
                <th>Owner</th>
                <th>Area (sq.ft)</th>
                <th>Maintenance</th>
                <th>Sinking</th>
                <th>Repair</th>
                <th>Fixed</th>
                {customColumns.map((col) => (
                  <th key={col.id}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>{col.name}</span>
                      <div style={{ display: "flex", gap: "0.25rem" }}>
                        <button
                          onClick={() => handleEditColumn(col.id)}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontSize: "0.875rem",
                          }}
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => handleDeleteColumn(col.id)}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontSize: "0.875rem",
                            color: "#DC2626",
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </th>
                ))}
                <th>Subtotal</th>
                <th>Tax</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.map((member) => {
                const calc = calculateRowTotal(member._id, member);
                const isModified = modifiedRows.has(member._id);

                return (
                  <tr
                    key={member._id}
                    style={{
                      backgroundColor: isModified ? "#FEF3C7" : "transparent",
                    }}
                  >
                    <td>{member.wing || "-"}</td>
                    <td>
                      <strong>{member.roomNo}</strong>
                    </td>
                    <td>{member.ownerName}</td>
                    <td>{member.areaSqFt}</td>
                    <td>₹{calc.maintenance.toFixed(2)}</td>
                    <td>₹{calc.sinkingFund.toFixed(2)}</td>
                    <td>₹{calc.repairFund.toFixed(2)}</td>
                    <td>₹{calc.fixedCharges.toFixed(2)}</td>
                    {customColumns.map((col) => (
                      <td key={col.id}>
                        <input
                          type="number"
                          value={gridData[member._id]?.[col.id] || ""}
                          onChange={(e) =>
                            handleCellChange(member._id, col.id, e.target.value)
                          }
                          className={gridStyles.cellInput}
                          placeholder="0"
                          style={{ width: "100px" }}
                        />
                      </td>
                    ))}
                    <td>₹{calc.subtotal.toFixed(2)}</td>
                    <td>₹{calc.serviceTax.toFixed(2)}</td>
                    <td>
                      <strong style={{ color: "#DC2626" }}>
                        ₹{calc.total.toFixed(2)}
                      </strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* PREVIEW OVERLAY */}
      {showPreview && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.8)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
          }}
          onClick={() => setShowPreview(false)}
        >
          <div
            style={{
              backgroundColor: "white",
              borderRadius: "12px",
              maxWidth: "900px",
              width: "100%",
              maxHeight: "90vh",
              overflow: "auto",
              position: "relative",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                padding: "1.5rem",
                borderBottom: "2px solid #E5E7EB",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                position: "sticky",
                top: 0,
                backgroundColor: "white",
                zIndex: 1,
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: "1.5rem" }}>
                  Bill Preview: {year}-{String(month).padStart(2, "0")}
                </h2>
                <p style={{ margin: "0.5rem 0 0 0", color: "#6B7280" }}>
                  Member {previewMemberIndex + 1} of {filteredMembers.length}
                </p>
              </div>
              <button
                onClick={() => setShowPreview(false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "2rem",
                  cursor: "pointer",
                  color: "#9CA3AF",
                }}
              >
                ✕
              </button>
            </div>

            {/* Bill Content */}
            <div
              style={{ padding: "2rem" }}
              dangerouslySetInnerHTML={{ __html: renderBillPreview() }}
            />

            {/* Footer Navigation */}
            <div
              style={{
                padding: "1.5rem",
                borderTop: "2px solid #E5E7EB",
                display: "flex",
                gap: "1rem",
                position: "sticky",
                bottom: 0,
                backgroundColor: "white",
              }}
            >
              <button
                onClick={() =>
                  setPreviewMemberIndex(Math.max(0, previewMemberIndex - 1))
                }
                disabled={previewMemberIndex === 0}
                className="btn btn-secondary"
              >
                ← Previous
              </button>
              <button
                onClick={() =>
                  setPreviewMemberIndex(
                    Math.min(filteredMembers.length - 1, previewMemberIndex + 1)
                  )
                }
                disabled={previewMemberIndex === filteredMembers.length - 1}
                className="btn btn-secondary"
              >
                Next →
              </button>
              <div style={{ flex: 1 }}></div>
              <button
                onClick={() => setShowPreview(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={generateBillsMutation.isPending}
                className="btn btn-success"
                style={{ minWidth: "200px" }}
              >
                {generateBillsMutation.isPending ? (
                  <>
                    <span className="loading-spinner"></span> Generating...
                  </>
                ) : (
                  `✅ Generate ${filteredMembers.length} Bills`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
