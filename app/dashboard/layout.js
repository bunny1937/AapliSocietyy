"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getAuthUser, clearAuthData } from "@/lib/auth-utils";
import styles from "@/styles/Dashboard.module.css";

const getNavigationByRole = (role) => {
  if (role === "Member") {
    return [
      {
        title: "Overview",
        items: [{ name: "Dashboard", path: "/dashboard", icon: "📊" }],
      },
      {
        title: "My Account",
        items: [
          { name: "My Profile", path: "/dashboard/profile", icon: "👤" },
          { name: "My Bills", path: "/dashboard/my-bills", icon: "📄" },
          { name: "My Ledger", path: "/dashboard/my-ledger", icon: "📒" },
          {
            name: "Make Payment",
            path: "/dashboard/make-payment",
            icon: "💳",
          },
        ],
      },
    ];
  }

  return [
    {
      title: "Overview",
      items: [{ name: "Dashboard", path: "/dashboard", icon: "📊" }],
    },
    {
      title: "Configuration",
      items: [
        {
          name: "Society Config",
          path: "/dashboard/society-config",
          icon: "⚙️",
        },
        {
          name: "Matrix Config",
          path: "/dashboard/matrix-config",
          icon: "📋",
        },
        {
          name: "DB Manager",
          path: "/dashboard/database-manager",
          icon: "📋",
        },
      ],
    },
    {
      title: "Members",
      items: [
        {
          name: "Import Members",
          path: "/dashboard/import-members",
          icon: "📥",
        },
          {
          name: "View Members",
          path: "/dashboard/view-members",
          icon: "📥",
        },
      ],
    },
    {
      title: "Billing",
      items: [
                { name: "Billing Template", path: "/dashboard/bill-template", icon: "📝" },

        { name: "Billing Grid", path: "/dashboard/billing-grid", icon: "🧮" },
        {
          name: "Generate Bills",
          path: "/dashboard/generate-bills",
          icon: "📄",
        },
      ],
    },
    {
      title: "Transactions",
      items: [
        { name: "Ledger", path: "/dashboard/ledger", icon: "📖" },
        { name: "Payments", path: "/dashboard/payments", icon: "💳" },
      ],
    },
  ];
};

export default function DashboardLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(null);

  useEffect(() => {
    const userData = getAuthUser();
    if (!userData) {
      router.push("/auth/login");
    } else {
      setUser(userData);
    }
  }, [router]);

  const handleLogout = () => {
    clearAuthData();
    router.push("/auth/login");
  };

  // Show loading while user is being fetched
  if (!user) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <div className="loading-spinner"></div>
      </div>
    );
  }

  const navigation = getNavigationByRole(user.role);

  if (!user) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div className={styles.dashboardContainer}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <h1 className={styles.sidebarTitle}>NexGen ERP</h1>
          <p className={styles.sidebarSubtitle}>Society Management</p>
        </div>

        <nav className={styles.sidebarNav}>
          {navigation.map((group, groupIndex) => (
            <div key={groupIndex} className={styles.navGroup}>
              <div className={styles.navGroupTitle}>{group.title}</div>
              {group.items.map((item) => (
                <div
                  key={item.path}
                  className={`${styles.navItem} ${
                    pathname === item.path ? styles.navItemActive : ""
                  }`}
                  onClick={() => router.push(item.path)}
                >
                  <span className={styles.navIcon}>{item.icon}</span>
                  <span>{item.name}</span>
                </div>
              ))}
            </div>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.userInfo}>
            <div className={styles.userAvatar}>
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className={styles.userDetails}>
              <div className={styles.userName}>{user.name}</div>
              <div className={styles.userRole}>{user.role}</div>
            </div>
            <button
              className={styles.logoutBtn}
              onClick={handleLogout}
              title="Logout"
            >
              🚪
            </button>
          </div>
        </div>
      </aside>

      <main className={styles.mainContent}>{children}</main>
    </div>
  );
}
