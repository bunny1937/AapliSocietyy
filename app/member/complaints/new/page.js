"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/styles/CreateComplaint.module.css";
const CATEGORIES = [
  { value: "noise", label: "🔊 Noise" },
  { value: "parking", label: "🚗 Parking" },
  { value: "water", label: "💧 Water" },
  { value: "security", label: "🔒 Security" },
  { value: "cleanliness", label: "🧹 Cleanliness" },
  { value: "maintenance", label: "🔧 Maintenance" },
  { value: "billing", label: "💰 Billing" },
  { value: "staff", label: "👷 Staff" },
  { value: "pets", label: "🐾 Pets" },
  { value: "other", label: "📋 Other" },
];
export default function CreateComplaintPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    category: "",
    title: "",
    description: "",
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };
  const validate = () => {
    const e = {};
    if (!form.category) e.category = "Please select a category";
    if (!form.title || form.title.length < 10)
      e.title = "Title must be at least 10 characters";
    if (form.title.length > 120) e.title = "Title must be under 120 characters";
    if (!form.description || form.description.length < 30)
      e.description = "Description must be at least 30 characters";
    if (form.description.length > 1000)
      e.description = "Description must be under 1000 characters";
    return e;
  };
  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) return setErrors(errs);
    setErrors({});
    setLoading(true);
    try {
      const res = await fetch("/api/complaints", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit");
      showToast("Complaint submitted anonymously! It is now pending review.");
      setTimeout(() => router.push("/member/complaints/my"), 1500);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className={styles.page}>
      {toast && (
        <div className={`${styles.toast} ${styles[toast.type]}`}>
          {toast.msg}
        </div>
      )}
      <div className={styles.card}>
        <div className={styles.header}>
          <h1>Submit a Complaint</h1>
          <p>
            Your identity will remain anonymous publicly. Admin reviews before
            it goes live.
          </p>
        </div>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label>Category *</label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className={errors.category ? styles.inputError : ""}
            >
              <option value="">-- Select Category --</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            {errors.category && (
              <span className={styles.error}>{errors.category}</span>
            )}
          </div>
          <div className={styles.field}>
            <label>
              Title *{" "}
              <span className={styles.hint}>{form.title.length}/120</span>
            </label>
            <input
              type="text"
              value={form.title}
              maxLength={120}
              placeholder="Brief title (10–120 characters)"
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className={errors.title ? styles.inputError : ""}
            />
            {errors.title && (
              <span className={styles.error}>{errors.title}</span>
            )}
          </div>
          <div className={styles.field}>
            <label>
              Description *{" "}
              <span className={styles.hint}>
                {form.description.length}/1000
              </span>
            </label>
            <textarea
              value={form.description}
              maxLength={1000}
              rows={6}
              placeholder="Describe the issue clearly (30–1000 characters). Do not include phone numbers, emails, or links."
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              className={errors.description ? styles.inputError : ""}
            />
            {errors.description && (
              <span className={styles.error}>{errors.description}</span>
            )}
          </div>
          <div className={styles.notice}>
            🔒 Your complaint is submitted anonymously as a random pseudonym.
            Max 2 per day, 15 min cooldown.
          </div>
          <div style={{ background: "var(--warning-bg)", border: "1px solid var(--warning)", borderRadius: "8px", padding: "12px 16px", fontSize: "0.85rem", color: "var(--warning-fg)", marginBottom: "1rem" }}>
            🔒 Complaint submission is currently disabled. Contact your society admin directly.
          </div>
          <button type="submit" className={styles.submitBtn} disabled style={{ opacity: 0.5, cursor: "not-allowed" }}>
            Submit Complaint
          </button>
        </form>
      </div>
    </div>
  );
}
