import Schedule from "@/models/Schedule";

export class ScheduleServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ScheduleServiceError";
    this.status = status;
  }
}

// Statutory co-op society schedules — generic starting set; societies in a
// state with different registrar conventions add/rename via a per-society
// override (same shadowing convention as PostingRule/ValidationRule).
export const DEFAULT_SCHEDULES = [
  { systemKey: "default:A", code: "A", label: "Share Capital", category: "Equity", displayOrder: 1 },
  { systemKey: "default:B", code: "B", label: "Reserve Fund", category: "Equity", displayOrder: 2 },
  { systemKey: "default:C", code: "C", label: "Other Funds", category: "Equity", displayOrder: 3 },
  { systemKey: "default:D", code: "D", label: "Current Liabilities & Provisions", category: "Liability", displayOrder: 4 },
  { systemKey: "default:E", code: "E", label: "Fixed Assets", category: "Asset", displayOrder: 5 },
  { systemKey: "default:F", code: "F", label: "Investments", category: "Asset", displayOrder: 6 },
  { systemKey: "default:G", code: "G", label: "Member Outstanding (Receivables)", category: "Asset", displayOrder: 7 },
  { systemKey: "default:H", code: "H", label: "Cash & Bank Balances", category: "Asset", displayOrder: 8 },
  { systemKey: "default:I", code: "I", label: "Income", category: "Income", displayOrder: 9 },
  { systemKey: "default:J", code: "J", label: "Expenditure", category: "Expense", displayOrder: 10 },
];

export async function seedDefaultSchedules() {
  let upserted = 0;
  for (const s of DEFAULT_SCHEDULES) {
    await Schedule.updateOne(
      { systemKey: s.systemKey },
      { $set: { ...s, societyId: null, isSystemDefault: true, isDeleted: false } },
      { upsert: true },
    );
    upserted += 1;
  }
  return { seeded: upserted };
}

export async function listSchedules(societyId) {
  return Schedule.find({ isDeleted: false, $or: [{ societyId }, { societyId: null }] })
    .sort({ displayOrder: 1 })
    .lean();
}

export async function createSchedule(societyId, { code, label, category, displayOrder }) {
  if (!code || !label) throw new ScheduleServiceError(400, "code and label are required");
  if (!Schedule.CATEGORIES.includes(category)) {
    throw new ScheduleServiceError(400, `category must be one of ${Schedule.CATEGORIES.join(", ")}`);
  }
  return Schedule.create({ societyId, code, label, category, displayOrder: displayOrder ?? 0 });
}
