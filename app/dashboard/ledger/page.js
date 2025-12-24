"use client";
import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";
import ledgerStyles from "@/styles/Ledger.module.css";

export default function LedgerPage() {
  // ===== STATE: Quick Filters =====
  const [selectedMember, setSelectedMember] = useState("all");
  const [category, setCategory] = useState("all");
  const [txnType, setTxnType] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [billPeriod, setBillPeriod] = useState("all");
  const [filterMonth, setFilterMonth] = useState(""); // NEW
  const [filterYear, setFilterYear] = useState(""); // NEW

  // ===== STATE: Advanced Filters =====
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [wing, setWing] = useState("all");
  const [roomNoPattern, setRoomNoPattern] = useState("");
  const [balanceStatus, setBalanceStatus] = useState("all");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("all");
  const [financialYear, setFinancialYear] = useState("all");
  const [createdBy, setCreatedBy] = useState("all");
  const [includeReversed, setIncludeReversed] = useState(false);
  const [onlyReversed, setOnlyReversed] = useState(false);

  // ===== STATE: Table Behaviors =====
  const [groupBy, setGroupBy] = useState(""); // member | category | date
  const [sortBy, setSortBy] = useState("date");
  const [sortOrder, setSortOrder] = useState("desc");
  const [visibleColumns, setVisibleColumns] = useState({
    date: true,
    transactionId: true,
    member: true,
    category: true,
    description: true,
    paymentMode: true,
    debit: true,
    credit: true,
    balance: true,
    createdBy: false,
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const limit = 100;

  // ===== STATE: Drill-down =====
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [showDrillDown, setShowDrillDown] = useState(false);

  // ===== STATE: Saved Views =====
  const [savedViews, setSavedViews] = useState([]);
  const [currentViewName, setCurrentViewName] = useState("");

  // ===== FETCH: Members =====
  const { data: membersData } = useQuery({
    queryKey: ["members-list"],
    queryFn: () => apiClient.get("/api/members/list?limit=1000"),
  });
  const members = membersData?.members || [];

  // ===== FETCH: Users (for createdBy filter) =====
  const { data: usersData } = useQuery({
    queryKey: ["users-list"],
    queryFn: () => apiClient.get("/api/users/list"),
    enabled: showAdvanced,
  });
  const users = usersData?.users || [];

  // ===== FETCH: Transactions =====
  const buildQueryString = () => {
    const params = new URLSearchParams();
    if (selectedMember !== "all") params.append("memberId", selectedMember);
    if (category !== "all") params.append("category", category);
    if (txnType !== "all") params.append("type", txnType);
    if (startDate) params.append("startDate", startDate);
    if (endDate) params.append("endDate", endDate);
    if (billPeriod !== "all") params.append("billPeriod", billPeriod);
    if (endDate) params.append("endDate", endDate);
    if (billPeriod !== "all") params.append("billPeriod", billPeriod);
    if (filterMonth) params.append("month", filterMonth);
    if (filterYear) params.append("year", filterYear);
    if (wing !== "all") params.append("wing", wing);
    if (roomNoPattern) params.append("roomNo", roomNoPattern);
    if (balanceStatus !== "all") params.append("balanceStatus", balanceStatus);
    if (minAmount) params.append("minAmount", minAmount);
    if (maxAmount) params.append("maxAmount", maxAmount);
    if (paymentMode !== "all") params.append("paymentMode", paymentMode);
    if (financialYear !== "all") params.append("financialYear", financialYear);
    if (createdBy !== "all") params.append("createdBy", createdBy);
    if (includeReversed) params.append("includeReversed", "true");
    if (onlyReversed) params.append("onlyReversed", "true");

    if (groupBy) params.append("groupBy", groupBy);
    params.append("sortBy", sortBy);
    params.append("sortOrder", sortOrder);
    params.append("page", page);
    params.append("limit", limit);

    return params.toString();
  };

  const {
    data: transactionsData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: [
      "ledger-transactions",
      selectedMember,
      category,
      txnType,
      startDate,
      endDate,
      filterMonth,
      filterYear,
      billPeriod,
      wing,
      roomNoPattern,
      balanceStatus,
      minAmount,
      maxAmount,
      paymentMode,
      financialYear,
      createdBy,
      includeReversed,
      onlyReversed,
      groupBy,
      sortBy,
      sortOrder,
      page,
    ],
    queryFn: () => apiClient.get(`/api/ledger/fetch?${buildQueryString()}`),
  });

  const transactions = transactionsData?.transactions || [];
  const summary = transactionsData?.summary || {
    totalTransactions: 0,
    totalDebit: 0,
    totalCredit: 0,
    netBalance: 0,
    balanceType: "DR",
  };
  const groupedData = transactionsData?.groupedData || null;

  // ===== CLIENT-SIDE: Search within loaded data =====
  const searchedTransactions = useMemo(() => {
    if (!searchTerm) return transactions;
    const term = searchTerm.toLowerCase();
    return transactions.filter(
      (t) =>
        t.transactionId?.toLowerCase().includes(term) ||
        t.description?.toLowerCase().includes(term) ||
        t.memberId?.ownerName?.toLowerCase().includes(term) ||
        t.category?.toLowerCase().includes(term) ||
        t.paymentMode?.toLowerCase().includes(term)
    );
  }, [transactions, searchTerm]);

  // ===== HELPERS =====
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-IN").format(amount);
  };

  const getPaymentBadgeClass = (mode) => {
    const modeMap = {
      Cash: ledgerStyles.paymentCash,
      Cheque: ledgerStyles.paymentCheque,
      Online: ledgerStyles.paymentOnline,
      UPI: ledgerStyles.paymentUPI,
      NEFT: ledgerStyles.paymentOnline,
      RTGS: ledgerStyles.paymentOnline,
      System: ledgerStyles.paymentSystem,
    };
    return modeMap[mode] || ledgerStyles.paymentCash;
  };

  const resetFilters = () => {
    setSelectedMember("all");
    setCategory("all");
    setTxnType("all");
    setStartDate("");
    setEndDate("");
    setFilterMonth(""); // NEW
    setFilterYear("");
    setBillPeriod("all");
    setWing("all");
    setRoomNoPattern("");
    setBalanceStatus("all");
    setMinAmount("");
    setMaxAmount("");
    setPaymentMode("all");
    setFinancialYear("all");
    setCreatedBy("all");
    setIncludeReversed(false);
    setOnlyReversed(false);
    setSearchTerm("");
    setGroupBy("");
    setPage(1);
  };

  // ===== SAVED VIEWS =====
  useEffect(() => {
    const saved = localStorage.getItem("ledgerSavedViews");
    if (saved) setSavedViews(JSON.parse(saved));
  }, []);

  const saveCurrentView = () => {
    if (!currentViewName.trim()) {
      alert("Enter a view name");
      return;
    }
    const view = {
      name: currentViewName,
      filters: {
        selectedMember,
        category,
        txnType,
        filterMonth, // NEW
        filterYear,
        startDate,
        endDate,
        billPeriod,
        wing,
        roomNoPattern,
        balanceStatus,
        minAmount,
        maxAmount,
        paymentMode,
        financialYear,
        createdBy,
        includeReversed,
        onlyReversed,
      },
      columns: visibleColumns,
      groupBy,
      sortBy,
      sortOrder,
    };
    const updated = [...savedViews, view];
    setSavedViews(updated);
    localStorage.setItem("ledgerSavedViews", JSON.stringify(updated));
    setCurrentViewName("");
    alert(`View "${view.name}" saved`);
  };

  const loadView = (view) => {
    setSelectedMember(view.filters.selectedMember);
    setCategory(view.filters.category);
    setTxnType(view.filters.txnType);
    setFilterMonth(view.filters.filterMonth || ""); // NEW
    setFilterYear(view.filters.filterYear || "");
    setStartDate(view.filters.startDate);
    setEndDate(view.filters.endDate);
    setBillPeriod(view.filters.billPeriod);
    setWing(view.filters.wing);
    setRoomNoPattern(view.filters.roomNoPattern);
    setBalanceStatus(view.filters.balanceStatus);
    setMinAmount(view.filters.minAmount);
    setMaxAmount(view.filters.maxAmount);
    setPaymentMode(view.filters.paymentMode);
    setFinancialYear(view.filters.financialYear);
    setCreatedBy(view.filters.createdBy);
    setIncludeReversed(view.filters.includeReversed);
    setOnlyReversed(view.filters.onlyReversed);
    setVisibleColumns(view.columns);
    setGroupBy(view.groupBy);
    setSortBy(view.sortBy);
    setSortOrder(view.sortOrder);
  };

  const deleteView = (index) => {
    const updated = savedViews.filter((_, i) => i !== index);
    setSavedViews(updated);
    localStorage.setItem("ledgerSavedViews", JSON.stringify(updated));
  };

  // ===== DRILL-DOWN =====
  const openDrillDown = async (txn) => {
    setSelectedTransaction(txn);
    setShowDrillDown(true);
    // Optionally fetch full details from /api/ledger/transaction/[id]
    try {
      const details = await apiClient.get(`/api/ledger/transaction/${txn._id}`);
      setSelectedTransaction({ ...txn, ...details });
    } catch (err) {
      console.error("Failed to fetch transaction details", err);
    }
  };

  const closeDrillDown = () => {
    setShowDrillDown(false);
    setSelectedTransaction(null);
  };

  // ===== EXPORT =====
  const exportToExcel = async () => {
    try {
      await apiClient.download(
        `/api/ledger/export?${buildQueryString()}&format=xlsx`,
        `ledger_${Date.now()}.xlsx`
      );
    } catch (err) {
      alert("Export failed");
    }
  };

  const exportToPDF = async () => {
    try {
      await apiClient.download(
        `/api/ledger/export?${buildQueryString()}&format=pdf`,
        `ledger_${Date.now()}.pdf`
      );
    } catch (err) {
      alert("Export failed");
    }
  };

  // ===== COLUMN TOGGLE =====
  const toggleColumn = (col) => {
    setVisibleColumns((prev) => ({ ...prev, [col]: !prev[col] }));
  };

  // ===== RENDER =====
  return (
    <div className={styles.pageContainer}>
      <div className={styles.pageHeader}>
        <h1>Ledger</h1>
        <p>Complete transaction history with running balance</p>
      </div>

      {/* ===== SUMMARY CARDS ===== */}
      <div className={ledgerStyles.summaryBar}>
        <div className={ledgerStyles.summaryCard}>
          <h3>Total Transactions</h3>
          <p className={ledgerStyles.summaryValue}>
            {summary.totalTransactions}
          </p>
        </div>
        <div className={ledgerStyles.summaryCard}>
          <h3>Total Debit</h3>
          <p className={ledgerStyles.summaryValue}>
            ₹{formatCurrency(summary.totalDebit)}
          </p>
        </div>
        <div className={ledgerStyles.summaryCard}>
          <h3>Total Credit</h3>
          <p className={ledgerStyles.summaryValue}>
            ₹{formatCurrency(summary.totalCredit)}
          </p>
        </div>
        <div className={ledgerStyles.summaryCard}>
          <h3>Net Balance</h3>
          <p
            className={`${ledgerStyles.summaryValue} ${
              summary.netBalance >= 0
                ? ledgerStyles.balancePositive
                : ledgerStyles.balanceNegative
            }`}
          >
            ₹{formatCurrency(Math.abs(summary.netBalance))}{" "}
            {summary.balanceType}
          </p>
        </div>
        {selectedMember !== "all" && (
          <div className={ledgerStyles.summaryCard}>
            <h3>Opening Balance</h3>
            <p className={ledgerStyles.summaryValue}>
              ₹{formatCurrency(summary.openingBalance)}
            </p>
          </div>
        )}
        {transactionsData?.filters?.startDate && (
          <div className={ledgerStyles.summaryBadge}>
            📅 {transactionsData.filters.startDate} to{" "}
            {transactionsData.filters.endDate || "Now"}
          </div>
        )}
        {financialYear !== "all" && (
          <div className={ledgerStyles.summaryBadge}>🗓️ FY {financialYear}</div>
        )}
      </div>

      {/* ===== FILTERS PANEL ===== */}
      <div className={ledgerStyles.filtersPanel}>
        {/* QUICK FILTERS */}
        <div className={ledgerStyles.quickFilters}>
          <div className={ledgerStyles.filterGroup}>
            <label>Member</label>
            <select
              value={selectedMember}
              onChange={(e) => setSelectedMember(e.target.value)}
            >
              <option value="all">All Members</option>
              {members.map((m) => (
                <option key={m._id} value={m._id}>
                  {m.wing}-{m.roomNo} {m.ownerName}
                </option>
              ))}
            </select>
          </div>

          <div className={ledgerStyles.filterGroup}>
            <label>Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">All Categories</option>
              <option value="Maintenance">Maintenance</option>
              <option value="Payment">Payment</option>
              <option value="Arrears">Arrears</option>
              <option value="Interest">Interest</option>
              <option value="Adjustment">Adjustment</option>
              <option value="Refund">Refund</option>
              <option value="Fine">Fine</option>
              <option value="Opening Balance">Opening Balance</option>
            </select>
          </div>

          <div className={ledgerStyles.filterGroup}>
            <label>Type</label>
            <select
              value={txnType}
              onChange={(e) => setTxnType(e.target.value)}
            >
              <option value="all">All</option>
              <option value="Debit">Debit</option>
              <option value="Credit">Credit</option>
            </select>
          </div>

          <div className={ledgerStyles.filterGroup}>
            <label>Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className={ledgerStyles.filterGroup}>
            <label>End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className={ledgerStyles.filterGroup}>
            <label>Bill Period</label>
            <select
              value={billPeriod}
              onChange={(e) => setBillPeriod(e.target.value)}
            >
              <option value="all">All Periods</option>
              <option value="2025-12">2025-12</option>
              <option value="2025-11">2025-11</option>
              <option value="2025-10">2025-10</option>
            </select>
          </div>

          {/* NEW: Month filter */}
          <div className={ledgerStyles.filterGroup}>
            <label>Month</label>
            <select
              value={filterMonth}
              onChange={(e) => {
                const month = e.target.value;
                setFilterMonth(month);
                // If month is selected but year is empty, auto-set to current year
                if (month && !filterYear) {
                  setFilterYear(new Date().getFullYear().toString());
                }
              }}
            >
              <option value="">All Months</option>
              <option value="1">January</option>
              <option value="2">February</option>
              <option value="3">March</option>
              <option value="4">April</option>
              <option value="5">May</option>
              <option value="6">June</option>
              <option value="7">July</option>
              <option value="8">August</option>
              <option value="9">September</option>
              <option value="10">October</option>
              <option value="11">November</option>
              <option value="12">December</option>
            </select>
          </div>

          <div className={ledgerStyles.filterGroup}>
            <label>Year</label>
            <select
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
            >
              <option value="">All Years</option>
              <option value="2026">2026</option>
              <option value="2025">2025</option>
              <option value="2024">2024</option>
              <option value="2023">2023</option>
            </select>
            {filterYear && filterMonth && (
              <small
                style={{
                  color: "#6b7280",
                  fontSize: "0.75rem",
                  marginTop: "0.25rem",
                }}
              >
                Filtering:{" "}
                {
                  [
                    "Jan",
                    "Feb",
                    "Mar",
                    "Apr",
                    "May",
                    "Jun",
                    "Jul",
                    "Aug",
                    "Sep",
                    "Oct",
                    "Nov",
                    "Dec",
                  ][parseInt(filterMonth) - 1]
                }{" "}
                {filterYear}
              </small>
            )}
          </div>
        </div>

        {/* ADVANCED FILTERS (collapsible) */}
        <button
          className={ledgerStyles.toggleAdvanced}
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? "▲ Hide" : "▼ Show"} Advanced Filters
        </button>

        {showAdvanced && (
          <div className={ledgerStyles.advancedFilters}>
            <div className={ledgerStyles.filterGroup}>
              <label>Wing</label>
              <select value={wing} onChange={(e) => setWing(e.target.value)}>
                <option value="all">All Wings</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
              </select>
            </div>

            <div className={ledgerStyles.filterGroup}>
              <label>Room No Pattern</label>
              <input
                type="text"
                placeholder="e.g., 13*, 1310-1350"
                value={roomNoPattern}
                onChange={(e) => setRoomNoPattern(e.target.value)}
              />
            </div>

            <div className={ledgerStyles.filterGroup}>
              <label>Balance Status</label>
              <select
                value={balanceStatus}
                onChange={(e) => setBalanceStatus(e.target.value)}
              >
                <option value="all">All</option>
                <option value="arrears">In Arrears (DR)</option>
                <option value="credit">In Credit (CR)</option>
                <option value="zero">Zero Balance</option>
              </select>
            </div>

            <div className={ledgerStyles.filterGroup}>
              <label>Min Amount</label>
              <input
                type="number"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                placeholder="₹"
              />
            </div>

            <div className={ledgerStyles.filterGroup}>
              <label>Max Amount</label>
              <input
                type="number"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                placeholder="₹"
              />
            </div>

            <div className={ledgerStyles.filterGroup}>
              <label>Payment Mode</label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
              >
                <option value="all">All</option>
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
              <label>Financial Year</label>
              <select
                value={financialYear}
                onChange={(e) => setFinancialYear(e.target.value)}
              >
                <option value="all">All</option>
                <option value="2025-2026">FY 2025-26</option>
                <option value="2024-2025">FY 2024-25</option>
              </select>
            </div>

            <div className={ledgerStyles.filterGroup}>
              <label>Created By</label>
              <select
                value={createdBy}
                onChange={(e) => setCreatedBy(e.target.value)}
              >
                <option value="all">All Users</option>
                {users.map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </select>
            </div>

            <div className={ledgerStyles.filterGroup}>
              <label>
                <input
                  type="checkbox"
                  checked={includeReversed}
                  onChange={(e) => setIncludeReversed(e.target.checked)}
                />
                Include Reversed
              </label>
            </div>

            <div className={ledgerStyles.filterGroup}>
              <label>
                <input
                  type="checkbox"
                  checked={onlyReversed}
                  onChange={(e) => setOnlyReversed(e.target.checked)}
                />
                Only Reversals
              </label>
            </div>
          </div>
        )}

        {/* FILTER ACTIONS */}
        <div className={ledgerStyles.filterActions}>
          <button onClick={resetFilters} className={styles.btnSecondary}>
            🔄 Reset Filters
          </button>
          <button onClick={exportToExcel} className={styles.btnPrimary}>
            📊 Export to Excel
          </button>
          <button onClick={exportToPDF} className={styles.btnPrimary}>
            📄 Generate PDF
          </button>
        </div>
      </div>

      {/* ===== SAVED VIEWS ===== */}
      <div className={ledgerStyles.savedViewsPanel}>
        <h3>Saved Views</h3>
        <div className={ledgerStyles.savedViewsList}>
          {savedViews.map((view, idx) => (
            <div key={idx} className={ledgerStyles.savedViewItem}>
              <span onClick={() => loadView(view)}>{view.name}</span>
              <button onClick={() => deleteView(idx)}>✖</button>
            </div>
          ))}
        </div>
        <div className={ledgerStyles.saveViewForm}>
          <input
            type="text"
            placeholder="View name..."
            value={currentViewName}
            onChange={(e) => setCurrentViewName(e.target.value)}
          />
          <button onClick={saveCurrentView} className={styles.btnSecondary}>
            💾 Save Current View
          </button>
        </div>
      </div>

      {/* ===== TABLE CONTROLS ===== */}
      <div className={ledgerStyles.tableControls}>
        <div className={ledgerStyles.searchBox}>
          <input
            type="text"
            placeholder="Search in table..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className={ledgerStyles.groupByControl}>
          <label>Group By:</label>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="">None</option>
            <option value="member">Member</option>
            <option value="category">Category</option>
            <option value="date">Month</option>
          </select>
        </div>

        <div className={ledgerStyles.sortControl}>
          <label>Sort By:</label>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="date">Date</option>
            <option value="amount">Amount</option>
            <option value="member">Member</option>
          </select>
          <button
            onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
          >
            {sortOrder === "asc" ? "⬆️" : "⬇️"}
          </button>
        </div>

        <details className={ledgerStyles.columnToggle}>
          <summary>Columns</summary>
          <div className={ledgerStyles.columnList}>
            {Object.keys(visibleColumns).map((col) => (
              <label key={col}>
                <input
                  type="checkbox"
                  checked={visibleColumns[col]}
                  onChange={() => toggleColumn(col)}
                />
                {col}
              </label>
            ))}
          </div>
        </details>
      </div>

      {/* ===== TRANSACTIONS TABLE ===== */}
      {isLoading ? (
        <div className={styles.loading}>Loading...</div>
      ) : groupBy && groupedData ? (
        <div className={ledgerStyles.groupedView}>
          {Object.keys(groupedData).map((groupKey) => {
            const group = groupedData[groupKey];
            return (
              <div key={groupKey} className={ledgerStyles.groupSection}>
                <div className={ledgerStyles.groupHeader}>
                  <h3>{groupKey}</h3>
                  <span>
                    Debit: ₹{formatCurrency(group.totalDebit)} | Credit: ₹
                    {formatCurrency(group.totalCredit)}
                  </span>
                </div>
                <table className={ledgerStyles.ledgerTable}>
                  <thead>
                    <tr>
                      {visibleColumns.date && <th>Date</th>}
                      {visibleColumns.transactionId && <th>Transaction ID</th>}
                      {visibleColumns.member && <th>Member</th>}
                      {visibleColumns.category && <th>Category</th>}
                      {visibleColumns.description && <th>Description</th>}
                      {visibleColumns.paymentMode && <th>Payment Mode</th>}
                      {visibleColumns.debit && <th>Debit (₹)</th>}
                      {visibleColumns.credit && <th>Credit (₹)</th>}
                      {visibleColumns.balance && <th>Balance (₹)</th>}
                      {visibleColumns.createdBy && <th>Created By</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {group.transactions.map((t) => (
                      <tr
                        key={t._id}
                        onClick={() => openDrillDown(t)}
                        className={ledgerStyles.clickableRow}
                      >
                        {visibleColumns.date && <td>{formatDate(t.date)}</td>}
                        {visibleColumns.transactionId && (
                          <td className={ledgerStyles.txnId}>
                            {t.transactionId}
                          </td>
                        )}
                        {visibleColumns.member && (
                          <td>
                            {t.memberId?.wing}-{t.memberId?.roomNo}
                            <br />
                            <small>{t.memberId?.ownerName}</small>
                          </td>
                        )}
                        {visibleColumns.category && (
                          <td>
                            <span className={ledgerStyles.categoryBadge}>
                              {t.category}
                            </span>
                          </td>
                        )}
                        {visibleColumns.description && <td>{t.description}</td>}
                        {visibleColumns.paymentMode && t.paymentMode && (
                          <td>
                            <span
                              className={getPaymentBadgeClass(t.paymentMode)}
                            >
                              {t.paymentMode}
                            </span>
                          </td>
                        )}
                        {visibleColumns.debit && (
                          <td className={ledgerStyles.debit}>
                            {t.type === "Debit"
                              ? formatCurrency(t.amount)
                              : "-"}
                          </td>
                        )}
                        {visibleColumns.credit && (
                          <td className={ledgerStyles.credit}>
                            {t.type === "Credit"
                              ? formatCurrency(t.amount)
                              : "-"}
                          </td>
                        )}
                        {visibleColumns.balance && (
                          <td
                            className={
                              t.balanceAfterTransaction >= 0
                                ? ledgerStyles.balancePositive
                                : ledgerStyles.balanceNegative
                            }
                          >
                            {formatCurrency(
                              Math.abs(t.balanceAfterTransaction)
                            )}{" "}
                            {t.balanceAfterTransaction >= 0 ? "DR" : "CR"}
                          </td>
                        )}
                        {visibleColumns.createdBy && (
                          <td>
                            <small>{t.createdBy?.name}</small>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      ) : (
        <table className={ledgerStyles.ledgerTable}>
          <thead>
            <tr>
              {visibleColumns.date && <th>Date</th>}
              {visibleColumns.transactionId && <th>Transaction ID</th>}
              {visibleColumns.member && <th>Member</th>}
              {visibleColumns.category && <th>Category</th>}
              {visibleColumns.description && <th>Description</th>}
              {visibleColumns.paymentMode && <th>Payment Mode</th>}
              {visibleColumns.debit && <th>Debit (₹)</th>}
              {visibleColumns.credit && <th>Credit (₹)</th>}
              {visibleColumns.balance && <th>Balance (₹)</th>}
              {visibleColumns.createdBy && <th>Created By</th>}
            </tr>
          </thead>
          <tbody>
            {searchedTransactions.length === 0 ? (
              <tr>
                <td colSpan={10} className={ledgerStyles.noData}>
                  No transactions found
                </td>
              </tr>
            ) : (
              searchedTransactions.map((transaction) => (
                <tr
                  key={transaction._id}
                  onClick={() => openDrillDown(transaction)}
                  className={ledgerStyles.clickableRow}
                >
                  {visibleColumns.date && (
                    <td>{formatDate(transaction.date)}</td>
                  )}
                  {visibleColumns.transactionId && (
                    <td className={ledgerStyles.txnId}>
                      {transaction.transactionId}
                    </td>
                  )}
                  {visibleColumns.member && (
                    <td>
                      {transaction.memberId?.wing
                        ? `${transaction.memberId.wing}-`
                        : ""}
                      {transaction.memberId?.roomNo}
                      <br />
                      <small>{transaction.memberId?.ownerName}</small>
                    </td>
                  )}
                  {visibleColumns.category && (
                    <td>
                      <span className={ledgerStyles.categoryBadge}>
                        {transaction.category}
                      </span>
                    </td>
                  )}
                  {visibleColumns.description && (
                    <td>{transaction.description}</td>
                  )}
                  {visibleColumns.paymentMode && transaction.paymentMode && (
                    <td>
                      <span
                        className={getPaymentBadgeClass(
                          transaction.paymentMode
                        )}
                      >
                        {transaction.paymentMode}
                      </span>
                    </td>
                  )}
                  {visibleColumns.debit && (
                    <td className={ledgerStyles.debit}>
                      {transaction.type === "Debit"
                        ? formatCurrency(transaction.amount)
                        : "-"}
                    </td>
                  )}
                  {visibleColumns.credit && (
                    <td className={ledgerStyles.credit}>
                      {transaction.type === "Credit"
                        ? formatCurrency(transaction.amount)
                        : "-"}
                    </td>
                  )}
                  {visibleColumns.balance && (
                    <td
                      className={
                        transaction.balanceAfterTransaction >= 0
                          ? ledgerStyles.balancePositive
                          : ledgerStyles.balanceNegative
                      }
                    >
                      {formatCurrency(
                        Math.abs(transaction.balanceAfterTransaction)
                      )}{" "}
                      {transaction.balanceAfterTransaction >= 0 ? "DR" : "CR"}
                    </td>
                  )}
                  {visibleColumns.createdBy && (
                    <td>
                      <small>{transaction.createdBy?.name}</small>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}

      {/* ===== PAGINATION ===== */}
      <div className={ledgerStyles.pagination}>
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>
          Page {page} of {summary.totalPages || 1}
        </span>
        <button
          disabled={page >= summary.totalPages}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>

      {/* ===== DRILL-DOWN PANEL ===== */}
      {showDrillDown && selectedTransaction && (
        <div className={ledgerStyles.drillDownOverlay} onClick={closeDrillDown}>
          <div
            className={ledgerStyles.drillDownPanel}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={ledgerStyles.drillDownHeader}>
              <h2>Transaction Details</h2>
              <button onClick={closeDrillDown}>✖</button>
            </div>

            <div className={ledgerStyles.drillDownContent}>
              <div className={ledgerStyles.detailSection}>
                <h3>Basic Info</h3>
                <table>
                  <tbody>
                    <tr>
                      <td>Transaction ID</td>
                      <td>{selectedTransaction.transactionId}</td>
                    </tr>
                    <tr>
                      <td>Date</td>
                      <td>{formatDate(selectedTransaction.date)}</td>
                    </tr>
                    <tr>
                      <td>Type</td>
                      <td>
                        <strong>{selectedTransaction.type}</strong>
                      </td>
                    </tr>
                    <tr>
                      <td>Category</td>
                      <td>{selectedTransaction.category}</td>
                    </tr>
                    <tr>
                      <td>Amount</td>
                      <td>₹{formatCurrency(selectedTransaction.amount)}</td>
                    </tr>
                    <tr>
                      <td>Running Balance</td>
                      <td>
                        ₹
                        {formatCurrency(
                          Math.abs(selectedTransaction.balanceAfterTransaction)
                        )}{" "}
                        {selectedTransaction.balanceAfterTransaction >= 0
                          ? "DR"
                          : "CR"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className={ledgerStyles.detailSection}>
                <h3>Member</h3>
                <table>
                  <tbody>
                    <tr>
                      <td>Name</td>
                      <td>{selectedTransaction.memberId?.ownerName}</td>
                    </tr>
                    <tr>
                      <td>Flat</td>
                      <td>
                        {selectedTransaction.memberId?.wing}-
                        {selectedTransaction.memberId?.roomNo}
                      </td>
                    </tr>
                    <tr>
                      <td>Area (sq ft)</td>
                      <td>{selectedTransaction.memberId?.areaSqFt}</td>
                    </tr>
                    <tr>
                      <td>Config</td>
                      <td>{selectedTransaction.memberId?.config}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {selectedTransaction.breakdown && (
                <div className={ledgerStyles.detailSection}>
                  <h3>Bill Breakdown</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Head</th>
                        <th>Calculation</th>
                        <th>Amount (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTransaction.breakdown.map((item, idx) => (
                        <tr key={idx}>
                          <td>{item.headName}</td>
                          <td>{item.calculationType}</td>
                          <td>{formatCurrency(item.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedTransaction.paymentDetails && (
                <div className={ledgerStyles.detailSection}>
                  <h3>Payment Details</h3>
                  <table>
                    <tbody>
                      <tr>
                        <td>Mode</td>
                        <td>{selectedTransaction.paymentMode}</td>
                      </tr>
                      {selectedTransaction.paymentDetails.chequeNo && (
                        <tr>
                          <td>Cheque No</td>
                          <td>{selectedTransaction.paymentDetails.chequeNo}</td>
                        </tr>
                      )}
                      {selectedTransaction.paymentDetails.bankName && (
                        <tr>
                          <td>Bank</td>
                          <td>{selectedTransaction.paymentDetails.bankName}</td>
                        </tr>
                      )}
                      {selectedTransaction.paymentDetails.transactionRef && (
                        <tr>
                          <td>Ref</td>
                          <td>
                            {selectedTransaction.paymentDetails.transactionRef}
                          </td>
                        </tr>
                      )}
                      {selectedTransaction.paymentDetails.upiId && (
                        <tr>
                          <td>UPI ID</td>
                          <td>{selectedTransaction.paymentDetails.upiId}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedTransaction.auditTrail && (
                <div className={ledgerStyles.detailSection}>
                  <h3>Audit Trail</h3>
                  <ul>
                    {selectedTransaction.auditTrail.map((entry, idx) => (
                      <li key={idx}>
                        <strong>{entry.action}</strong> by {entry.user?.name} on{" "}
                        {formatDate(entry.timestamp)}
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
