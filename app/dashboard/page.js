"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";

export default function DashboardPage() {
  const { data: societyData, isLoading: loadingSociety } = useQuery({
    queryKey: ["society-config"],
    queryFn: () => apiClient.get("/api/society/config"),
  });

  const { data: membersData, isLoading: loadingMembers } = useQuery({
    queryKey: ["members-list"],
    queryFn: () => apiClient.get("/api/members/list?limit=1000"),
  });

  if (loadingSociety) {
    return (
      <div
        style={{ display: "flex", justifyContent: "center", padding: "40px" }}
      >
        <div className="loading-spinner"></div>
      </div>
    );
  }

  const society = societyData?.society;
  const members = membersData?.members || [];

  return (
    <div>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Dashboard</h1>
        <p className={styles.pageSubtitle}>
          Welcome to {society?.name || "Your Society"}
        </p>
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Total Members</div>
          <h2 className={styles.statValue}>
            {loadingMembers ? "..." : members.length}
          </h2>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statLabel}>Maintenance Rate</div>
          <h2 className={styles.statValue}>
            ₹{society?.config?.maintenanceRate || 0}/sq.ft
          </h2>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statLabel}>Interest Rate</div>
          <h2 className={styles.statValue}>
            {society?.config?.interestRate || 0}%
          </h2>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statLabel}>Grace Period</div>
          <h2 className={styles.statValue}>
            {society?.config?.gracePeriodDays || 0} days
          </h2>
        </div>
      </div>

      <div className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Quick Actions</h2>
        </div>
        <div className={styles.pageActions}>
          <button className="btn btn-primary">Generate Monthly Bills</button>
          <button className="btn btn-secondary">View Ledger</button>
          <button className="btn btn-secondary">Record Payment</button>
          <button className="btn btn-secondary">Download Reports</button>
        </div>
      </div>

      {society?.billingHeads && society.billingHeads.length > 0 && (
        <div className={styles.contentCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Billing Configuration</h2>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--spacing-sm)",
            }}
          >
            {society.billingHeads.map((head, index) => (
              <span key={index} className="badge badge-info">
                {head.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
