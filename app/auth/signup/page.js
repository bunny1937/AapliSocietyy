'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from '@/styles/Auth.module.css';

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    // Step 1: Admin
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    
    // Step 2: Society
    societyName: '',
    registrationNo: '',
    dateOfRegistration: '',
    address: '',
    panNo: '',
    tanNo: '',
    
    // Step 3: Contact
    personOfContact: '',
    contactEmail: '',
    contactPhone: '',
    
    // Step 4: Config
    maintenanceRate: '',
    sinkingFundRate: '',
    repairFundRate: '',
    interestRate: '',
    waterCharge: '',
    securityCharge: '',
    electricityCharge: '',
    gracePeriodDays: '10',
    billDueDay: '10'
  });

  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
    setApiError('');
  };

  const validateStep = () => {
    const newErrors = {};
    
    if (step === 1) {
      if (!formData.fullName.trim()) newErrors.fullName = 'Name is required';
      if (!formData.email.trim()) newErrors.email = 'Email is required';
      if (!/.+@.+\..+/.test(formData.email)) newErrors.email = 'Invalid email';
      if (!formData.password) newErrors.password = 'Password is required';
      if (formData.password.length < 6) newErrors.password = 'Min 6 characters';
      if (formData.password !== formData.confirmPassword) {
        newErrors.confirmPassword = 'Passwords do not match';
      }
    }
    
    if (step === 2) {
      if (!formData.societyName.trim()) newErrors.societyName = 'Society name is required';
      if (!formData.address.trim()) newErrors.address = 'Address is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep()) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    setStep(step - 1);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateStep()) return;

    setIsLoading(true);
    setApiError('');

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Signup failed');
      }

      alert('Account created successfully!');
      router.push('/auth/login');
    } catch (error) {
      setApiError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const getStepTitle = () => {
    switch(step) {
      case 1: return 'Admin Account';
      case 2: return 'Society Details';
      case 3: return 'Contact Information';
      case 4: return 'Billing Configuration';
      default: return '';
    }
  };

  return (
    <div className={styles.authContainer}>
      <div className={styles.authCard}>
        <div className={styles.authHeader}>
          <h1 className={styles.authTitle}>Create Account</h1>
          <p className={styles.authSubtitle}>
            Step {step} of 4: {getStepTitle()}
          </p>
        </div>

        {/* Progress Indicator */}
        <div style={{
          display: 'flex',
          gap: '8px',
          marginBottom: 'var(--spacing-lg)'
        }}>
          {[1, 2, 3, 4].map(s => (
            <div
              key={s}
              style={{
                flex: 1,
                height: '4px',
                background: s <= step ? 'var(--primary)' : 'var(--border)',
                borderRadius: '2px',
                transition: 'background 0.3s'
              }}
            />
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {apiError && (
            <div style={{
              padding: '12px',
              backgroundColor: '#fee2e2',
              color: '#991b1b',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--spacing-lg)',
              fontSize: 'var(--font-sm)',
              fontWeight: 500
            }}>
              {apiError}
            </div>
          )}

          {/* STEP 1: Admin */}
          {step === 1 && (
            <>
              <div className={styles.formGroup}>
                <label className="label" htmlFor="fullName">Full Name</label>
                <input
                  type="text"
                  id="fullName"
                  name="fullName"
                  value={formData.fullName}
                  onChange={handleChange}
                  className={`input ${errors.fullName ? 'input-error' : ''}`}
                  placeholder="John Doe"
                  disabled={isLoading}
                />
                {errors.fullName && <p className="error-text">{errors.fullName}</p>}
              </div>

              <div className={styles.formGroup}>
                <label className="label" htmlFor="email">Email Address</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className={`input ${errors.email ? 'input-error' : ''}`}
                  placeholder="admin@society.com"
                  disabled={isLoading}
                />
                {errors.email && <p className="error-text">{errors.email}</p>}
              </div>

              <div className={styles.formGroup}>
                <label className="label" htmlFor="password">Password</label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  className={`input ${errors.password ? 'input-error' : ''}`}
                  placeholder="Min 6 characters"
                  disabled={isLoading}
                />
                {errors.password && <p className="error-text">{errors.password}</p>}
              </div>

              <div className={styles.formGroup}>
                <label className="label" htmlFor="confirmPassword">Confirm Password</label>
                <input
                  type="password"
                  id="confirmPassword"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  className={`input ${errors.confirmPassword ? 'input-error' : ''}`}
                  placeholder="Re-enter password"
                  disabled={isLoading}
                />
                {errors.confirmPassword && <p className="error-text">{errors.confirmPassword}</p>}
              </div>
            </>
          )}

          {/* STEP 2: Society */}
          {step === 2 && (
            <>
              <div className={styles.formGroup}>
                <label className="label" htmlFor="societyName">Society Name</label>
                <input
                  type="text"
                  id="societyName"
                  name="societyName"
                  value={formData.societyName}
                  onChange={handleChange}
                  className={`input ${errors.societyName ? 'input-error' : ''}`}
                  placeholder="Green Valley Apartments"
                  disabled={isLoading}
                />
                {errors.societyName && <p className="error-text">{errors.societyName}</p>}
              </div>

              <div className={styles.formGroup}>
                <label className="label" htmlFor="registrationNo">Registration No (Optional)</label>
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
                <label className="label" htmlFor="dateOfRegistration">Date of Registration</label>
                <input
                  type="date"
                  id="dateOfRegistration"
                  name="dateOfRegistration"
                  value={formData.dateOfRegistration}
                  onChange={handleChange}
                  className="input"
                  disabled={isLoading}
                />
              </div>

              <div className={styles.formGroup}>
                <label className="label" htmlFor="address">Address</label>
                <textarea
                  id="address"
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  className={`input ${errors.address ? 'input-error' : ''}`}
                  placeholder="Complete address"
                  rows="3"
                  disabled={isLoading}
                />
                {errors.address && <p className="error-text">{errors.address}</p>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                <div className={styles.formGroup}>
                  <label className="label" htmlFor="panNo">PAN Number</label>
                  <input
                    type="text"
                    id="panNo"
                    name="panNo"
                    value={formData.panNo}
                    onChange={handleChange}
                    className="input"
                    placeholder="ABCDE1234F"
                    maxLength="10"
                    disabled={isLoading}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className="label" htmlFor="tanNo">TAN Number</label>
                  <input
                    type="text"
                    id="tanNo"
                    name="tanNo"
                    value={formData.tanNo}
                    onChange={handleChange}
                    className="input"
                    placeholder="DELX12345X"
                    maxLength="10"
                    disabled={isLoading}
                  />
                </div>
              </div>
            </>
          )}

          {/* STEP 3: Contact */}
          {step === 3 && (
            <>
              <div className={styles.formGroup}>
                <label className="label" htmlFor="personOfContact">Person of Contact</label>
                <input
                  type="text"
                  id="personOfContact"
                  name="personOfContact"
                  value={formData.personOfContact}
                  onChange={handleChange}
                  className="input"
                  placeholder="Secretary or Chairman name"
                  disabled={isLoading}
                />
              </div>

              <div className={styles.formGroup}>
                <label className="label" htmlFor="contactEmail">Contact Email</label>
                <input
                  type="email"
                  id="contactEmail"
                  name="contactEmail"
                  value={formData.contactEmail}
                  onChange={handleChange}
                  className="input"
                  placeholder="contact@society.com"
                  disabled={isLoading}
                />
              </div>

              <div className={styles.formGroup}>
                <label className="label" htmlFor="contactPhone">Contact Phone</label>
                <input
                  type="tel"
                  id="contactPhone"
                  name="contactPhone"
                  value={formData.contactPhone}
                  onChange={handleChange}
                  className="input"
                  placeholder="+91 9876543210"
                  disabled={isLoading}
                />
              </div>
            </>
          )}

          {/* STEP 4: Config (Optional) */}
          {step === 4 && (
            <>
              <p style={{
                fontSize: 'var(--font-sm)',
                color: 'var(--text-secondary)',
                marginBottom: 'var(--spacing-md)'
              }}>
                Optional: Configure billing rates (you can change these later)
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
                <div className={styles.formGroup}>
                  <label className="label" htmlFor="maintenanceRate">Maintenance (₹/sqft)</label>
                  <input
                    type="number"
                    id="maintenanceRate"
                    name="maintenanceRate"
                    value={formData.maintenanceRate}
                    onChange={handleChange}
                    className="input"
                    placeholder="5.00"
                    step="0.01"
                    disabled={isLoading}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className="label" htmlFor="sinkingFundRate">Sinking Fund (₹/sqft)</label>
                  <input
                    type="number"
                    id="sinkingFundRate"
                    name="sinkingFundRate"
                    value={formData.sinkingFundRate}
                    onChange={handleChange}
                    className="input"
                    placeholder="2.00"
                    step="0.01"
                    disabled={isLoading}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className="label" htmlFor="repairFundRate">Repair Fund (₹/sqft)</label>
                  <input
                    type="number"
                    id="repairFundRate"
                    name="repairFundRate"
                    value={formData.repairFundRate}
                    onChange={handleChange}
                    className="input"
                    placeholder="1.00"
                    step="0.01"
                    disabled={isLoading}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className="label" htmlFor="interestRate">Interest Rate (%)</label>
                  <input
                    type="number"
                    id="interestRate"
                    name="interestRate"
                    value={formData.interestRate}
                    onChange={handleChange}
                    className="input"
                    placeholder="18"
                    step="0.1"
                    disabled={isLoading}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className="label" htmlFor="waterCharge">Water Charge (₹)</label>
                  <input
                    type="number"
                    id="waterCharge"
                    name="waterCharge"
                    value={formData.waterCharge}
                    onChange={handleChange}
                    className="input"
                    placeholder="500"
                    disabled={isLoading}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className="label" htmlFor="securityCharge">Security Charge (₹)</label>
                  <input
                    type="number"
                    id="securityCharge"
                    name="securityCharge"
                    value={formData.securityCharge}
                    onChange={handleChange}
                    className="input"
                    placeholder="1000"
                    disabled={isLoading}
                  />
                </div>
              </div>
            </>
          )}

          {/* Navigation Buttons */}
          <div className={styles.formActions} style={{
            display: 'flex',
            gap: 'var(--spacing-md)',
            marginTop: 'var(--spacing-xl)'
          }}>
            {step > 1 && (
              <button
                type="button"
                onClick={handleBack}
                className="btn btn-secondary"
                style={{ flex: 1 }}
              >
                Back
              </button>
            )}

            {step < 4 ? (
              <button
                type="button"
                onClick={handleNext}
                className="btn btn-primary"
                style={{ flex: 1, justifyContent: 'center' }}
              >
                Next
              </button>
            ) : (
              <button
                type="submit"
                disabled={isLoading}
                className="btn btn-primary"
                style={{ flex: 1, justifyContent: 'center' }}
              >
                {isLoading ? (
                  <><span className="loading-spinner"></span> Creating Account...</>
                ) : (
                  'Create Account'
                )}
              </button>
            )}
          </div>
        </form>

        <div className={styles.authFooter}>
          Already have an account?{' '}
          <a href="/auth/login" className={styles.authLink}>
            Sign In
          </a>
        </div>
      </div>
    </div>
  );
}
