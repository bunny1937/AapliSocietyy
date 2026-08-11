"use client";
import { useState, useEffect } from "react";
import styles from "@/styles/AdminComplaints.module.css";
const STATUS_TABS = ["PENDING", "APPROVED", "REJECTED", "CLOSED", "all"];
const CATEGORIES = [
  "all",
  "noise",
  "parking",
  "water",
  "security",
  "cleanliness",
  "maintenance",
  "billing",
  "staff",
  "pets",
  "other",
];
export default function AdminComplaintsPage() {
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusTab, setStatusTab] = useState("PENDING");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const [rejectModal, setRejectModal] = useState(null); // { id, reason }
  const [toast, setToast] = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };
  const fetchComplaints = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: statusTab,
        page,
        limit: 15,
      });
      if (category !== "all") params.set("category", category);
      const res = await fetch(`/api/complaints/admin?${params}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        setComplaints(data.complaints);
        setPagination(data.pagination);
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    fetchComplaints();
  }, [statusTab, category, page]);
  const handleApprove = async (id) => {
    setActionLoading({ ...actionLoading, [id]: true });
    try {
      const res = await fetch(`/api/complaints/admin/${id}/approve`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast("Complaint approved and now visible society-wide");
      fetchComplaints();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setActionLoading({ ...actionLoading, [id]: false });
    }
  };
  const handleReject = async () => {
    if (!rejectModal) return;
    const { id, reason } = rejectModal;
    if (!reason || reason.trim().length < 120) {
      return showToast(
        "Rejection reason must be at least 120 characters",
        "error",
      );
    }
    setActionLoading({ ...actionLoading, [id]: true });
    try {
      const res = await fetch(`/api/complaints/admin/${id}/reject`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast("Complaint rejected");
      setRejectModal(null);
      fetchComplaints();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setActionLoading({ ...actionLoading, [id]: false });
    }
  };
  const STATUS_COLOR = {
    PENDING: "#f59e0b",
    APPROVED: "#10b981",
    REJECTED: "#ef4444",
    CLOSED: "#6b7280",
    EXPIRED: "#6b7280",
  };
  return (
    <div className={styles.page}>
      {toast && (
        <div className={`${styles.toast} ${styles[toast.type]}`}>
          {toast.msg}
        </div>
      )}
      <div className={styles.pageHeader}>
        <h1>Complaints Moderation</h1>
        <p>Review, approve, or reject community complaints</p>
      </div>
      {/* Status tabs */}
      <div className={styles.tabs}>
        {STATUS_TABS.map((s) => (
          <button
            key={s}
            className={`${styles.tab} ${statusTab === s ? styles.tabActive : ""}`}
            onClick={() => {
              setStatusTab(s);
              setPage(1);
            }}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      {/* Category filter */}
      <div className={styles.catFilter}>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            className={`${styles.catBtn} ${category === c ? styles.catActive : ""}`}
            onClick={() => {
              setCategory(c);
              setPage(1);
            }}
          >
            {c}
          </button>
        ))}
      </div>
      {loading ? (
        <div className={styles.loading}>
          {[1, 2, 3].map((i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      ) : complaints.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>✅</div>
          <p>No complaints in this queue.</p>
        </div>
      ) : (
        <div className={styles.list}>
          {complaints.map((c) => (
            <div key={c._id} className={styles.card}>
              <div className={styles.cardTop}>
                <div className={styles.cardMeta}>
                  <span
                    className={styles.statusDot}
                    style={{ background: STATUS_COLOR[c.status] }}
                  />
                  <strong>{c.anonymousName}</strong>
                  <span className={styles.separator}>·</span>
                  <span className={styles.category}>{c.category}</span>
                  <span className={styles.separator}>·</span>
                  <span className={styles.date}>
                    {new Date(c.createdAt).toLocaleDateString("en-IN")}
                  </span>
                </div>
              </div>
              {/* Admin sees real identity */}
              {c.member && (
                <div className={styles.memberInfo}>
                  👤 {c.member.ownerName} · {c.member.wing}-{c.member.flatNo} ·{" "}
                  {c.member.contactNumber}
                </div>
              )}
              <h3 className={styles.cardTitle}>{c.title}</h3>
              <p className={styles.cardDesc}>{c.description}</p>
              {c.status === "PENDING" && (
                <div className={styles.actions}>
                  <button
                    className={styles.approveBtn}
                    disabled={actionLoading[c._id]}
                    onClick={() => handleApprove(c._id)}
                  >
                    ✓ Approve
                  </button>
                  <button
                    className={styles.rejectBtn}
                    onClick={() => setRejectModal({ id: c._id, reason: "" })}
                  >
                    ✗ Reject
                  </button>
                </div>
              )}
              {c.adminRejectionReason && (
                <div className={styles.rejectionNote}>
                  <strong>Rejection reason:</strong> {c.adminRejectionReason}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {pagination.pages > 1 && (
        <div className={styles.pagination}>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Prev
          </button>
          <span>
            {page} / {pagination.pages}
          </span>
          <button
            disabled={page >= pagination.pages}
            onClick={() => setPage(page + 1)}
          >
            Next →
          </button>
        </div>
      )}
      {/* Reject Modal */}
      {rejectModal && (
        <div
          className={styles.modalOverlay}
          onClick={() => setRejectModal(null)}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2>Reject Complaint</h2>
            <p className={styles.modalNote}>
              Reason must be 120–500 characters. Member will see this reason.
            </p>
            <textarea
              rows={6}
              placeholder="Explain why this complaint is being rejected... (min 120 chars)"
              value={rejectModal.reason}
              onChange={(e) =>
                setRejectModal({ ...rejectModal, reason: e.target.value })
              }
              className={styles.reasonInput}
            />
            <div className={styles.charCount}>
              {rejectModal.reason.length} / 500
              {rejectModal.reason.length < 120 && (
                <span className={styles.charWarn}>
                  {" "}
                  (need {120 - rejectModal.reason.length} more)
                </span>
              )}
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.cancelBtn}
                onClick={() => setRejectModal(null)}
              >
                Cancel
              </button>
              <button
                className={styles.confirmRejectBtn}
                disabled={rejectModal.reason.length < 120}
                onClick={handleReject}
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
