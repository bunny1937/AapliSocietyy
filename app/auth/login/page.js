"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/styles/Auth.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
    setApiError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const newErrors = {};
    if (!formData.email.trim()) newErrors.email = "Email is required";
    if (!formData.password) newErrors.password = "Password is required";
    if (Object.keys(newErrors).length) {
      setErrors(newErrors);
      return;
    }

    setIsLoading(true);
    setApiError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // ← IMPORTANT for cookies
        body: JSON.stringify(formData),
      });

      const data = await res.json().catch(() => ({}));
      console.log("LOGIN RESPONSE:", res.status, data);

      if (!res.ok) {
        throw new Error(data.error || `Login failed (${res.status})`);
      }

      // CHANGED: Don't check for token in response, only user
      if (!data.user) {
        throw new Error("Invalid login response: user data missing");
      }

      // Store minimal user info for UI (NOT the token)
      if (typeof window !== "undefined") {
        localStorage.setItem("user", JSON.stringify(data.user));
      }

      // Token is already in HttpOnly cookie, just redirect
      router.push("/dashboard");
    } catch (err) {
      console.error("LOGIN ERROR:", err);
      setApiError(err.message || "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.authContainer}>
      <div className={styles.authCard}>
        <div className={styles.authHeader}>
          <h1 className={styles.authTitle}>Welcome Back</h1>
          <p className={styles.authSubtitle}>Sign in to your society account</p>
        </div>

        <form onSubmit={handleSubmit}>
          {apiError && (
            <div
              style={{
                padding: "12px",
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "var(--radius-md)",
                marginBottom: "var(--spacing-lg)",
                fontSize: "var(--font-sm)",
                fontWeight: "500",
              }}
            >
              {apiError}
            </div>
          )}

          <div className={styles.formGroup}>
            <label className="label" htmlFor="email">
              Email Address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              className={`input ${errors.email ? "input-error" : ""}`}
              value={formData.email}
              onChange={handleChange}
              disabled={isLoading}
            />
            {errors.email && <p className="error-text">{errors.email}</p>}
          </div>

          <div className={styles.formGroup}>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className={`input ${errors.password ? "input-error" : ""}`}
              value={formData.password}
              onChange={handleChange}
              disabled={isLoading}
            />
            {errors.password && <p className="error-text">{errors.password}</p>}
          </div>

          <div className={styles.formActions}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isLoading}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {isLoading ? (
                <>
                  <span className="loading-spinner"></span>
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
