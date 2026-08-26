"use client";
import { useState, useEffect, useRef } from "react";
import styles from "@/styles/MemberNotices.module.css";
const TYPE_ICONS = {
  maintenance: "🔧",
  meeting: "📅",
  water: "💧",
  electricity: "⚡",
  parking: "🚗",
  security: "🔒",
  event: "🎉",
  billing: "💰",
  custom: "📋",
};
const PRIORITY_COLORS = {
  low: { bg: "var(--bg-muted)", color: "var(--fg-3)", border: "var(--border)" },
  medium: { bg: "var(--primary-tint)", color: "var(--primary-hover)", border: "var(--accent)" },
  high: { bg: "var(--warning-bg)", color: "var(--warning-fg)", border: "#fcd34d" },
  urgent: { bg: "var(--danger-bg)", color: "var(--danger-fg)", border: "#fca5a5" },
};
export default function MemberNoticesPage() {
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const [toast, setToast] = useState(null);
  const [acknowledged, setAcknowledged] = useState(new Set());
  const viewedRef = useRef(new Set());
  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };
  const fetchNotices = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 20 });
      if (filterType !== "all") params.set("type", filterType);
      const res = await fetch(`/api/notices?${params}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        setNotices(data.notices);
        setPagination(data.pagination);
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    fetchNotices();
  }, [filterType, page]);
  // Auto mark-viewed using IntersectionObserver
  useEffect(() => {
    if (!notices.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.dataset.id;
            if (id && !viewedRef.current.has(id)) {
              viewedRef.current.add(id);
              fetch(`/api/notices/${id}/viewed`, {
                method: "POST",
                credentials: "include",
              }).catch(() => {});
            }
          }
        });
      },
      { threshold: 0.6 },
    );
    document
      .querySelectorAll("[data-id]")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [notices]);
  const handleAcknowledge = async (id) => {
    try {
      const res = await fetch(`/api/notices/${id}/acknowledge`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAcknowledged((prev) => new Set([...prev, id]));
      showToast("Acknowledged successfully!");
    } catch (err) {
      showToast(err.message, "error");
    }
  };
  const urgentNotices = notices.filter((n) => n.priority === "urgent");
  const pinnedNotices = notices.filter(
    (n) => n.pinned && n.priority !== "urgent",
  );
  const restNotices = notices.filter(
    (n) => !n.pinned && n.priority !== "urgent",
  );
  const TYPES = [
    "maintenance",
    "meeting",
    "water",
    "electricity",
    "parking",
    "security",
    "event",
    "billing",
    "custom",
  ];
  const NoticeCard = ({ n }) => {
    const pc = PRIORITY_COLORS[n.priority];
    const isAcknowledged = acknowledged.has(n._id);
    return (
      <div
        key={n._id}
        data-id={n._id}
        className={`${styles.card} ${n.priority === "urgent" ? styles.urgentCard : ""}`}
        style={{ borderLeftColor: pc.border }}
      >
        <div className={styles.cardTop}>
          <div className={styles.badges}>
            {n.pinned && <span className={styles.pinnedBadge}>📌</span>}
            <span className={styles.typeBadge}>
              {TYPE_ICONS[n.type]} {n.type}
            </span>
            <span
              className={styles.priorityBadge}
              style={{ background: pc.bg, color: pc.color }}
            >
              {n.priority}
            </span>
          </div>
          <span className={styles.time}>
            {new Date(n.createdAt).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </span>
        </div>
        <h3 className={styles.cardTitle}>{n.title}</h3>
        <p className={styles.cardDesc}>{n.description}</p>
        <div className={styles.cardFooter}>
          <span className={styles.author}>— {n.createdByName}</span>
          {n.expiresAt && (
            <span className={styles.expiry}>
              ⏳ Expires {new Date(n.expiresAt).toLocaleDateString("en-IN")}
            </span>
          )}
        </div>
        {/* Acknowledge button for urgent */}
        {n.priority === "urgent" && (
          <div className={styles.ackSection}>
            {isAcknowledged ? (
              <span className={styles.ackDone}>
                ✅ You acknowledged this notice
              </span>
            ) : (
              <button
                className={styles.ackBtn}
                onClick={() => handleAcknowledge(n._id)}
              >
                ✋ Acknowledge this Notice
              </button>
            )}
          </div>
        )}
      </div>
    );
  };
  return (
    <div className={styles.page}>
      {toast && (
        <div className={`${styles.toast} ${styles[toast.type]}`}>
          {toast.msg}
        </div>
      )}
      <div className={styles.pageHeader}>
        <h1>Notice Board</h1>
        <p>Stay updated with society announcements</p>
      </div>
      {/* Type filters */}
      <div className={styles.filters}>
        {["all", ...TYPES].map((t) => (
          <button
            key={t}
            onClick={() => {
              setFilterType(t);
              setPage(1);
            }}
            className={`${styles.filterBtn} ${filterType === t ? styles.filterActive : ""}`}
          >
            {t !== "all" && TYPE_ICONS[t]} {t}
          </button>
        ))}
      </div>
      {loading ? (
        <div className={styles.loading}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      ) : notices.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>📭</div>
          <p>No notices yet. Check back soon!</p>
        </div>
      ) : (
        <>
          {/* Urgent section */}
          {urgentNotices.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span
                  className={styles.sectionDot}
                  style={{ background: "var(--danger)" }}
                />
                🚨 Urgent Notices
              </div>
              {urgentNotices.map((n) => (
                <NoticeCard key={n._id} n={n} />
              ))}
            </div>
          )}
          {/* Pinned section */}
          {pinnedNotices.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span
                  className={styles.sectionDot}
                  style={{ background: "#4f46e5" }}
                />
                📌 Pinned
              </div>
              {pinnedNotices.map((n) => (
                <NoticeCard key={n._id} n={n} />
              ))}
            </div>
          )}
          {/* All other notices */}
          {restNotices.length > 0 && (
            <div className={styles.section}>
              {(urgentNotices.length > 0 || pinnedNotices.length > 0) && (
                <div className={styles.sectionHeader}>
                  <span
                    className={styles.sectionDot}
                    style={{ background: "var(--fg-5)" }}
                  />
                  All Notices
                </div>
              )}
              {restNotices.map((n) => (
                <NoticeCard key={n._id} n={n} />
              ))}
            </div>
          )}
        </>
      )}
      {pagination.pages > 1 && (
        <div className={styles.pagination}>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Prev
          </button>
          <span>
            Page {page} of {pagination.pages}
          </span>
          <button
            disabled={page >= pagination.pages}
            onClick={() => setPage(page + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
