"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";
import gridStyles from "@/styles/BillingGrid.module.css";

export default function PaymentsPage() {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    memberId: "",
    amount: "",
    paymentMode: "Cash",
    paymentDate: new Date().toISOString().split("T")[0],
    chequeNo: "",
    bankName: "",
    transactionRef: "",
    upiId: "",
    notes: "",
  });
  const [errors, setErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState("");

  const { data: membersData } = useQuery({
    queryKey: ["members-list"],
    queryFn: () => apiClient.get("/api/members/list?limit=1000"),
  });

  const { data: paymentsData } = useQuery({
    queryKey: ["payments-list"],
    queryFn: () => apiClient.get("/api/payments/list?limit=50"),
  });

  const recordMutation = useMutation({
    mutationFn: (data) => apiClient.post("/api/payments/record", data),
    onSuccess: (data) => {
      setSuccessMessage(
        `✓ Payment recorded successfully! Transaction ID: ${data.transaction.transactionId}`
      );
      setFormData({
        memberId: "",
        amount: "",
        paymentMode: "Cash",
        paymentDate: new Date().toISOString().split("T")[0],
        chequeNo: "",
        bankName: "",
        transactionRef: "",
        upiId: "",
        notes: "",
      });
      setErrors({});
      queryClient.invalidateQueries(["payments-list"]);
      queryClient.invalidateQueries(["ledger-transactions"]);
      queryClient.invalidateQueries(["bills-list"]);
      setTimeout(() => setSuccessMessage(""), 5000);
    },
    onError: (error) => {
      setErrors({ submit: error.message });
    },
  });

  const members = membersData?.members || [];
  const payments = paymentsData?.payments || [];

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const validate = () => {
    const newErrors = {};

    if (!formData.memberId) {
      newErrors.memberId = "Please select a member";
    }

    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      newErrors.amount = "Amount must be greater than 0";
    }

    if (formData.paymentMode === "Cheque") {
      if (!formData.chequeNo) newErrors.chequeNo = "Cheque number required";
      if (!formData.bankName) newErrors.bankName = "Bank name required";
    }

    if (formData.paymentMode === "UPI" && !formData.upiId) {
      newErrors.upiId = "UPI ID required";
    }

    if (
      ["Online", "NEFT", "RTGS"].includes(formData.paymentMode) &&
      !formData.transactionRef
    ) {
      newErrors.transactionRef = "Transaction reference required";
    }

    return newErrors;
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    const paymentDetails = {};
    if (formData.chequeNo) paymentDetails.chequeNo = formData.chequeNo;
    if (formData.bankName) paymentDetails.bankName = formData.bankName;
    if (formData.transactionRef)
      paymentDetails.transactionRef = formData.transactionRef;
    if (formData.upiId) paymentDetails.upiId = formData.upiId;

    recordMutation.mutate({
      memberId: formData.memberId,
      amount: parseFloat(formData.amount),
      paymentMode: formData.paymentMode,
      paymentDate: formData.paymentDate,
      paymentDetails,
      notes: formData.notes,
    });
  };

  return (
    <div>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Record Payment</h1>
        <p className={styles.pageSubtitle}>
          Record member payments and adjust bills automatically
        </p>
      </div>

      {successMessage && (
        <div
          className="toast toast-success"
          style={{ position: "relative", marginBottom: "var(--spacing-lg)" }}
        >
          {successMessage}
        </div>
      )}

      {errors.submit && (
        <div className={gridStyles.errorList}>
          <div className={gridStyles.errorListTitle}>❌ Payment Failed</div>
          <div>{errors.submit}</div>
        </div>
      )}

      <div className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Payment Details</h2>
        </div>

        <form onSubmit={handleSubmit} className={gridStyles.configForm}>
          <div className={gridStyles.formRow}>
            <div className={gridStyles.formGroup}>
              <label className="label">Member *</label>
              <select
                name="memberId"
                value={formData.memberId}
                onChange={handleChange}
                className={`input ${errors.memberId ? "input-error" : ""}`}
              >
                <option value="">Select Member</option>
                {members.map((member) => (
                  <option key={member._id} value={member._id}>
                    {member.wing ? `${member.wing}-` : ""}
                    {member.roomNo} - {member.ownerName}
                  </option>
                ))}
              </select>
              {errors.memberId && (
                <p className="error-text">{errors.memberId}</p>
              )}
            </div>

            <div className={gridStyles.formGroup}>
              <label className="label">Amount (₹) *</label>
              <input
                type="number"
                name="amount"
                min="0"
                step="0.01"
                value={formData.amount}
                onChange={handleChange}
                className={`input ${errors.amount ? "input-error" : ""}`}
                placeholder="0.00"
              />
              {errors.amount && <p className="error-text">{errors.amount}</p>}
            </div>
          </div>

          <div className={gridStyles.formRow}>
            <div className={gridStyles.formGroup}>
              <label className="label">Payment Mode *</label>
              <select
                name="paymentMode"
                value={formData.paymentMode}
                onChange={handleChange}
                className="input"
              >
                <option value="Cash">Cash</option>
                <option value="Cheque">Cheque</option>
                <option value="Online">Online Transfer</option>
                <option value="UPI">UPI</option>
                <option value="NEFT">NEFT</option>
                <option value="RTGS">RTGS</option>
              </select>
            </div>

            <div className={gridStyles.formGroup}>
              <label className="label">Payment Date *</label>
              <input
                type="date"
                name="paymentDate"
                value={formData.paymentDate}
                onChange={handleChange}
                className="input"
              />
            </div>
          </div>

          {formData.paymentMode === "Cheque" && (
            <div className={gridStyles.formRow}>
              <div className={gridStyles.formGroup}>
                <label className="label">Cheque Number *</label>
                <input
                  type="text"
                  name="chequeNo"
                  value={formData.chequeNo}
                  onChange={handleChange}
                  className={`input ${errors.chequeNo ? "input-error" : ""}`}
                  placeholder="123456"
                />
                {errors.chequeNo && (
                  <p className="error-text">{errors.chequeNo}</p>
                )}
              </div>

              <div className={gridStyles.formGroup}>
                <label className="label">Bank Name *</label>
                <input
                  type="text"
                  name="bankName"
                  value={formData.bankName}
                  onChange={handleChange}
                  className={`input ${errors.bankName ? "input-error" : ""}`}
                  placeholder="HDFC Bank"
                />
                {errors.bankName && (
                  <p className="error-text">{errors.bankName}</p>
                )}
              </div>
            </div>
          )}

          {["Online", "NEFT", "RTGS"].includes(formData.paymentMode) && (
            <div className={gridStyles.formGroup}>
              <label className="label">Transaction Reference *</label>
              <input
                type="text"
                name="transactionRef"
                value={formData.transactionRef}
                onChange={handleChange}
                className={`input ${
                  errors.transactionRef ? "input-error" : ""
                }`}
                placeholder="REF123456789"
              />
              {errors.transactionRef && (
                <p className="error-text">{errors.transactionRef}</p>
              )}
            </div>
          )}

          {formData.paymentMode === "UPI" && (
            <div className={gridStyles.formGroup}>
              <label className="label">UPI ID *</label>
              <input
                type="text"
                name="upiId"
                value={formData.upiId}
                onChange={handleChange}
                className={`input ${errors.upiId ? "input-error" : ""}`}
                placeholder="user@paytm"
              />
              {errors.upiId && <p className="error-text">{errors.upiId}</p>}
            </div>
          )}

          <div className={gridStyles.formGroup}>
            <label className="label">Notes (Optional)</label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              className="input"
              rows="3"
              placeholder="Additional notes..."
            />
          </div>

          <button
            type="submit"
            className="btn btn-success"
            disabled={recordMutation.isPending}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {recordMutation.isPending ? (
              <>
                <span className="loading-spinner"></span>
                Recording Payment...
              </>
            ) : (
              <>💰 Record Payment</>
            )}
          </button>
        </form>
      </div>

      {payments.length > 0 && (
        <div className={styles.contentCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Recent Payments</h2>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Transaction ID</th>
                  <th>Member</th>
                  <th>Amount</th>
                  <th>Mode</th>
                  <th>Recorded By</th>
                </tr>
              </thead>
              <tbody>
                {payments.slice(0, 10).map((payment) => (
                  <tr key={payment._id}>
                    <td>
                      {new Date(payment.date).toLocaleDateString("en-IN")}
                    </td>
                    <td
                      style={{
                        fontFamily: "monospace",
                        fontSize: "var(--font-xs)",
                      }}
                    >
                      {payment.transactionId}
                    </td>
                    <td>
                      {payment.memberId?.wing
                        ? `${payment.memberId.wing}-`
                        : ""}
                      {payment.memberId?.roomNo}
                      <br />
                      <small style={{ color: "var(--text-tertiary)" }}>
                        {payment.memberId?.ownerName}
                      </small>
                    </td>
                    <td style={{ fontWeight: "600", color: "var(--success)" }}>
                      ₹{payment.amount.toLocaleString()}
                    </td>
                    <td>
                      <span className="badge badge-success">
                        {payment.paymentMode}
                      </span>
                    </td>
                    <td>{payment.createdBy?.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
