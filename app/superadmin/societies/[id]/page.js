"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import styles from "./SocietyDetail.module.css";
import { adminApi } from "@/lib/admin-api";
import notify from "@/lib/notify";
export default function SocietyDetail() {
  const [activeTab, setActiveTab] = useState("overview");
  const router = useRouter();
  const params = useParams();
  const queryClient = useQueryClient();
  const societyId = params.id;
  // Superadmin auth check via cookie
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if ((d.user || d)?.role !== "SuperAdmin") router.replace("/superadmin/login");
      })
      .catch(() => router.replace("/superadmin/login"));
  }, [router]);
  // ✅ Fetch society (cached for 5 min)
  const { data: societyData, isLoading: societyLoading } = useQuery({
    queryKey: ["society", societyId],
    queryFn: () => adminApi.fetchSociety(societyId),
    staleTime: 5 * 60 * 1000,
  });
  // ✅ Fetch members (cached, only when tab active)
  const { data: membersData } = useQuery({
    queryKey: ["society-data", societyId, "members"],
    queryFn: () => adminApi.fetchData(societyId, "members"),
    staleTime: 5 * 60 * 1000,
    enabled: activeTab === "members",
  });
  // ✅ Fetch bills (cached, only when tab active)
  const { data: billsData } = useQuery({
    queryKey: ["society-data", societyId, "bills"],
    queryFn: () => adminApi.fetchData(societyId, "bills"),
    staleTime: 5 * 60 * 1000,
    enabled: activeTab === "bills",
  });
  // ✅ Fetch transactions (cached, only when tab active)
  const { data: txnData } = useQuery({
    queryKey: ["society-data", societyId, "transactions"],
    queryFn: () => adminApi.fetchData(societyId, "transactions"),
    staleTime: 5 * 60 * 1000,
    enabled: activeTab === "transactions",
  });
  // ✅ Mutation for updates (auto-invalidates cache)
  const updateMutation = useMutation({
    mutationFn: (updates) => adminApi.updateSociety(societyId, updates),
    onSuccess: () => {
      // Invalidate cache to refetch fresh data
      queryClient.invalidateQueries(["society", societyId]);
      queryClient.invalidateQueries(["admin-societies"]);
      notify.success("Society updated successfully");
    },
  });
  const handleSuspend = async () => {
    if (
      !(await notify.confirm(
        "Suspend this society? They will lose access immediately.",
        { tone: "warning" },
      ))
    )
      return;
    updateMutation.mutate({ "subscription.status": "Suspended" });
  };
  const handleActivate = () => {
    updateMutation.mutate({ "subscription.status": "Active" });
  };
  const society = societyData?.society;
  const members = membersData?.data || [];
  const bills = billsData?.data || [];
  const transactions = txnData?.data || [];
  if (societyLoading) {
    return <div className={styles.loading}>Loading society...</div>;
  }
  if (!society) {
    return <div className={styles.error}>Society not found</div>;
  }
  return (
    <div className={styles.container}>
      <button
        onClick={() => router.push("/superadmin/societies")}
        className={styles.backBtn}
      >
        ← Back to Dashboard
      </button>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1>{society.name}</h1>
          <p className={styles.regNo}>
            Reg: {society.registrationNo || "N/A"} · ⚡ Cached data
          </p>
        </div>
        <div className={styles.headerActions}>
          <span
            className={`${styles.badge} ${styles[society.subscription?.status || "Trial"]}`}
          >
            {society.subscription?.status || "Trial"}
          </span>
          {society.subscription?.status === "Active" ? (
            <button
              onClick={handleSuspend}
              className={styles.suspendBtn}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Updating..." : "Suspend"}
            </button>
          ) : (
            <button
              onClick={handleActivate}
              className={styles.activateBtn}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Updating..." : "Activate"}
            </button>
          )}
        </div>
      </div>
      {/* Stats Grid */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statIcon}>👥</div>
          <div>
            <h3>Members</h3>
            <p className={styles.statValue}>{members.length}</p>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statIcon}>📄</div>
          <div>
            <h3>Bills</h3>
            <p className={styles.statValue}>{bills.length}</p>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statIcon}>💰</div>
          <div>
            <h3>Transactions</h3>
            <p className={styles.statValue}>{transactions.length}</p>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statIcon}>💳</div>
          <div>
            <h3>Total Paid</h3>
            <p className={styles.statValue}>
              ₹{(society.subscription?.amountPaid || 0).toLocaleString()}
            </p>
          </div>
        </div>
      </div>
      {/* Society Info */}
      <div className={styles.infoSection}>
        <h2>Society Information</h2>
        <div className={styles.infoGrid}>
          <div className={styles.infoItem}>
            <label>Address:</label>
            <span>{society.address || "Not provided"}</span>
          </div>
          <div className={styles.infoItem}>
            <label>Email:</label>
            <span>{society.contactEmail || "Not provided"}</span>
          </div>
          <div className={styles.infoItem}>
            <label>Phone:</label>
            <span>{society.contactPhone || "Not provided"}</span>
          </div>
          <div className={styles.infoItem}>
            <label>Plan Type:</label>
            <span>{society.subscription?.planType || "Free"}</span>
          </div>
          <div className={styles.infoItem}>
            <label>Last Payment:</label>
            <span>
              {society.subscription?.lastPaymentDate
                ? new Date(
                    society.subscription.lastPaymentDate,
                  ).toLocaleDateString()
                : "Never"}
            </span>
          </div>
          <div className={styles.infoItem}>
            <label>Config Version:</label>
            <span>v{society.configVersion || 1}</span>
          </div>
        </div>
      </div>
      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={activeTab === "overview" ? styles.activeTab : ""}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        <button
          className={activeTab === "members" ? styles.activeTab : ""}
          onClick={() => setActiveTab("members")}
        >
          Members ({members.length})
        </button>
        <button
          className={activeTab === "bills" ? styles.activeTab : ""}
          onClick={() => setActiveTab("bills")}
        >
          Bills ({bills.length})
        </button>
        <button
          className={activeTab === "transactions" ? styles.activeTab : ""}
          onClick={() => setActiveTab("transactions")}
        >
          Transactions ({transactions.length})
        </button>
      </div>
      {/* Tab Content */}
      <div className={styles.tabContent}>
        {activeTab === "overview" && (
          <div className={styles.overview}>
            <h3>Recent Activity</h3>
            <p>
              Last login:{" "}
              {society.lastLoginAt
                ? new Date(society.lastLoginAt).toLocaleString()
                : "Never"}
            </p>
            <p>Created: {new Date(society.createdAt).toLocaleDateString()}</p>
          </div>
        )}
        {activeTab === "members" && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Flat</th>
                <th>Contact</th>
                <th>Area (sq ft)</th>
                <th>Ownership</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member._id}>
                  <td>{member.ownerName}</td>
                  <td>
                    {member.wing}-{member.roomNo}
                  </td>
                  <td>{member.contact}</td>
                  <td>{member.areaSqFt}</td>
                  <td>{member.ownershipType}</td>
                  <td>
                    <button
                      style={{
                        background: member.isActive ? "var(--success)" : "var(--danger)",
                        color: "#fff",
                        border: "none",
                        padding: "4px 10px",
                        borderRadius: 4,
                        cursor: "pointer",
                      }}
                      onClick={() =>
                        updateMutation.mutate({
                          memberId: member._id,
                          isActive: !member.isActive,
                        })
                      }
                    >
                      {member.isActive ? "Active" : "Inactive"}
                    </button>
                  </td>{" "}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {activeTab === "bills" && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Member</th>
                <th>Period</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {bills.slice(0, 50).map((bill) => (
                <tr key={bill._id}>
                  <td>
                    {bill.memberId?.wing}-{bill.memberId?.roomNo}
                  </td>
                  <td>{bill.billPeriodId}</td>
                  <td>₹{bill.totalAmount}</td>
                  <td>
                    <span className={`${styles.badge} ${styles[bill.status]}`}>
                      {bill.status}
                    </span>
                  </td>
                  <td>{new Date(bill.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {activeTab === "transactions" && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Member</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Date</th>
                <th>Method</th>
              </tr>
            </thead>
            <tbody>
              {transactions.slice(0, 50).map((txn) => (
                <tr key={txn._id}>
                  <td>
                    {txn.memberId?.wing}-{txn.memberId?.roomNo}
                  </td>
                  <td>{txn.type}</td>
                  <td>₹{txn.amount}</td>
                  <td>{new Date(txn.date).toLocaleDateString()}</td>
                  <td>{txn.paymentMethod}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
