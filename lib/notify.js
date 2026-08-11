"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import styles from "@/styles/Dashboard.module.css";
export default function DashboardLayout({
  children,
  role,
  navigation,
  title,
  subtitle,
  withQueryClient = false,
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            cacheTime: 10 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnMount: false,
            retry: 1,
          },
        },
      }),
  );
  useEffect(() => {
    if (pathname.includes("/auth/login")) return;
    const fetchUser = async () => {
      try {
        const res = await fetch("/api/auth/me", {
          credentials: "include",
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setUser(data.user);
      } catch {
        // 🔥 DO NOT redirect if already on login page
        if (!pathname.includes("/auth/login")) {
          // Route to correct login based on current path
          if (pathname.startsWith("/security")) {
            window.location.href = "/security/login";
          } else {
            window.location.href = "/auth/login";
          }
        }
      }
    };
    fetchUser();
  }, []);
  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/auth/login");
  };
  if (!user) {
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div className="loading-spinner"></div>
      </div>
    );
  }
  const LayoutUI = (
    <div className={styles.dashboardContainer}>
      {/* SIDEBAR */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <h1 className={styles.sidebarTitle}>{title}</h1>
          <p className={styles.sidebarSubtitle}>{subtitle}</p>
        </div>
        <nav className={styles.sidebarNav}>
          {navigation.map((group, i) => (
            <div key={i} className={styles.navGroup}>
              <div className={styles.navGroupTitle}>{group.title}</div>
              {group.items.map((item) => (
                <div
                  key={item.path}
                  className={`${styles.navItem} ${
                    pathname.startsWith(item.path) ? styles.navItemActive : ""
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
        {/* FOOTER */}
        <div className={styles.sidebarFooter}>
          <div className={styles.userInfo}>
            <div className={styles.userAvatar}>
              {user.name?.charAt(0)?.toUpperCase()}
            </div>
            <div className={styles.userDetails}>
              <div className={styles.userName}>{user.name}</div>
              <div className={styles.userRole}>{user.role}</div>
            </div>
            <button className={styles.logoutBtn} onClick={handleLogout}>
              🚪
            </button>
          </div>
        </div>
      </aside>
      {/* MAIN */}
      <main className={styles.mainContent}>{children}</main>
    </div>
  );
  let EnhancedUI = LayoutUI;
  // 🔥 SUPERADMIN EXTRA LAYER
  if (role === "SuperAdmin") {
    EnhancedUI = (
      <>
        {/* Optional: global banner / debug */}
        {LayoutUI}
      </>
    );
  }
  return withQueryClient ? (
    <QueryClientProvider client={queryClient}>{EnhancedUI}</QueryClientProvider>
  ) : (
    EnhancedUI
  );
}
