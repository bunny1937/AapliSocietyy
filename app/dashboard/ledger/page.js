"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";
import ledgerStyles from "@/styles/Ledger.module.css";
import Select from "react-select";

export default function UltraAdvancedLedgerPage() {
  const queryClient = useQueryClient();

  // ========== STATE MANAGEMENT ==========
  const [filters, setFilters] = useState({
    memberId: "all",
    category: "all",
    type: "all",
    month: "",
    year: "",
    paymentMode: "all",
    wing: "all",
    startDate: "",
    endDate: "",
    minAmount: "",
    maxAmount: "",
    balanceStatus: "all",
  });

  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [groupBy, setGroupBy] = useState("");
  const [sortBy, setSortBy] = useState("date");
  const [sortOrder, setSortOrder] = useState("desc");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(100);
  const [savedViews, setSavedViews] = useState([]);
  const [newViewName, setNewViewName] = useState("");
  const [showColumnToggle, setShowColumnToggle] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState({
    date: true,
    txnId: true,
    member: true,
    category: true,
    description: true,
    paymentMode: true,
    debit: true,
    credit: true,
    balance: true,
    recordedBy: true,
    billPeriod: true,
    financialYear: false,
  });

  // ========== DATA FETCHING ==========
  const { data: membersData } = useQuery({
    queryKey: ["members"],
    queryFn: () => apiClient.get("/api/members/list?limit=1000"),
  });

  const buildQueryString = () => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== "all") {
        params.append(key, value);
      }
    });
    if (sortBy) params.append("sortBy", sortBy);
    if (sortOrder) params.append("sortOrder", sortOrder);
    if (groupBy) params.append("groupBy", groupBy);
    params.append("page", page);
    params.append("limit", limit);
    return params.toString();
  };

  const {
    data: ledgerData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["ledger", filters, sortBy, sortOrder, groupBy, page, limit],
    queryFn: () => apiClient.get(`/api/ledger/fetch?${buildQueryString()}`),
  });

  // ========== ANALYTICS CALCULATIONS ==========
  const analytics = {
    totalTransactions: ledgerData?.transactions?.length || 0,
    totalDebit: ledgerData?.summary?.totalDebit || 0,
    totalCredit: ledgerData?.summary?.totalCredit || 0,
    netBalance: ledgerData?.summary?.netBalance || 0,
    openingBalance: ledgerData?.summary?.openingBalance || 0,
  };

  // Interest-specific analytics
  const interestAnalytics = {
    totalInterest: 0,
    interestCount: 0,
    avgInterest: 0,
    maxInterest: 0,
    minInterest: 0,
    interestByMonth: {},
    topInterestPayers: [],
    interestTrend: [],
  };

  if (ledgerData?.transactions) {
    const interestTransactions = ledgerData.transactions.filter(
      (t) => t.category === "Interest"
    );

    interestAnalytics.totalInterest = interestTransactions.reduce(
      (sum, t) => sum + t.amount,
      0
    );
    interestAnalytics.interestCount = interestTransactions.length;

    if (interestTransactions.length > 0) {
      interestAnalytics.avgInterest =
        interestAnalytics.totalInterest / interestTransactions.length;
      interestAnalytics.maxInterest = Math.max(
        ...interestTransactions.map((t) => t.amount)
      );
      interestAnalytics.minInterest = Math.min(
        ...interestTransactions.map((t) => t.amount)
      );

      // Group by month
      interestTransactions.forEach((t) => {
        const date = new Date(t.date);
        const monthKey = `${date.getFullYear()}-${String(
          date.getMonth() + 1
        ).padStart(2, "0")}`;
        if (!interestAnalytics.interestByMonth[monthKey]) {
          interestAnalytics.interestByMonth[monthKey] = {
            count: 0,
            total: 0,
          };
        }
        interestAnalytics.interestByMonth[monthKey].count += 1;
        interestAnalytics.interestByMonth[monthKey].total += t.amount;
      });

      // Top interest payers
      const interestByMember = {};
      interestTransactions.forEach((t) => {
        const key = t.memberId?._id || "Unknown";
        if (!interestByMember[key]) {
          interestByMember[key] = {
            member: t.memberId,
            totalInterest: 0,
            count: 0,
            transactions: [],
          };
        }
        interestByMember[key].totalInterest += t.amount;
        interestByMember[key].count += 1;
        interestByMember[key].transactions.push(t);
      });

      interestAnalytics.topInterestPayers = Object.values(interestByMember)
        .sort((a, b) => b.totalInterest - a.totalInterest)
        .slice(0, 10);

      // Interest trend (last 6 months)
      const months = Object.keys(interestAnalytics.interestByMonth)
        .sort()
        .slice(-6);
      interestAnalytics.interestTrend = months.map((month) => ({
        month,
        ...interestAnalytics.interestByMonth[month],
      }));
    }
  }

  // Payment analytics
  const paymentAnalytics = {
    cashPayments: 0,
    onlinePayments: 0,
    chequePayments: 0,
    upiPayments: 0,
    totalPayments: 0,
  };

  if (ledgerData?.transactions) {
    const payments = ledgerData.transactions.filter(
      (t) => t.category === "Payment"
    );
    paymentAnalytics.totalPayments = payments.reduce(
      (sum, t) => sum + t.amount,
      0
    );
    payments.forEach((t) => {
      switch (t.paymentMode) {
        case "Cash":
          paymentAnalytics.cashPayments += t.amount;
          break;
        case "Online":
          paymentAnalytics.onlinePayments += t.amount;
          break;
        case "Cheque":
          paymentAnalytics.chequePayments += t.amount;
          break;
        case "UPI":
          paymentAnalytics.upiPayments += t.amount;
          break;
      }
    });
  }

  // ========== HANDLERS ==========
  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1); // Reset to first page
  };

  const resetFilters = () => {
    setFilters({
      memberId: "all",
      category: "all",
      type: "all",
      month: "",
      year: "",
      paymentMode: "all",
      wing: "all",
      startDate: "",
      endDate: "",
      minAmount: "",
      maxAmount: "",
      balanceStatus: "all",
    });
    setSearchTerm("");
    setPage(1);
  };

  const fetchTransactionDetails = async (transactionId) => {
    try {
      const data = await apiClient.get(
        `/api/ledger/transaction/${transactionId}`
      );
      setSelectedTransaction(data);
      setShowDetailModal(true);
    } catch (error) {
      console.error("Transaction detail error:", error);
      alert("Failed to fetch transaction details");
    }
  };

  const exportData = (format) => {
    const queryString = buildQueryString();
    window.open(`/api/ledger/export?${queryString}&format=${format}`, "_blank");
  };

  const saveCurrentView = () => {
    if (!newViewName.trim()) {
      alert("Please enter a view name");
      return;
    }
    const view = {
      name: newViewName,
      filters: { ...filters },
      sortBy,
      sortOrder,
      groupBy,
      visibleColumns: { ...visibleColumns },
    };
    setSavedViews([...savedViews, view]);
    setNewViewName("");
    alert(`View "${newViewName}" saved!`);
  };

  const loadSavedView = (view) => {
    setFilters(view.filters);
    setSortBy(view.sortBy);
    setSortOrder(view.sortOrder);
    setGroupBy(view.groupBy);
    setVisibleColumns(view.visibleColumns);
    setPage(1);
  };

  const deleteSavedView = (index) => {
    const newViews = savedViews.filter((_, i) => i !== index);
    setSavedViews(newViews);
  };

  const toggleColumn = (column) => {
    setVisibleColumns((prev) => ({ ...prev, [column]: !prev[column] }));
  };

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
  };

  // Filter transactions by search term
  const filteredTransactions = ledgerData?.transactions?.filter((txn) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      txn.transactionId?.toLowerCase().includes(search) ||
      txn.description?.toLowerCase().includes(search) ||
      txn.memberId?.ownerName?.toLowerCase().includes(search) ||
      txn.memberId?.roomNo?.toString().includes(search) ||
      txn.category?.toLowerCase().includes(search)
    );
  });

  // ========== MEMBER OPTIONS FOR SELECT ==========
  const memberOptions = [
    { value: "all", label: "All Members" },
    ...(membersData?.members || [])
      .sort((a, b) => {
        const wingCompare = (a.wing || "").localeCompare(b.wing || "");
        if (wingCompare !== 0) return wingCompare;
        return (parseInt(a.roomNo) || 0) - (parseInt(b.roomNo) || 0);
      })
      .map((member) => ({
        value: member._id,
        label: `${member.wing || ""}-${member.roomNo} | ${member.ownerName}`,
        member,
      })),
  ];

  // ========== RENDER ==========
  return (
    <div>
      {/* ========== PAGE HEADER ========== */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>📊 Ultra-Advanced Ledger System</h1>
          <p className={styles.pageSubtitle}>
            Complete transaction analytics with real-time interest tracking &
            drill-down capabilities
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button
            onClick={() => exportData("xlsx")}
            className="btn btn-secondary"
            style={{ fontSize: "0.875rem" }}
          >
            📥 Export Excel
          </button>
          <button
            onClick={() => exportData("pdf")}
            className="btn btn-secondary"
            style={{ fontSize: "0.875rem" }}
          >
            📄 Export PDF
          </button>
          <button
            onClick={() => refetch()}
            className="btn btn-primary"
            style={{ fontSize: "0.875rem" }}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* ========== ANALYTICS DASHBOARD ========== */}
      <div className={ledgerStyles.summaryBar}>
        <div
          className={ledgerStyles.summaryCard}
          style={{ borderLeftColor: "#3B82F6" }}
        >
          <h3>Total Transactions</h3>
          <div className={ledgerStyles.summaryValue}>
            {analytics.totalTransactions}
          </div>
          <div className={ledgerStyles.summaryBadge}>
            Debit:{" "}
            {ledgerData?.transactions?.filter((t) => t.type === "Debit")
              .length || 0}{" "}
            | Credit:{" "}
            {ledgerData?.transactions?.filter((t) => t.type === "Credit")
              .length || 0}
          </div>
        </div>

        <div
          className={ledgerStyles.summaryCard}
          style={{ borderLeftColor: "#DC2626" }}
        >
          <h3>Total Debit</h3>
          <div className={ledgerStyles.summaryValue}>
            ₹{analytics.totalDebit.toLocaleString("en-IN")}
          </div>
          <div className={ledgerStyles.summaryBadge}>Money owed by members</div>
        </div>

        <div
          className={ledgerStyles.summaryCard}
          style={{ borderLeftColor: "#10B981" }}
        >
          <h3>Total Credit</h3>
          <div className={ledgerStyles.summaryValue}>
            ₹{analytics.totalCredit.toLocaleString("en-IN")}
          </div>
          <div className={ledgerStyles.summaryBadge}>Payments received</div>
        </div>

        <div
          className={ledgerStyles.summaryCard}
          style={{
            borderLeftColor: analytics.netBalance < 0 ? "#DC2626" : "#10B981",
          }}
        >
          <h3>Net Balance</h3>
          <div
            className={`${ledgerStyles.summaryValue} ${
              analytics.netBalance < 0
                ? ledgerStyles.balancePositive
                : ledgerStyles.balanceNegative
            }`}
          >
            ₹{Math.abs(analytics.netBalance).toLocaleString("en-IN")}
            <span style={{ fontSize: "1rem", marginLeft: "0.5rem" }}>
              {analytics.netBalance < 0 ? "DR" : "CR"}
            </span>
          </div>
          <div className={ledgerStyles.summaryBadge}>
            {analytics.netBalance < 0 ? "Outstanding dues" : "Credit balance"}
          </div>
        </div>
      </div>

      {/* ========== INTEREST ANALYTICS ========== */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: "1.5rem",
          marginBottom: "1.5rem",
        }}
      >
        {/* Interest Summary Cards */}
        <div className={styles.contentCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>💸 Interest Analytics</h2>
          </div>
          <div style={{ padding: "1.5rem" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "1rem",
              }}
            >
              <div
                style={{
                  padding: "1.25rem",
                  backgroundColor: "#FEF3C7",
                  borderRadius: "8px",
                  borderLeft: "4px solid #F59E0B",
                }}
              >
                <div
                  style={{
                    fontSize: "0.875rem",
                    color: "#92400E",
                    fontWeight: "600",
                  }}
                >
                  Total Interest Charged
                </div>
                <div
                  style={{
                    fontSize: "1.75rem",
                    fontWeight: "bold",
                    color: "#DC2626",
                    marginTop: "0.5rem",
                  }}
                >
                  ₹{interestAnalytics.totalInterest.toLocaleString("en-IN")}
                </div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#92400E",
                    marginTop: "0.25rem",
                  }}
                >
                  {interestAnalytics.interestCount} transactions
                </div>
              </div>

              <div
                style={{
                  padding: "1.25rem",
                  backgroundColor: "#FEE2E2",
                  borderRadius: "8px",
                  borderLeft: "4px solid #DC2626",
                }}
              >
                <div
                  style={{
                    fontSize: "0.875rem",
                    color: "#991B1B",
                    fontWeight: "600",
                  }}
                >
                  Average Interest
                </div>
                <div
                  style={{
                    fontSize: "1.75rem",
                    fontWeight: "bold",
                    color: "#DC2626",
                    marginTop: "0.5rem",
                  }}
                >
                  ₹
                  {Math.round(interestAnalytics.avgInterest).toLocaleString(
                    "en-IN"
                  )}
                </div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#991B1B",
                    marginTop: "0.25rem",
                  }}
                >
                  per transaction
                </div>
              </div>

              <div
                style={{
                  padding: "1.25rem",
                  backgroundColor: "#DBEAFE",
                  borderRadius: "8px",
                  borderLeft: "4px solid #3B82F6",
                }}
              >
                <div
                  style={{
                    fontSize: "0.875rem",
                    color: "#1E40AF",
                    fontWeight: "600",
                  }}
                >
                  Max Single Interest
                </div>
                <div
                  style={{
                    fontSize: "1.75rem",
                    fontWeight: "bold",
                    color: "#1E40AF",
                    marginTop: "0.5rem",
                  }}
                >
                  ₹{interestAnalytics.maxInterest.toLocaleString("en-IN")}
                </div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#1E40AF",
                    marginTop: "0.25rem",
                  }}
                >
                  highest charge
                </div>
              </div>
            </div>

            {/* Interest Trend Chart */}
            {interestAnalytics.interestTrend.length > 0 && (
              <div style={{ marginTop: "1.5rem" }}>
                <h4
                  style={{
                    margin: "0 0 1rem 0",
                    color: "#374151",
                    fontSize: "1rem",
                  }}
                >
                  📈 Interest Trend (Last 6 Months)
                </h4>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    gap: "1rem",
                    height: "150px",
                  }}
                >
                  {interestAnalytics.interestTrend.map((item, idx) => {
                    const maxValue = Math.max(
                      ...interestAnalytics.interestTrend.map((i) => i.total)
                    );
                    const heightPercent = (item.total / maxValue) * 100;
                    return (
                      <div
                        key={idx}
                        style={{
                          flex: 1,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                        }}
                      >
                        <div
                          style={{
                            width: "100%",
                            height: `${heightPercent}%`,
                            backgroundColor: "#F59E0B",
                            borderRadius: "4px 4px 0 0",
                            display: "flex",
                            alignItems: "flex-end",
                            justifyContent: "center",
                            paddingBottom: "0.5rem",
                            color: "white",
                            fontSize: "0.75rem",
                            fontWeight: "600",
                            minHeight: "30px",
                          }}
                        >
                          ₹{Math.round(item.total).toLocaleString("en-IN")}
                        </div>
                        <div
                          style={{
                            fontSize: "0.75rem",
                            color: "#6B7280",
                            marginTop: "0.5rem",
                            textAlign: "center",
                          }}
                        >
                          {item.month.split("-")[1]}/
                          {item.month.split("-")[0].slice(2)}
                          <br />
                          <span style={{ fontSize: "0.625rem" }}>
                            ({item.count} txns)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Payment Mode Distribution */}
        <div className={styles.contentCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>💳 Payment Distribution</h2>
          </div>
          <div style={{ padding: "1.5rem" }}>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
            >
              {[
                {
                  mode: "Cash",
                  amount: paymentAnalytics.cashPayments,
                  color: "#10B981",
                  icon: "💵",
                },
                {
                  mode: "Online",
                  amount: paymentAnalytics.onlinePayments,
                  color: "#3B82F6",
                  icon: "🌐",
                },
                {
                  mode: "UPI",
                  amount: paymentAnalytics.upiPayments,
                  color: "#8B5CF6",
                  icon: "📱",
                },
                {
                  mode: "Cheque",
                  amount: paymentAnalytics.chequePayments,
                  color: "#F59E0B",
                  icon: "📝",
                },
              ].map((item, idx) => {
                const percent =
                  paymentAnalytics.totalPayments > 0
                    ? (item.amount / paymentAnalytics.totalPayments) * 100
                    : 0;
                return (
                  <div key={idx}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: "0.5rem",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.875rem",
                          fontWeight: "600",
                          color: "#374151",
                        }}
                      >
                        {item.icon} {item.mode}
                      </span>
                      <span
                        style={{
                          fontSize: "0.875rem",
                          fontWeight: "700",
                          color: item.color,
                        }}
                      >
                        ₹{item.amount.toLocaleString("en-IN")}
                      </span>
                    </div>
                    <div
                      style={{
                        height: "8px",
                        backgroundColor: "#E5E7EB",
                        borderRadius: "4px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${percent}%`,
                          height: "100%",
                          backgroundColor: item.color,
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "#6B7280",
                        marginTop: "0.25rem",
                      }}
                    >
                      {percent.toFixed(1)}% of total payments
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ========== TOP INTEREST PAYERS ========== */}
      {interestAnalytics.topInterestPayers.length > 0 && (
        <div className={styles.contentCard} style={{ marginBottom: "1.5rem" }}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>🔥 Top 10 Interest Payers</h2>
          </div>
          <div style={{ padding: "1rem" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: "1rem",
              }}
            >
              {interestAnalytics.topInterestPayers.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "1rem",
                    backgroundColor: idx === 0 ? "#FEE2E2" : "#FEF3C7",
                    borderLeft: `4px solid ${
                      idx === 0 ? "#DC2626" : "#F59E0B"
                    }`,
                    borderRadius: "8px",
                    cursor: "pointer",
                    transition: "transform 0.2s, box-shadow 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-4px)";
                    e.currentTarget.style.boxShadow =
                      "0 8px 16px rgba(0,0,0,0.15)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                  onClick={() =>
                    handleFilterChange("memberId", item.member?._id)
                  }
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: "1.5rem",
                          fontWeight: "bold",
                          color: idx === 0 ? "#DC2626" : "#F59E0B",
                        }}
                      >
                        #{idx + 1}
                      </div>
                      <div
                        style={{
                          fontSize: "0.875rem",
                          color: "#92400E",
                          fontWeight: "600",
                          marginTop: "0.25rem",
                        }}
                      >
                        {item.member?.wing}-{item.member?.roomNo}
                      </div>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "#6B7280",
                          marginTop: "0.125rem",
                        }}
                      >
                        {item.member?.ownerName}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div
                        style={{
                          fontSize: "1.5rem",
                          fontWeight: "bold",
                          color: "#DC2626",
                        }}
                      >
                        ₹{item.totalInterest.toLocaleString("en-IN")}
                      </div>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "#92400E",
                          marginTop: "0.25rem",
                        }}
                      >
                        {item.count} charges
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: "0.75rem",
                      paddingTop: "0.75rem",
                      borderTop: "1px solid rgba(0,0,0,0.1)",
                      fontSize: "0.75rem",
                      color: "#6B7280",
                    }}
                  >
                    Avg: ₹
                    {Math.round(item.totalInterest / item.count).toLocaleString(
                      "en-IN"
                    )}{" "}
                    per charge
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========== SAVED VIEWS ========== */}
      {savedViews.length > 0 && (
        <div className={ledgerStyles.savedViewsPanel}>
          <h3>💾 Saved Views</h3>
          <div className={ledgerStyles.savedViewsList}>
            {savedViews.map((view, idx) => (
              <div key={idx} className={ledgerStyles.savedViewItem}>
                <span onClick={() => loadSavedView(view)}>{view.name}</span>
                <button onClick={() => deleteSavedView(idx)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========== FILTERS PANEL ========== */}
      <div className={ledgerStyles.filtersPanel}>
        <div className={ledgerStyles.quickFilters}>
          <div className={ledgerStyles.filterGroup}>
            <label>Member</label>
            <Select
              options={memberOptions}
              value={memberOptions.find(
                (opt) => opt.value === filters.memberId
              )}
              onChange={(option) =>
                handleFilterChange("memberId", option?.value || "all")
              }
              placeholder="Select member..."
              isClearable
              isSearchable
              styles={{
                control: (base) => ({
                  ...base,
                  fontSize: "0.875rem",
                  minHeight: "38px",
                }),
                menu: (base) => ({
                  ...base,
                  zIndex: 9999,
                }),
              }}
            />
          </div>

          <div className={ledgerStyles.filterGroup}>
            <label>Category</label>
            <select
              value={filters.category}
              onChange={(e) => handleFilterChange("category", e.target.value)}
              className="input"
            >
              <option value="all">All Categories</option>
              <option value="Maintenance">Maintenance</option>
              <option value="Payment">Payment</option>
              <option value="Interest">💸 Interest</option>
              <option value="Adjustment">Adjustment</option>
            </select>
          </div>

          <div className={ledgerStyles.filterGroup}>
            <label>Type</label>
            <select
              value={filters.type}
              onChange={(e) => handleFilterChange("type", e.target.value)}
              className="input"
            >
              <option value="all">All Types</option>
              <option value="Debit">Debit</option>
              <option value="Credit">Credit</option>
            </select>
          </div>

          <div className={ledgerStyles.filterGroup}>
            <label>Month</label>
            <select
              value={filters.month}
              onChange={(e) => handleFilterChange("month", e.target.value)}
              className="input"
            >
              <option value="">All Months</option>
              {[
                "January",
                "February",
                "March",
                "April",
                "May",
                "June",
                "July",
                "August",
                "September",
                "October",
                "November",
                "December",
              ].map((month, idx) => (
                <option key={idx} value={idx + 1}>
                  {month}
                </option>
              ))}
            </select>
          </div>

          <div className={ledgerStyles.filterGroup}>
            <label>Year</label>
            <select
              value={filters.year}
              onChange={(e) => handleFilterChange("year", e.target.value)}
              className="input"
            >
              <option value="">All Years</option>
              {[2025, 2024, 2023, 2022, 2021].map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          <div className={ledgerStyles.filterGroup}>
            <label>Balance Status</label>
            <select
              value={filters.balanceStatus}
              onChange={(e) =>
                handleFilterChange("balanceStatus", e.target.value)
              }
              className="input"
            >
              <option value="all">All</option>
              <option value="arrears">Arrears (DR)</option>
              <option value="credit">Credit (CR)</option>
              <option value="zero">Zero Balance</option>
            </select>
          </div>
        </div>

        <button
          onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
          className={ledgerStyles.toggleAdvanced}
        >
          {showAdvancedFilters ? "▲ Hide" : "▼ Show"} Advanced Filters
        </button>

        {showAdvancedFilters && (
          <div className={ledgerStyles.advancedFilters}>
            <div className={ledgerStyles.filterGroup}>
              <label>Payment Mode</label>
              <select
                value={filters.paymentMode}
                onChange={(e) =>
                  handleFilterChange("paymentMode", e.target.value)
                }
                className="input"
              >
                <option value="all">All Modes</option>
                <option value="Cash">Cash</option>
                <option value="Cheque">Cheque</option>
                <option value="Online">Online</option>
                <option value="UPI">UPI</option>
                <option value="NEFT">NEFT</option>
                <option value="RTGS">RTGS</option>
                <option value="System">System</option>
              </select>
            </div>

            <div className={ledgerStyles.filterGroup}>
              <label>Wing</label>
              <select
                value={filters.wing}
                onChange={(e) => handleFilterChange("wing", e.target.value)}
                className="input"
              >
                <option value="all">All Wings</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
              </select>
            </div>

            <div className={ledgerStyles.filterGroup}>
              <label>Start Date</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) =>
                  handleFilterChange("startDate", e.target.value)
                }
                className="input"
              />
            </div>

            <div className={ledgerStyles.filterGroup}>
              <label>End Date</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => handleFilterChange("endDate", e.target.value)}
                className="input"
              />
            </div>

            <div className={ledgerStyles.filterGroup}>
              <label>Min Amount (₹)</label>
              <input
                type="number"
                value={filters.minAmount}
                onChange={(e) =>
                  handleFilterChange("minAmount", e.target.value)
                }
                placeholder="0"
                className="input"
              />
            </div>

            <div className={ledgerStyles.filterGroup}>
              <label>Max Amount (₹)</label>
              <input
                type="number"
                value={filters.maxAmount}
                onChange={(e) =>
                  handleFilterChange("maxAmount", e.target.value)
                }
                placeholder="99999"
                className="input"
              />
            </div>
          </div>
        )}

        <div className={ledgerStyles.filterActions}>
          <button
            onClick={resetFilters}
            className="btn btn-secondary"
            style={{ flex: 1 }}
          >
            🔄 Reset All Filters
          </button>
          <button
            onClick={() => {
              const name = prompt("Enter a name for this view:");
              if (name) {
                setNewViewName(name);
                saveCurrentView();
              }
            }}
            className="btn btn-primary"
            style={{ flex: 1 }}
          >
            💾 Save Current View
          </button>
        </div>
      </div>

      {/* ========== TABLE CONTROLS ========== */}
      <div className={ledgerStyles.tableControls}>
        <div className={ledgerStyles.searchBox}>
          <input
            type="text"
            placeholder="🔍 Search by Transaction ID, Description, Member..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className={ledgerStyles.groupByControl}>
          <label>Group By:</label>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            className="input"
          >
            <option value="">None</option>
            <option value="member">Member</option>
            <option value="category">Category</option>
            <option value="date">Month</option>
          </select>
        </div>

        <div className={ledgerStyles.sortControl}>
          <label>Sort:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="input"
          >
            <option value="date">Date</option>
            <option value="amount">Amount</option>
            <option value="member">Member</option>
          </select>
          <button
            onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
          >
            {sortOrder === "asc" ? "↑" : "↓"}
          </button>
        </div>

        <details className={ledgerStyles.columnToggle}>
          <summary>⚙️ Columns</summary>
          <div className={ledgerStyles.columnList}>
            {Object.entries(visibleColumns).map(([col, visible]) => (
              <label key={col}>
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={() => toggleColumn(col)}
                />
                {col.charAt(0).toUpperCase() +
                  col.slice(1).replace(/([A-Z])/g, " $1")}
              </label>
            ))}
          </div>
        </details>
      </div>

      {/* ========== LEDGER TABLE ========== */}
      <div className={styles.contentCard}>
        {isLoading ? (
          <div style={{ padding: "4rem", textAlign: "center" }}>
            <div
              className="loading-spinner"
              style={{ margin: "0 auto 1.5rem", width: "48px", height: "48px" }}
            ></div>
            <p style={{ fontSize: "1rem", color: "#6B7280" }}>
              Loading transactions...
            </p>
          </div>
        ) : !filteredTransactions || filteredTransactions.length === 0 ? (
          <div className={ledgerStyles.noData} style={{ padding: "4rem" }}>
            <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>📭</div>
            <p
              style={{
                fontSize: "1.25rem",
                fontWeight: "600",
                color: "#374151",
                marginBottom: "0.5rem",
              }}
            >
              No transactions found
            </p>
            <p style={{ fontSize: "0.875rem", color: "#6B7280" }}>
              Try adjusting your filters or search term
            </p>
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className={ledgerStyles.ledgerTable}>
                <thead>
                  <tr>
                    {visibleColumns.date && (
                      <th
                        onClick={() => handleSort("date")}
                        style={{ cursor: "pointer" }}
                      >
                        Date{" "}
                        {sortBy === "date" && (sortOrder === "asc" ? "↑" : "↓")}
                      </th>
                    )}
                    {visibleColumns.txnId && <th>Transaction ID</th>}
                    {visibleColumns.member && (
                      <th
                        onClick={() => handleSort("member")}
                        style={{ cursor: "pointer" }}
                      >
                        Member{" "}
                        {sortBy === "member" &&
                          (sortOrder === "asc" ? "↑" : "↓")}
                      </th>
                    )}
                    {visibleColumns.category && <th>Category</th>}
                    {visibleColumns.description && <th>Description</th>}
                    {visibleColumns.paymentMode && <th>Mode</th>}
                    {visibleColumns.debit && (
                      <th
                        onClick={() => handleSort("amount")}
                        style={{ cursor: "pointer", textAlign: "right" }}
                      >
                        Debit (₹){" "}
                        {sortBy === "amount" &&
                          (sortOrder === "asc" ? "↑" : "↓")}
                      </th>
                    )}
                    {visibleColumns.credit && (
                      <th style={{ textAlign: "right" }}>Credit (₹)</th>
                    )}
                    {visibleColumns.balance && (
                      <th style={{ textAlign: "right" }}>Balance (₹)</th>
                    )}
                    {visibleColumns.recordedBy && <th>Recorded By</th>}
                    {visibleColumns.billPeriod && <th>Bill Period</th>}
                    {visibleColumns.financialYear && <th>FY</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((txn) => (
                    <tr
                      key={txn._id}
                      className={ledgerStyles.clickableRow}
                      onClick={() => fetchTransactionDetails(txn._id)}
                      style={{
                        backgroundColor:
                          txn.category === "Interest"
                            ? "#FEF3C7"
                            : "transparent",
                      }}
                    >
                      {visibleColumns.date && (
                        <td style={{ whiteSpace: "nowrap" }}>
                          {new Date(txn.date).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </td>
                      )}
                      {visibleColumns.txnId && (
                        <td>
                          <span
                            className={ledgerStyles.txnId}
                            style={{
                              cursor: "pointer",
                              textDecoration: "underline",
                              color: "#3B82F6",
                            }}
                          >
                            {txn.transactionId}
                          </span>
                        </td>
                      )}
                      {visibleColumns.member && (
                        <td>
                          {txn.memberId ? (
                            <div>
                              <strong style={{ color: "#1F2937" }}>
                                {txn.memberId.wing}-{txn.memberId.roomNo}
                              </strong>
                              <br />
                              <span
                                style={{
                                  fontSize: "0.8125rem",
                                  color: "#6B7280",
                                }}
                              >
                                {txn.memberId.ownerName}
                              </span>
                            </div>
                          ) : (
                            <span style={{ color: "#9CA3AF" }}>N/A</span>
                          )}
                        </td>
                      )}
                      {visibleColumns.category && (
                        <td>
                          <span
                            className={ledgerStyles.categoryBadge}
                            style={{
                              backgroundColor:
                                txn.category === "Interest"
                                  ? "#FEE2E2"
                                  : txn.category === "Payment"
                                  ? "#D1FAE5"
                                  : txn.category === "Maintenance"
                                  ? "#DBEAFE"
                                  : "#F3F4F6",
                              color:
                                txn.category === "Interest"
                                  ? "#991B1B"
                                  : txn.category === "Payment"
                                  ? "#065F46"
                                  : txn.category === "Maintenance"
                                  ? "#1E40AF"
                                  : "#374151",
                            }}
                          >
                            {txn.category === "Interest" && "💸 "}
                            {txn.category}
                          </span>
                        </td>
                      )}
                      {visibleColumns.description && (
                        <td
                          style={{
                            maxWidth: "300px",
                            fontSize: "0.875rem",
                            color: "#374151",
                          }}
                        >
                          {txn.description}
                        </td>
                      )}
                      {visibleColumns.paymentMode && (
                        <td>
                          <span
                            className={
                              ledgerStyles[`payment${txn.paymentMode}`]
                            }
                          >
                            {txn.paymentMode}
                          </span>
                        </td>
                      )}
                      {visibleColumns.debit && (
                        <td
                          className={ledgerStyles.debit}
                          style={{ textAlign: "right" }}
                        >
                          {txn.type === "Debit"
                            ? `₹${txn.amount.toLocaleString("en-IN")}`
                            : "-"}
                        </td>
                      )}
                      {visibleColumns.credit && (
                        <td
                          className={ledgerStyles.credit}
                          style={{ textAlign: "right" }}
                        >
                          {txn.type === "Credit"
                            ? `₹${txn.amount.toLocaleString("en-IN")}`
                            : "-"}
                        </td>
                      )}
                      {visibleColumns.balance && (
                        <td style={{ textAlign: "right", fontWeight: "700" }}>
                          ₹
                          {Math.abs(txn.balanceAfterTransaction).toLocaleString(
                            "en-IN"
                          )}{" "}
                          <span
                            style={{
                              color:
                                txn.balanceAfterTransaction < 0
                                  ? "#DC2626"
                                  : "#059669",
                              fontSize: "0.75rem",
                              fontWeight: "600",
                            }}
                          >
                            {txn.balanceAfterTransaction < 0 ? "DR" : "CR"}
                          </span>
                        </td>
                      )}
                      {visibleColumns.recordedBy && (
                        <td style={{ fontSize: "0.8125rem", color: "#6B7280" }}>
                          {txn.createdBy?.name || "System"}
                          <br />
                          <span
                            style={{ fontSize: "0.6875rem", color: "#9CA3AF" }}
                          >
                            {txn.createdBy?.role}
                          </span>
                        </td>
                      )}
                      {visibleColumns.billPeriod && (
                        <td style={{ fontSize: "0.8125rem", color: "#6B7280" }}>
                          {txn.billPeriodId || "-"}
                        </td>
                      )}
                      {visibleColumns.financialYear && (
                        <td style={{ fontSize: "0.8125rem", color: "#6B7280" }}>
                          {txn.financialYear || "-"}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className={ledgerStyles.pagination}>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                ← Previous
              </button>
              <span>
                Page {page} of {ledgerData?.summary?.totalPages || 1} (
                {filteredTransactions.length} transactions)
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= (ledgerData?.summary?.totalPages || 1)}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>

      {/* ========== TRANSACTION DETAIL MODAL ========== */}
      {showDetailModal && selectedTransaction && (
        <div
          className={ledgerStyles.drillDownOverlay}
          onClick={() => setShowDetailModal(false)}
        >
          <div
            className={ledgerStyles.drillDownPanel}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={ledgerStyles.drillDownHeader}>
              <h2>📝 Transaction Details</h2>
              <button onClick={() => setShowDetailModal(false)}>✕</button>
            </div>
            <div className={ledgerStyles.drillDownContent}>
              {/* Basic Information */}
              <div className={ledgerStyles.detailSection}>
                <h3>📌 Basic Information</h3>
                <table>
                  <tbody>
                    <tr>
                      <td>Transaction ID</td>
                      <td>
                        <strong
                          style={{
                            fontFamily: "monospace",
                            fontSize: "0.9375rem",
                          }}
                        >
                          {selectedTransaction.transaction?.transactionId}
                        </strong>
                      </td>
                    </tr>
                    <tr>
                      <td>Date & Time</td>
                      <td>
                        {new Date(
                          selectedTransaction.transaction?.date
                        ).toLocaleString("en-IN", {
                          day: "2-digit",
                          month: "long",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                    <tr>
                      <td>Member</td>
                      <td>
                        <strong style={{ fontSize: "1rem" }}>
                          {selectedTransaction.transaction?.memberId?.wing}-
                          {selectedTransaction.transaction?.memberId?.roomNo}
                        </strong>
                        <br />
                        <span style={{ color: "#6B7280" }}>
                          {selectedTransaction.transaction?.memberId?.ownerName}
                        </span>
                        <br />
                        <span
                          style={{ fontSize: "0.8125rem", color: "#9CA3AF" }}
                        >
                          {selectedTransaction.transaction?.memberId?.areaSqFt}{" "}
                          sq.ft |{" "}
                          {selectedTransaction.transaction?.memberId?.contact}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td>Category</td>
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "0.5rem 1rem",
                            backgroundColor:
                              selectedTransaction.transaction?.category ===
                              "Interest"
                                ? "#FEE2E2"
                                : selectedTransaction.transaction?.category ===
                                  "Payment"
                                ? "#D1FAE5"
                                : "#DBEAFE",
                            color:
                              selectedTransaction.transaction?.category ===
                              "Interest"
                                ? "#991B1B"
                                : selectedTransaction.transaction?.category ===
                                  "Payment"
                                ? "#065F46"
                                : "#1E40AF",
                            borderRadius: "8px",
                            fontSize: "0.9375rem",
                            fontWeight: "700",
                          }}
                        >
                          {selectedTransaction.transaction?.category ===
                            "Interest" && "💸 "}
                          {selectedTransaction.transaction?.category}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td>Type</td>
                      <td>
                        <span
                          style={{
                            color:
                              selectedTransaction.transaction?.type === "Debit"
                                ? "#DC2626"
                                : "#059669",
                            fontSize: "1.125rem",
                            fontWeight: "bold",
                          }}
                        >
                          {selectedTransaction.transaction?.type === "Debit"
                            ? "📤"
                            : "📥"}{" "}
                          {selectedTransaction.transaction?.type}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td>Amount</td>
                      <td>
                        <strong
                          style={{
                            fontSize: "1.75rem",
                            color:
                              selectedTransaction.transaction?.type === "Debit"
                                ? "#DC2626"
                                : "#059669",
                          }}
                        >
                          ₹
                          {selectedTransaction.transaction?.amount.toLocaleString(
                            "en-IN"
                          )}
                        </strong>
                      </td>
                    </tr>
                    <tr>
                      <td>Balance After Transaction</td>
                      <td>
                        <strong style={{ fontSize: "1.25rem" }}>
                          ₹
                          {Math.abs(
                            selectedTransaction.transaction
                              ?.balanceAfterTransaction
                          ).toLocaleString("en-IN")}{" "}
                          <span
                            style={{
                              color:
                                selectedTransaction.transaction
                                  ?.balanceAfterTransaction < 0
                                  ? "#DC2626"
                                  : "#059669",
                            }}
                          >
                            {selectedTransaction.transaction
                              ?.balanceAfterTransaction < 0
                              ? "DR"
                              : "CR"}
                          </span>
                        </strong>
                      </td>
                    </tr>
                    <tr>
                      <td>Description</td>
                      <td style={{ fontSize: "0.9375rem", lineHeight: "1.6" }}>
                        {selectedTransaction.transaction?.description}
                      </td>
                    </tr>
                    <tr>
                      <td>Payment Mode</td>
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "0.5rem 1rem",
                            backgroundColor: "#F3F4F6",
                            borderRadius: "6px",
                            fontWeight: "600",
                          }}
                        >
                          {selectedTransaction.transaction?.paymentMode}
                        </span>
                      </td>
                    </tr>
                    {selectedTransaction.transaction?.billPeriodId && (
                      <tr>
                        <td>Bill Period</td>
                        <td>
                          <strong>
                            {selectedTransaction.transaction?.billPeriodId}
                          </strong>
                        </td>
                      </tr>
                    )}
                    {selectedTransaction.transaction?.financialYear && (
                      <tr>
                        <td>Financial Year</td>
                        <td>
                          <strong>
                            {selectedTransaction.transaction?.financialYear}
                          </strong>
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td>Created By</td>
                      <td>
                        <strong>
                          {selectedTransaction.transaction?.createdBy?.name}
                        </strong>
                        <br />
                        <span
                          style={{ fontSize: "0.8125rem", color: "#6B7280" }}
                        >
                          {selectedTransaction.transaction?.createdBy?.role} •{" "}
                          {selectedTransaction.transaction?.createdBy?.email}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Billing Breakdown */}
              {selectedTransaction.breakdown &&
                selectedTransaction.breakdown.length > 0 && (
                  <div className={ledgerStyles.detailSection}>
                    <h3>💰 Billing Breakdown</h3>
                    <table>
                      <thead>
                        <tr>
                          <th>Charge Type</th>
                          <th>Calculation Method</th>
                          <th style={{ textAlign: "right" }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedTransaction.breakdown.map((item, idx) => (
                          <tr key={idx}>
                            <td>
                              <strong>{item.headName}</strong>
                            </td>
                            <td>
                              <span
                                style={{
                                  fontSize: "0.8125rem",
                                  color: "#6B7280",
                                  backgroundColor: "#F3F4F6",
                                  padding: "0.25rem 0.5rem",
                                  borderRadius: "4px",
                                }}
                              >
                                {item.calculationType}
                              </span>
                            </td>
                            <td
                              style={{ textAlign: "right", fontWeight: "600" }}
                            >
                              ₹{item.amount.toLocaleString("en-IN")}
                            </td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: "2px solid #E5E7EB" }}>
                          <td colSpan="2">
                            <strong>Total</strong>
                          </td>
                          <td
                            style={{
                              textAlign: "right",
                              fontWeight: "700",
                              fontSize: "1.125rem",
                            }}
                          >
                            ₹
                            {selectedTransaction.breakdown
                              .reduce((sum, item) => sum + item.amount, 0)
                              .toLocaleString("en-IN")}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

              {/* Audit Trail */}
              {selectedTransaction.auditTrail &&
                selectedTransaction.auditTrail.length > 0 && (
                  <div className={ledgerStyles.detailSection}>
                    <h3>📜 Audit Trail</h3>
                    <ul>
                      {selectedTransaction.auditTrail.map((log, idx) => (
                        <li key={idx}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                            }}
                          >
                            <div>
                              <strong style={{ color: "#374151" }}>
                                {log.action}
                              </strong>
                              <br />
                              <span
                                style={{
                                  fontSize: "0.8125rem",
                                  color: "#6B7280",
                                }}
                              >
                                by {log.user?.name} ({log.user?.role})
                              </span>
                            </div>
                            <span
                              style={{ fontSize: "0.75rem", color: "#9CA3AF" }}
                            >
                              {new Date(log.timestamp).toLocaleString("en-IN")}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
