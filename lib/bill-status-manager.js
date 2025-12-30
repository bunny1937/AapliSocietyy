/**
 * Bill Status Manager - Explicit status control
 * No auto-calculation, all status changes are explicit and auditable
 */

/**
 * Set bill status after payment recording
 */
export function calculateBillStatusAfterPayment(totalAmount, amountPaid) {
  if (amountPaid >= totalAmount) {
    return 'Paid';
  } else if (amountPaid > 0) {
    return 'Partial';
  } else {
    return 'Unpaid';
  }
}

/**
 * Check if bill should be marked overdue (for cron job)
 */
export function shouldMarkOverdue(bill, currentDate = new Date()) {
  if (bill.status === 'Paid') return false;
  if (bill.balanceAmount <= 0) return false;
  return currentDate > new Date(bill.dueDate);
}

/**
 * Get status for new bill generation
 */
export function getInitialBillStatus() {
  return 'Unpaid';
}

/**
 * Validate status transition (for audit safety)
 */
export function isValidStatusTransition(currentStatus, newStatus) {
  const validTransitions = {
    'Unpaid': ['Partial', 'Paid', 'Overdue'],
    'Partial': ['Paid', 'Overdue', 'Unpaid'], // Can go back to Unpaid if payment reversed
    'Paid': ['Partial', 'Unpaid'], // Can be reversed
    'Overdue': ['Partial', 'Paid', 'Unpaid']
  };

  return validTransitions[currentStatus]?.includes(newStatus) || false;
}
