export const FINANCIAL_YEAR_START_MONTH = 3; // April = 3 (0-indexed)

export function getFinancialYear(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth();

  if (month >= FINANCIAL_YEAR_START_MONTH) {
    return `FY${year}-${(year + 1).toString().slice(-2)}`;
  } else {
    return `FY${year - 1}-${year.toString().slice(-2)}`;
  }
}

export function getFinancialYearRange(fyString) {
  const startYear = parseInt(fyString.split("-")[0].replace("FY", ""));
  const startDate = new Date(startYear, FINANCIAL_YEAR_START_MONTH, 1);
  const endDate = new Date(
    startYear + 1,
    FINANCIAL_YEAR_START_MONTH,
    0,
    23,
    59,
    59
  );

  return { startDate, endDate };
}

export function calculateDaysBetween(fromDate, toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const diffTime = Math.abs(to - from);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export function isDateAfterGracePeriod(
  dueDate,
  gracePeriodDays,
  checkDate = new Date()
) {
  const graceEndDate = new Date(dueDate);
  graceEndDate.setDate(graceEndDate.getDate() + gracePeriodDays);
  return checkDate > graceEndDate;
}

export function getMonthYearString(date) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

export function getLastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0);
}

export function generateBillingPeriodId(month, year) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function parseBillingPeriodId(periodId) {
  const [year, month] = periodId.split("-").map(Number);
  return { year, month: month - 1 };
}

export function isPeriodLocked(billingMonth, billingYear, lockAfterDays = 45) {
  const billingDate = new Date(billingYear, billingMonth, 1);
  const lockDate = new Date(billingDate);
  lockDate.setDate(lockDate.getDate() + lockAfterDays);

  return new Date() > lockDate;
}
