"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "@/styles/Auth.module.css";
function SetCredentialsForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [details, setDetails] = useState(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (!token) {
      setLoadError("This link is missing its token.");
      setLoading(false);
      return;
    }
    fetch(`/api/onboarding/verify?token=${encodeURIComponent(token)}`)
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          setLoadError(data.error || "This link is invalid or has expired.");
        } else {
          setDetails(data);
        }
      })
      .catch(() => setLoadError("Could not verify this link. Check your connection and try again."))
      .finally(() => setLoading(false));
  }, [token]);
  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    if (!username.trim() || !email.trim() || !password) {
      setFormError("All fields are required.");
      return;
    }
    if (password !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/onboarding/set-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, username: username.trim(), email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Something went wrong.");
        return;
      }
      router.replace("/auth/login?onboarded=1");
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className={styles.authContainer}>
      <div className={styles.authCard}>
        <div className={styles.authHeader}>
          <div className={styles.authLogoMark}>N</div>
          <h1 className={styles.authTitle}>Set up your account</h1>
          <p className={styles.authSubtitle}>
            {details ? `Welcome, ${details.name} — ${details.societyName}` : "Verifying your link…"}
          </p>
        </div>
        {loading && <p style={{ textAlign: "center", color: "var(--text-secondary)" }}>Loading…</p>}
        {!loading && loadError && (
          <div
            style={{
              padding: "12px",
              backgroundColor: "var(--danger-bg)",
              color: "var(--danger-fg)",
              borderRadius: "var(--radius-md)",
              fontSize: "var(--font-sm)",
              fontWeight: 500,
            }}
          >
            {loadError}
          </div>
        )}
        {!loading && details && (
          <form onSubmit={handleSubmit} autoComplete="off">
            {formError && (
              <div
                style={{
                  padding: "12px",
                  backgroundColor: "var(--danger-bg)",
                  color: "var(--danger-fg)",
                  borderRadius: "var(--radius-md)",
                  marginBottom: "var(--spacing-lg)",
                  fontSize: "var(--font-sm)",
                  fontWeight: 500,
                }}
              >
                {formError}
              </div>
            )}
            <div className={styles.formGroup}>
              <label className="label" htmlFor="username">Choose a username</label>
              <input
                id="username"
                type="text"
                autoComplete="off"
                placeholder="e.g. rahul_101"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className={styles.formGroup}>
              <label className="label" htmlFor="email">
                Confirm your email ({details.maskedEmail})
              </label>
              <input
                id="email"
                type="email"
                autoComplete="off"
                placeholder="Enter the email this was sent to"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className={styles.formGroup}>
              <label className="label" htmlFor="password">New password</label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className={styles.formGroup}>
              <label className="label" htmlFor="confirmPassword">Confirm new password</label>
              <input
                id="confirmPassword"
                type="password"
                className="input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className={styles.formActions}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
                style={{ width: "100%", justifyContent: "center" }}
              >
                {submitting ? "Setting up…" : "Set up my account"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
export default function SetCredentialsPage() {
  return (
    <Suspense fallback={null}>
      <SetCredentialsForm />
    </Suspense>
  );
}
