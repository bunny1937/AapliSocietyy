"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";
import gridStyles from "@/styles/BillingGrid.module.css";

export default function BillingGridPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedWing, setSelectedWing] = useState("all");
  const [gridData, setGridData] = useState({});
  const [modifiedRows, setModifiedRows] = useState(new Set());
  const debounceTimers = useRef({});

  const { data: societyData } = useQuery({
    queryKey: ["society-config"],
    queryFn: () => apiClient.get("/api/society/config"),
  });

  const { data: membersData, isLoading } = useQuery({
    queryKey: ["members-list"],
    queryFn: () => apiClient.get("/api/members/list?limit=1000"),
  });

  const society = societyData?.society;
  const members = membersData?.members || [];
  const billingHeads = society?.billingHeads || [];

  const wings = useMemo(() => {
    const uniqueWings = [
      ...new Set(members.map((m) => m.wing).filter(Boolean)),
    ];
    return uniqueWings.sort();
  }, [members]);

  const filteredMembers = useMemo(() => {
    return members.filter((member) => {
      const matchesSearch =
        member.roomNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        member.ownerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (member.wing &&
          member.wing.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesWing =
        selectedWing === "all" || member.wing === selectedWing;

      return matchesSearch && matchesWing;
    });
  }, [members, searchTerm, selectedWing]);

  const handleCellChange = useCallback((memberId, headId, value) => {
    const numValue = parseFloat(value) || 0;

    setGridData((prev) => ({
      ...prev,
      [memberId]: {
        ...prev[memberId],
        [headId]: numValue,
      },
    }));

    setModifiedRows((prev) => new Set(prev).add(memberId));

    if (debounceTimers.current[memberId]) {
      clearTimeout(debounceTimers.current[memberId]);
    }

    debounceTimers.current[memberId] = setTimeout(() => {
      console.log(`Auto-saved data for member ${memberId}`);
    }, 1000);
  }, []);

  const calculateRowTotal = useCallback(
    (memberId, member) => {
      const rowData = gridData[memberId] || {};

      const dynamicTotal = Object.values(rowData).reduce(
        (sum, val) => sum + (parseFloat(val) || 0),
        0
      );

      const maintenance =
        member.areaSqFt * (society?.config?.maintenanceRate || 0);
      const sinkingFund =
        member.areaSqFt * (society?.config?.sinkingFundRate || 0);
      const repairFund =
        member.areaSqFt * (society?.config?.repairFundRate || 0);
      const fixedCharges =
        (society?.config?.fixedCharges?.water || 0) +
        (society?.config?.fixedCharges?.security || 0) +
        (society?.config?.fixedCharges?.electricity || 0);

      const subtotal =
        maintenance + sinkingFund + repairFund + fixedCharges + dynamicTotal;
      const serviceTax =
        (subtotal * (society?.config?.serviceTaxRate || 0)) / 100;

      return {
        maintenance,
        sinkingFund,
        repairFund,
        fixedCharges,
        dynamicTotal,
        subtotal,
        serviceTax,
        total: Math.round((subtotal + serviceTax) * 100) / 100,
      };
    },
    [gridData, society]
  );

  const handleExportData = () => {
    const exportData = {};

    filteredMembers.forEach((member) => {
      const memberKey = `${member.wing || "NoWing"}-${member.roomNo}`;
      const rowData = gridData[member._id] || {};

      exportData[memberKey] = {};
      billingHeads.forEach((head) => {
        exportData[memberKey][head.label] = rowData[head.id] || 0;
      });
    });

    console.log("Export data:", exportData);
    alert("Export functionality: Data prepared for bill generation");
  };

  const handleClearAll = () => {
    if (confirm("Are you sure you want to clear all entered data?")) {
      setGridData({});
      setModifiedRows(new Set());
    }
  };

  const totalModified = modifiedRows.size;
  const totalAmount = filteredMembers.reduce((sum, member) => {
    const calc = calculateRowTotal(member._id, member);
    return sum + calc.total;
  }, 0);

  if (isLoading) {
    return (
      <div
        style={{ display: "flex", justifyContent: "center", padding: "40px" }}
      >
        <div className="loading-spinner"></div>
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div>
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Billing Grid</h1>
          <p className={styles.pageSubtitle}>
            Dynamic data entry for monthly billing
          </p>
        </div>
        <div className={styles.contentCard}>
          <div className={gridStyles.emptyState}>
            <div className={gridStyles.emptyStateIcon}>📋</div>
            <div className={gridStyles.emptyStateText}>
              No members found. Please import members first.
            </div>
            <button
              className="btn btn-primary"
              onClick={() =>
                (window.location.href = "/dashboard/import-members")
              }
            >
              Import Members
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (billingHeads.length === 0) {
    return (
      <div>
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Billing Grid</h1>
          <p className={styles.pageSubtitle}>
            Dynamic data entry for monthly billing
          </p>
        </div>
        <div className={styles.contentCard}>
          <div className={gridStyles.emptyState}>
            <div className={gridStyles.emptyStateIcon}>⚙️</div>
            <div className={gridStyles.emptyStateText}>
              Matrix configuration not found. Please configure billing heads
              first.
            </div>
            <button
              className="btn btn-primary"
              onClick={() =>
                (window.location.href = "/dashboard/matrix-config")
              }
            >
              Configure Matrix
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Billing Grid</h1>
        <p className={styles.pageSubtitle}>
          Enter dynamic charges for {filteredMembers.length} members
        </p>
      </div>

      <div className={gridStyles.gridContainer}>
        <div className={gridStyles.gridToolbar}>
          <div className={gridStyles.gridToolbarLeft}>
            <input
              type="text"
              placeholder="Search by room, name, or wing..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`input ${gridStyles.searchInput}`}
            />

            <select
              value={selectedWing}
              onChange={(e) => setSelectedWing(e.target.value)}
              className={gridStyles.filterSelect}
            >
              <option value="all">All Wings</option>
              {wings.map((wing) => (
                <option key={wing} value={wing}>
                  {wing}
                </option>
              ))}
            </select>

            <span className="badge badge-info">
              {filteredMembers.length} members
            </span>
          </div>

          <div className={gridStyles.gridToolbarRight}>
            <button
              onClick={handleClearAll}
              className="btn btn-secondary"
              disabled={totalModified === 0}
            >
              🗑️ Clear All
            </button>
            <button
              onClick={handleExportData}
              className="btn btn-primary"
              disabled={totalModified === 0}
            >
              📊 Save & Proceed ({totalModified})
            </button>
          </div>
        </div>

        <div className={gridStyles.gridWrapper}>
          <table className={gridStyles.gridTable}>
            <thead className={gridStyles.gridHeader}>
              <tr>
                <th
                  className={`${gridStyles.gridHeaderCell} ${gridStyles.sticky}`}
                >
                  Wing
                </th>
                <th
                  className={`${gridStyles.gridHeaderCell} ${gridStyles.stickySecond}`}
                >
                  Room
                </th>
                <th
                  className={`${gridStyles.gridHeaderCell} ${gridStyles.stickyThird}`}
                >
                  Owner
                </th>
                <th className={gridStyles.gridHeaderCell}>Area (sq.ft)</th>
                <th className={gridStyles.gridHeaderCell}>Maintenance</th>
                <th className={gridStyles.gridHeaderCell}>Sinking</th>
                <th className={gridStyles.gridHeaderCell}>Repair</th>
                <th className={gridStyles.gridHeaderCell}>Fixed</th>
                {billingHeads.map((head) => (
                  <th key={head.id} className={gridStyles.gridHeaderCell}>
                    {head.label}
                  </th>
                ))}
                <th className={gridStyles.gridHeaderCell}>Subtotal</th>
                <th className={gridStyles.gridHeaderCell}>Tax</th>
                <th className={gridStyles.gridHeaderCell}>Total</th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.map((member) => {
                const calc = calculateRowTotal(member._id, member);
                const isModified = modifiedRows.has(member._id);

                return (
                  <tr
                    key={member._id}
                    className={`${gridStyles.gridRow} ${
                      isModified ? gridStyles.modified : ""
                    }`}
                  >
                    <td
                      className={`${gridStyles.gridCell} ${gridStyles.sticky}`}
                    >
                      {member.wing || "-"}
                    </td>
                    <td
                      className={`${gridStyles.gridCell} ${gridStyles.stickySecond}`}
                    >
                      <strong>{member.roomNo}</strong>
                    </td>
                    <td
                      className={`${gridStyles.gridCell} ${gridStyles.stickyThird}`}
                    >
                      {member.ownerName}
                    </td>
                    <td className={gridStyles.gridCell}>{member.areaSqFt}</td>
                    <td
                      className={`${gridStyles.gridCell} ${gridStyles.cellReadonly}`}
                    >
                      ₹{calc.maintenance.toFixed(2)}
                    </td>
                    <td
                      className={`${gridStyles.gridCell} ${gridStyles.cellReadonly}`}
                    >
                      ₹{calc.sinkingFund.toFixed(2)}
                    </td>
                    <td
                      className={`${gridStyles.gridCell} ${gridStyles.cellReadonly}`}
                    >
                      ₹{calc.repairFund.toFixed(2)}
                    </td>
                    <td
                      className={`${gridStyles.gridCell} ${gridStyles.cellReadonly}`}
                    >
                      ₹{calc.fixedCharges.toFixed(2)}
                    </td>
                    {billingHeads.map((head) => (
                      <td key={head.id} className={gridStyles.gridCell}>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={gridData[member._id]?.[head.id] || ""}
                          onChange={(e) =>
                            handleCellChange(
                              member._id,
                              head.id,
                              e.target.value
                            )
                          }
                          className={gridStyles.cellInput}
                          placeholder="0"
                        />
                      </td>
                    ))}
                    <td
                      className={`${gridStyles.gridCell} ${gridStyles.cellCalculated}`}
                    >
                      ₹{calc.subtotal.toFixed(2)}
                    </td>
                    <td
                      className={`${gridStyles.gridCell} ${gridStyles.cellCalculated}`}
                    >
                      ₹{calc.serviceTax.toFixed(2)}
                    </td>
                    <td
                      className={`${gridStyles.gridCell} ${gridStyles.cellCalculated}`}
                    >
                      <strong>₹{calc.total.toFixed(2)}</strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={gridStyles.gridFooter}>
          <div className={gridStyles.gridSummary}>
            <div className={gridStyles.gridSummaryItem}>
              <span className={gridStyles.gridSummaryLabel}>
                Total Members:
              </span>
              <span className={gridStyles.gridSummaryValue}>
                {filteredMembers.length}
              </span>
            </div>
            <div className={gridStyles.gridSummaryItem}>
              <span className={gridStyles.gridSummaryLabel}>Modified:</span>
              <span className={gridStyles.gridSummaryValue}>
                {totalModified}
              </span>
            </div>
            <div className={gridStyles.gridSummaryItem}>
              <span className={gridStyles.gridSummaryLabel}>Total Amount:</span>
              <span className={gridStyles.gridSummaryValue}>
                ₹{totalAmount.toLocaleString()}
              </span>
            </div>
          </div>

          <div className={gridStyles.gridActions}>
            <button className="btn btn-success" disabled={totalModified === 0}>
              ✓ Generate Bills
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
