import mongoose from "mongoose";
import ChartOfAccount from "@/models/ChartOfAccount";
import JournalLine from "@/models/JournalLine";
import BillingHead from "@/models/BillingHead";
import { getFiscalConfig } from "@/lib/services/FiscalConfigService";
import { computeLockLevel, t3Refusal } from "@/lib/accounting/lockMatrix";
import { recordRemoved, recordAdopted } from "@/lib/accounting/chartProfile";
import { STANDARD_ACCOUNTS } from "@/lib/accounting/standardAccounts";

export class ChartOfAccountServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ChartOfAccountServiceError";
    this.status = status;
  }
}

export async function createAccount({
  societyId,
  code,
  name,
  type,
  subType,
  scheduleCode,
  parentAccountId,
  description,
  createdBy,
}) {
  if (!code || !name || !type) {
    throw new ChartOfAccountServiceError(400, "code, name, and type are required");
  }
  if (!ChartOfAccount.TYPES.includes(type)) {
    throw new ChartOfAccountServiceError(400, `type must be one of: ${ChartOfAccount.TYPES.join(", ")}`);
  }
  if (parentAccountId) {
    const parent = await ChartOfAccount.findOne({ _id: parentAccountId, societyId, isDeleted: false });
    if (!parent) {
      throw new ChartOfAccountServiceError(400, "parentAccountId does not exist in this society's Chart of Accounts");
    }
    if (parent.type !== type) {
      throw new ChartOfAccountServiceError(
        400,
        `Parent account "${parent.name}" is type "${parent.type}" — a child account must share its parent's type`,
      );
    }
  }
  const existing = await ChartOfAccount.findOne({ societyId, code, isDeleted: false }).lean();
  if (existing) {
    throw new ChartOfAccountServiceError(409, `Account code "${code}" already exists`);
  }
  const account = await ChartOfAccount.create({
    societyId,
    code,
    name,
    type,
    subType,
    scheduleCode,
    parentAccountId: parentAccountId || null,
    description,
    createdBy,
  });
  return account;
}

export async function listAccounts(societyId, { type, isActive, includeInactive } = {}) {
  const query = { societyId, isDeleted: false };
  if (type) query.type = type;
  if (!includeInactive) query.isActive = isActive === undefined ? true : isActive;
  return ChartOfAccount.find(query).sort({ code: 1 }).lean();
}

export async function getAccountById(societyId, id) {
  const account = await ChartOfAccount.findOne({ _id: id, societyId, isDeleted: false });
  if (!account) throw new ChartOfAccountServiceError(404, "Account not found");
  return account;
}

export async function updateAccount(societyId, id, patch) {
  const account = await getAccountById(societyId, id);
  if (account.isLocked) {
    throw new ChartOfAccountServiceError(409, "Account is locked and cannot be edited");
  }
  // type is intentionally not patchable here — changing an account's
  // double-entry classification after it may already have posted Journal
  // Entries against it is an accounting-integrity hazard, not a simple edit.
  const patchable = ["name", "subType", "scheduleCode", "description"];
  for (const key of patchable) {
    if (patch[key] !== undefined) account[key] = patch[key];
  }
  await account.save();
  return account;
}

export async function setAccountActive(societyId, id, isActive, { reason } = {}) {
  const account = await getAccountById(societyId, id);
  if (account.isLocked) {
    throw new ChartOfAccountServiceError(409, "Account is locked and cannot be (de)activated");
  }
  if (isActive === false) {
    const ctx = await getAccountLockContext(societyId, account);
    const refusal = t3Refusal("deactivate", account, ctx);
    if (refusal) {
      throw Object.assign(new ChartOfAccountServiceError(423, refusal.title), { refusal });
    }
    // T2 rows (posting-rule referenced) require a reason — not hard-enforced
    // as a 400 here yet, but recorded when supplied so the deactivation has
    // the same "why" trail a delete gets.
    if (reason) account.description = `${account.description ? account.description + " — " : ""}Deactivated: ${reason}`;
  }
  account.isActive = isActive;
  await account.save();
  return account;
}

export async function setAccountLocked(societyId, id, isLocked) {
  const account = await getAccountById(societyId, id);
  account.isLocked = isLocked;
  await account.save();
  return account;
}

/**
 * Builds the ctx object lib/accounting/lockMatrix.js's computeLockLevel/
 * t3Refusal need for one account — the three live facts the matrix rows
 * check against. See design doc §7.
 */
export async function getAccountLockContext(societyId, account) {
  const [config, journalLineCount, linkedBillingHeadCount] = await Promise.all([
    getFiscalConfig(societyId).catch(() => null),
    JournalLine.countDocuments({ societyId, accountId: account._id }),
    BillingHead.countDocuments({ societyId, linkedAccountId: account._id, isDeleted: { $ne: true } }),
  ]);
  const mappedValues = new Set(Object.values(config?.defaultAccountMappings || {}).map(String));
  const accountIdStr = String(account._id);
  return {
    mappedInFiscalConfig: mappedValues.has(accountIdStr),
    referencedByPostingRule: mappedValues.has(accountIdStr) || linkedBillingHeadCount > 0,
    hasJournalLines: journalLineCount > 0,
    journalLineCount,
  };
}

/**
 * DELETE — enforces the lock matrix server-side (never trust a client that
 * skipped the T3 refusal screen). Soft-delete only, same as everything else
 * in this codebase; if the deleted code is one of STANDARD_ACCOUNTS, records
 * it in the society's SocietyChartProfile so setup-state never nags for it
 * as "missing" again (see lib/accounting/chartProfile.js).
 */
export async function deleteAccount(societyId, id) {
  const account = await getAccountById(societyId, id);
  const ctx = await getAccountLockContext(societyId, account);
  const refusal = t3Refusal("delete", account, ctx);
  if (refusal) {
    throw Object.assign(new ChartOfAccountServiceError(423, refusal.title), { refusal });
  }
  account.isDeleted = true;
  account.isActive = false;
  await account.save();
  if (STANDARD_ACCOUNTS.some((a) => a.code === account.code)) {
    await recordRemoved(societyId, account.code).catch(() => {});
  }
  return account;
}

/**
 * Same list as listAccounts(), each row annotated with its lock level and
 * journal-line count — one bulk query per fact instead of N+1 per account,
 * for the Heads page which needs this for every row up front.
 */
export async function listAccountsWithLock(societyId, opts = {}) {
  const accounts = await listAccounts(societyId, opts);
  if (!accounts.length) return [];

  const ids = accounts.map((a) => a._id);
  const [config, lineCounts, billingHeads] = await Promise.all([
    getFiscalConfig(societyId).catch(() => null),
    JournalLine.aggregate([
      { $match: { societyId: new mongoose.Types.ObjectId(String(societyId)), accountId: { $in: ids } } },
      { $group: { _id: "$accountId", n: { $sum: 1 } } },
    ]),
    BillingHead.find({ societyId, linkedAccountId: { $in: ids }, isDeleted: { $ne: true } }).select("linkedAccountId").lean(),
  ]);
  const mappedValues = new Set(Object.values(config?.defaultAccountMappings || {}).map(String));
  const lineCountById = new Map(lineCounts.map((r) => [String(r._id), r.n]));
  const billingLinkedIds = new Set(billingHeads.map((h) => String(h.linkedAccountId)));

  return accounts.map((account) => {
    const idStr = String(account._id);
    const ctx = {
      mappedInFiscalConfig: mappedValues.has(idStr),
      referencedByPostingRule: mappedValues.has(idStr) || billingLinkedIds.has(idStr),
      hasJournalLines: (lineCountById.get(idStr) || 0) > 0,
      journalLineCount: lineCountById.get(idStr) || 0,
    };
    return { ...account, lock: computeLockLevel(ctx), journalLineCount: ctx.journalLineCount };
  });
}

export { computeLockLevel, recordAdopted };
