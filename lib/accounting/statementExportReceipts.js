/**
 * Write/read StatementExportReceipt rows. SERVER ONLY.
 * See models/StatementExportReceipt.js for what this is and why.
 */
import { createHash } from "crypto";
import mongoose from "mongoose";
import StatementExportReceipt from "@/models/StatementExportReceipt";
import User from "@/models/User";

/**
 * Canonical hash over the figures that matter — every number the printed
 * page shows, in a stable key order, so the same statement always hashes
 * the same way regardless of how the client happened to serialize it.
 */
export function hashStatementPayload({ ie, bs, trialBalance, financialYearId }) {
  const canonical = JSON.stringify({
    financialYearId: String(financialYearId),
    totalIncome: ie?.totalIncomeCurrent ?? null,
    totalExpenditure: ie?.totalExpenseCurrent ?? null,
    totalAssets: bs?.totalAssetsCurrent ?? null,
    totalLiabilities: (bs?.totalLiabilitiesCurrent ?? 0) + (bs?.totalEquityInclSurplusCurrent ?? 0),
    trialBalanceDebit: trialBalance?.totalDebit ?? null,
    trialBalanceCredit: trialBalance?.totalCredit ?? null,
    isBalanced: trialBalance?.isBalanced ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export async function writeStatementExportReceipt({ societyId, financialYearId, financialYearLabel, actorId, ie, bs, trialBalance }) {
  const hash = hashStatementPayload({ ie, bs, trialBalance, financialYearId });
  const actor = actorId ? await User.findById(actorId).select("name").lean().catch(() => null) : null;
  return StatementExportReceipt.create({
    societyId, financialYearId, financialYearLabel, hash,
    generatedAt: new Date(),
    generatedBy: actorId || undefined,
    generatedByName: actor?.name || "",
    summary: {
      totalIncome: ie?.totalIncomeCurrent ?? null,
      totalExpenditure: ie?.totalExpenseCurrent ?? null,
      totalAssets: bs?.totalAssetsCurrent ?? null,
      totalLiabilities: (bs?.totalLiabilitiesCurrent ?? 0) + (bs?.totalEquityInclSurplusCurrent ?? 0),
      isBalanced: trialBalance?.isBalanced ?? null,
    },
  });
}

export async function listStatementExportReceipts(societyId, financialYearId, { limit = 10 } = {}) {
  const sid = new mongoose.Types.ObjectId(String(societyId));
  return StatementExportReceipt.find({ societyId: sid, financialYearId })
    .sort({ generatedAt: -1 })
    .limit(limit)
    .lean()
    .catch(() => []);
}
