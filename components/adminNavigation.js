"use client";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Settings,
  Database,
  UserPlus,
  Users,
  FileText,
  Upload,
  Eye,
  FileSpreadsheet,
  ClipboardList,
  BookOpen,
  CreditCard,
  AlertTriangle,
  BarChart3,
  Wallet,
  Megaphone,
  MessageSquare,
  UserCheck,
  FileEdit,
  Zap,
  TrendingUp,
  ClipboardCheck,
  FlaskConical,
  Shield,
  KeyRound,
} from "lucide-react";

// Shared between app/admin/layout.js and app/my-access/page.js — the latter
// is intentionally outside /admin (it must render even for a role granted
// nothing yet) but still needs the same sidebar chrome/nav.
export const ADMIN_NAVIGATION = [
  {
    title: "Overview",
    items: [
      { name: "Dashboard", path: "/admin/dashboard", pageKey: "dashboard", icon: <LayoutDashboard size={16} /> },
    ],
  },
  {
    title: "Configuration",
    items: [
      { name: "Society Config", path: "/admin/society-config", pageKey: "societyConfig", icon: <Settings size={16} /> },
      { name: "DB Manager", path: "/admin/database-manager", pageKey: "databaseManager", icon: <Database size={16} /> },
    ],
  },
  {
    title: "Members",
    items: [
      { name: "Import Members", path: "/admin/import-members", pageKey: "importMembers", icon: <UserPlus size={16} /> },
      { name: "View Members", path: "/admin/view-members", pageKey: "viewMembers", icon: <Users size={16} /> },
      { name: "Tenant Requests", path: "/admin/tenant-requests", pageKey: "tenantRequests", icon: <UserCheck size={16} /> },
      { name: "Profile Changes", path: "/admin/profile-edit-requests", pageKey: "profileEditRequests", icon: <FileEdit size={16} /> },
    ],
  },
  {
    title: "Billing",
    items: [
      { name: "Billing Template", path: "/admin/bill-template", pageKey: "billTemplate", icon: <FileText size={16} /> },
      { name: "Import Bills", path: "/admin/import-bills", pageKey: "importBills", icon: <Upload size={16} /> },
      { name: "Billing Config", path: "/admin/billing-config", pageKey: "billingConfig", icon: <Settings size={16} /> },
      { name: "View Bills", path: "/admin/view-bills", pageKey: "viewBills", icon: <Eye size={16} /> },
      { name: "Generate Bills", path: "/admin/generate-bills", pageKey: "generateBills", icon: <FileSpreadsheet size={16} /> },
      { name: "Audit Report", path: "/admin/audit", pageKey: "auditReport", icon: <ClipboardList size={16} /> },
    ],
  },
  {
    title: "tests",
    items: [
      { name: "Test Page", path: "/admin/accounting-lab", pageKey: "systemTests", icon: <ClipboardList size={16} /> },
      { name: "Load Test Lab", path: "/admin/loadtest-lab", pageKey: "systemTests", icon: <FlaskConical size={16} /> },
    ],
  },
  {
    title: "Financial Statements",
    items: [
      { name: "Opening Balances", path: "/admin/opening-balances", pageKey: "openingBalances", icon: <Database size={16} /> },
      { name: "Generate Statements", path: "/admin/generate-statements", pageKey: "generateStatements", icon: <Zap size={16} /> },
      { name: "Income & Expenditure", path: "/admin/income-expenditure", pageKey: "incomeExpenditure", icon: <TrendingUp size={16} /> },
      { name: "Assets & Liabilities", path: "/admin/assets-liabilities", pageKey: "assetsLiabilities", icon: <BarChart3 size={16} /> },
      { name: "Trial Balance & Validation", path: "/admin/other-statements", pageKey: "otherStatements", icon: <ClipboardCheck size={16} /> },
    ],
  },
  {
    title: "Transactions",
    items: [
      { name: "Ledger", path: "/admin/ledger", pageKey: "ledger", icon: <BookOpen size={16} /> },
      { name: "Payments", path: "/admin/payments", pageKey: "payments", icon: <CreditCard size={16} /> },
      { name: "Receipts", path: "/admin/receipts", pageKey: "receipts", icon: <FileText size={16} /> },
      { name: "Late Payments", path: "/admin/late-payment", pageKey: "latePayment", icon: <AlertTriangle size={16} /> },
      { name: "Balance Sheet", path: "/admin/balance-sheet", pageKey: "balanceSheet", icon: <BarChart3 size={16} /> },
      { name: "Expenditure", path: "/admin/expenditure", pageKey: "expenditure", icon: <Wallet size={16} /> },
    ],
  },
  {
    title: "Communication",
    items: [
      { name: "Notices", path: "/admin/notices", pageKey: "notices", icon: <Megaphone size={16} /> },
      { name: "Complaints", path: "/admin/complaints", pageKey: "complaints", icon: <MessageSquare size={16} /> },
    ],
  },
  {
    title: "Security",
    items: [
      { name: "Visitors", path: "/admin/visitors", pageKey: "visitors", icon: "🚪" },
      { name: "Active Visitors", path: "/admin/visitors/active", pageKey: "visitorsActive", icon: "🟢" },
      { name: "Visitor Log", path: "/admin/visitors/log", pageKey: "visitorsLog", icon: "📋" },
      { name: "Security Guards", path: "/admin/security-guards", pageKey: "securityGuards", icon: "👮" },
      { name: "Offline Audit", path: "/admin/visitors/audit", pageKey: "visitorsAudit", icon: "🗂️" },
      { name: "Watchlist", path: "/admin/blacklist", pageKey: "blacklist", icon: "⛔" },
    ],
  },
  {
    title: "Amenities",
    items: [
      { name: "Overview", path: "/admin/amenities", pageKey: "amenities", icon: "🏠" },
      { name: "Categories", path: "/admin/amenities/categories", pageKey: "amenities", icon: "🗂️" },
      { name: "All Amenities", path: "/admin/amenities/list", pageKey: "amenities", icon: "🏊" },
      { name: "Maintenance", path: "/admin/amenities/maintenance", pageKey: "amenities", icon: "🔧" },
      { name: "Attendance", path: "/admin/amenities/attendance", pageKey: "amenities", icon: "✅" },
      { name: "Events", path: "/admin/amenities/events", pageKey: "amenities", icon: "🎉" },
      { name: "Analytics", path: "/admin/amenities/analytics", pageKey: "amenities", icon: "📊" },
      { name: "Incidents", path: "/admin/amenities/incidents", pageKey: "amenities", icon: "⚠️" },
      { name: "Settings", path: "/admin/amenities/settings", pageKey: "amenities", icon: "⚙️" },
    ],
  },
  {
    title: "Administration",
    items: [
      { name: "Roles & Access", path: "/admin/rbac/roles", pageKey: "roleManager", icon: <Shield size={16} /> },
      // Always visible — every authenticated user (including a role granted
      // nothing yet) can see their own access here. Not gated by pageKey.
      { name: "My Access", path: "/my-access", pageKey: null, icon: <KeyRound size={16} /> },
    ],
  },
];

export const COMMERCIAL_NAVIGATION = {
  title: "Commercial",
  items: [
    { name: "Shops & offices", path: "/admin/commercial/shops", pageKey: "commercial", icon: "🏪" },
    { name: "Rate card", path: "/admin/commercial/rate-card", pageKey: "commercial", icon: "💰" },
    { name: "Categories", path: "/admin/commercial/categories", pageKey: "commercial", icon: "🏷️" },
    { name: "Overview", path: "/admin/commercial", pageKey: "commercial", icon: "📊" },
  ],
};

/**
 * Fetches the caller's page-access set and returns the nav filtered to what
 * they can actually see. `null` while loading (nothing rendered, never a
 * flash of unauthorized links). Items with pageKey:null (e.g. "My Access")
 * always render — everyone can reach their own access page.
 */
// Module-level cache: every page on the admin side mounts this hook fresh on
// navigation. Without a shared cache, each nav re-fetched my-access from
// scratch and rendered the sidebar as empty (allowedPages=null) until it
// came back — the sidebar visibly disappeared and rebuilt on every click.
// Cached result hydrates instantly; a background revalidation keeps it
// correct after a role change without ever blanking the nav in between.
let navCache = null; // { allowedPages } | null
let navCachePromise = null;

function toAllowedPages(d) {
  if (!d || d.error) return new Set();
  if (d.bootstrapped === false) return "all";
  return new Set(
    (d.pages || [])
      .filter((p) => p.level === "view" || p.level === "manage")
      .map((p) => p.key),
  );
}

export function useVisibleAdminNavigation({ commercialEnabled = false } = {}) {
  const [allowedPages, setAllowedPages] = useState(
    navCache ? navCache.allowedPages : null,
  );
  useEffect(() => {
    let alive = true;
    if (!navCachePromise) {
      navCachePromise = fetch("/api/rbac/my-access", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const resolved = toAllowedPages(d);
          navCache = { allowedPages: resolved };
          return resolved;
        })
        .catch(() => {
          const resolved = new Set();
          navCache = { allowedPages: resolved };
          return resolved;
        });
    }
    navCachePromise.then((resolved) => {
      if (alive) setAllowedPages(resolved);
    });
    return () => {
      alive = false;
    };
  }, []);

  const navigation = commercialEnabled
    ? [...ADMIN_NAVIGATION.slice(0, -1), COMMERCIAL_NAVIGATION, ADMIN_NAVIGATION[ADMIN_NAVIGATION.length - 1]]
    : ADMIN_NAVIGATION;

  const visibleNavigation =
    allowedPages === null
      ? []
      : allowedPages === "all"
        ? navigation
        : navigation
            .map((group) => ({
              ...group,
              items: group.items.filter(
                (item) => item.pageKey === null || allowedPages.has(item.pageKey),
              ),
            }))
            .filter((group) => group.items.length > 0);

  return { visibleNavigation, loading: allowedPages === null };
}
