"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/styles/Auth.module.css";

export default function SignupPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    societyName: "",
    registrationNo: "",
    role: "Admin",
  });
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
    setApiError("");
  };

  const validate = () => {
    const newErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = "Name is required";
    } else if (formData.name.trim().length < 2) {
      newErrors.name = "Name must be at least 2 characters";
    }

    if (!formData.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Invalid email format";
    }

    if (!formData.password) {
      newErrors.password = "Password is required";
    } else if (formData.password.length < 6) {
      newErrors.password = "Password must be at least 6 characters";
    }

    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match";
    }

    if (!formData.societyName.trim()) {
      newErrors.societyName = "Society name is required";
    }

    return newErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsLoading(true);
    setApiError("");

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Signup failed");
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));

      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      setApiError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.authContainer}>
      <div className={styles.authCard}>
        <div className={styles.authHeader}>
          <h1 className={styles.authTitle}>Create Account</h1>
          <p className={styles.authSubtitle}>
            Set up your society management system
          </p>
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
            <label className="label" htmlFor="name">
              Full Name
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              className={`input ${errors.name ? "input-error" : ""}`}
              placeholder="John Doe"
              disabled={isLoading}
            />
            {errors.name && <p className="error-text">{errors.name}</p>}
          </div>

          <div className={styles.formGroup}>
            <label className="label" htmlFor="email">
              Email Address
            </label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className={`input ${errors.email ? "input-error" : ""}`}
              placeholder="admin@society.com"
              disabled={isLoading}
            />
            {errors.email && <p className="error-text">{errors.email}</p>}
          </div>

          <div className={styles.formGroup}>
            <label className="label" htmlFor="societyName">
              Society Name
            </label>
            <input
              type="text"
              id="societyName"
              name="societyName"
              value={formData.societyName}
              onChange={handleChange}
              className={`input ${errors.societyName ? "input-error" : ""}`}
              placeholder="Green Valley Apartments"
              disabled={isLoading}
            />
            {errors.societyName && (
              <p className="error-text">{errors.societyName}</p>
            )}
          </div>

          <div className={styles.formGroup}>
            <label className="label" htmlFor="registrationNo">
              Registration No (Optional)
            </label>
            <input
              type="text"
              id="registrationNo"
              name="registrationNo"
              value={formData.registrationNo}
              onChange={handleChange}
              className="input"
              placeholder="REG/2024/1234"
              disabled={isLoading}
            />
          </div>

          <div className={styles.formGroup}>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              type="password"
              id="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              className={`input ${errors.password ? "input-error" : ""}`}
              placeholder="Min 6 characters"
              disabled={isLoading}
            />
            {errors.password && <p className="error-text">{errors.password}</p>}
          </div>

          <div className={styles.formGroup}>
            <label className="label" htmlFor="confirmPassword">
              Confirm Password
            </label>
            <input
              type="password"
              id="confirmPassword"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              className={`input ${errors.confirmPassword ? "input-error" : ""}`}
              placeholder="Re-enter password"
              disabled={isLoading}
            />
            {errors.confirmPassword && (
              <p className="error-text">{errors.confirmPassword}</p>
            )}
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
                  Creating Account...
                </>
              ) : (
                "Create Account"
              )}
            </button>
          </div>
        </form>

        <div className={styles.authFooter}>
          Already have an account?
          <a href="/auth/login" className={styles.authLink}>
            Sign In
          </a>
        </div>
      </div>
    </div>
  );
}
