import mongoose from "mongoose";
import BankStatementLine from "@/models/BankStatementLine";
import BankReconciliationMatch from "@/models/BankReconciliationMatch";
import JournalLine from "@/models/JournalLine";
import { getBankAccountById } from "@/lib/services/BankAccountService";
import { getAccountLedger } from "@/lib/services/GeneralLedgerService";

// Phase 2.14 (docs/accounting-system-ARD.md §6.4, §8). Reconciliation never
// posts to the ledger — it only compares an imported bank statement against
// what's already posted (Phase 2.9's General Ledger) and records the
// matching. Sign convention: a bank statement "Credit" (money entering the
// bank) corresponds to a Debit JournalLine on the bank's Asset account (Dr
// increases an Asset); a statement "Debit" corresponds to a Credit line.

export class BankReconciliationServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "BankReconciliationServiceError";
    this.status = status;
  }
}

const BALANCE_STATUSES = ["Posted", "Reversed"];
const STATEMENT_TO_LEDGER_SIDE = { Credit: "Debit", Debit: "Credit" };

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

async function activelyMatchedLineIds(field, ids) {
  const rows = await BankReconciliationMatch.find({ [field]: { $in: ids }, isDeleted: false })
    .select(field)
    .lean();
  return new Set(rows.map((r) => String(r[field])));
}

export async function listUnmatchedJournalLines(societyId, bankAccountId) {
  const bankAccount = await getBankAccountById(societyId, bankAccountId);
  const lines = await JournalLine.find({
    societyId,
    accountId: bankAccount.linkedAccountId,
    status: { $in: BALANCE_STATUSES },
  })
    .sort({ date: -1 })
    .lean();
  const matched = await activelyMatchedLineIds("journalLineId", lines.map((l) => l._id));
  return lines.filter((l) => !matched.has(String(l._id)));
}

async function unmatchedStatementLines(societyId, bankAccountId) {
  const lines = await BankStatementLine.find({
    societyId,
    bankAccountId,
    isDeleted: false,
    matchStatus: { $ne: "Matched" },
  }).lean();
  const matched = await activelyMatchedLineIds("bankStatementLineId", lines.map((l) => l._id));
  return lines.filter((l) => !matched.has(String(l._id)));
}

/**
 * Naive auto-match: for each unmatched statement line, finds an unmatched
 * journal line with the same (side-mapped) amount within a 3-day window and
 * proposes it as a Pending match. Greedy, first-candidate-wins, one pass —
 * intentionally simple; anything it misses or gets wrong is exactly what the
 * manual match/undo actions below are for.
 */
export async function suggestMatches(societyId, bankAccountId) {
  const [statementLines, journalLines] = await Promise.all([
    unmatchedStatementLines(societyId, bankAccountId),
    listUnmatchedJournalLines(societyId, bankAccountId),
  ]);

  const usedJournalLineIds = new Set();
  const created = [];
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

  for (const stLine of statementLines) {
    const wantedSide = STATEMENT_TO_LEDGER_SIDE[stLine.type];
    const candidate = journalLines.find(
      (jl) =>
        !usedJournalLineIds.has(String(jl._id)) &&
        jl.side === wantedSide &&
        Math.abs(jl.amount - stLine.amount) < 0.005 &&
        Math.abs(new Date(jl.date).getTime() - new Date(stLine.date).getTime()) <= THREE_DAYS_MS,
    );
    if (!candidate) continue;
    usedJournalLineIds.add(String(candidate._id));

    const match = await BankReconciliationMatch.create({
      societyId,
      bankAccountId,
      bankStatementLineId: stLine._id,
      journalLineId: candidate._id,
      matchedAmount: stLine.amount,
      status: "Pending",
    });
    await BankStatementLine.updateOne({ _id: stLine._id }, { $set: { matchStatus: "Pending" } });
    created.push(match);
  }

  return { suggested: created.length, matches: created };
}

export async function createManualMatch(societyId, bankAccountId, { bankStatementLineId, journalLineId, note } = {}, actorUserId) {
  if (!bankStatementLineId || !journalLineId) {
    throw new BankReconciliationServiceError(400, "bankStatementLineId and journalLineId are both required");
  }
  const [stLine, jLine] = await Promise.all([
    BankStatementLine.findOne({ _id: bankStatementLineId, societyId, bankAccountId, isDeleted: false }),
    JournalLine.findOne({ _id: journalLineId, societyId, status: { $in: BALANCE_STATUSES } }),
  ]);
  if (!stLine) throw new BankReconciliationServiceError(404, "Bank statement line not found");
  if (!jLine) throw new BankReconciliationServiceError(404, "Journal line not found");
  if (stLine.matchStatus === "Matched") throw new BankReconciliationServiceError(409, "Statement line is already matched");
  if (Math.abs(jLine.amount - stLine.amount) >= 0.005) {
    throw new BankReconciliationServiceError(422, `Amounts don't match: statement ${stLine.amount} vs ledger ${jLine.amount}`);
  }
  const wantedSide = STATEMENT_TO_LEDGER_SIDE[stLine.type];
  if (jLine.side !== wantedSide) {
    throw new BankReconciliationServiceError(
      422,
      `Side mismatch: a statement "${stLine.type}" line must match a ledger "${wantedSide}" line, but this journal line is "${jLine.side}"`,
    );
  }

  const match = await BankReconciliationMatch.create({
    societyId,
    bankAccountId,
    bankStatementLineId,
    journalLineId,
    matchedAmount: stLine.amount,
    status: "Matched",
    matchedBy: actorUserId,
    matchedAt: new Date(),
    note,
  });
  await BankStatementLine.updateOne({ _id: bankStatementLineId }, { $set: { matchStatus: "Matched" } });
  return match;
}

export async function confirmMatch(societyId, matchId, actorUserId) {
  const match = await BankReconciliationMatch.findOne({ _id: matchId, societyId, isDeleted: false });
  if (!match) throw new BankReconciliationServiceError(404, "Match not found");
  if (match.status !== "Pending") throw new BankReconciliationServiceError(409, `Match is already "${match.status}"`);
  match.status = "Matched";
  match.matchedBy = actorUserId;
  match.matchedAt = new Date();
  await match.save();
  await BankStatementLine.updateOne({ _id: match.bankStatementLineId }, { $set: { matchStatus: "Matched" } });
  return match;
}

export async function undoMatch(societyId, matchId) {
  const match = await BankReconciliationMatch.findOne({ _id: matchId, societyId, isDeleted: false });
  if (!match) throw new BankReconciliationServiceError(404, "Match not found");
  match.isDeleted = true;
  await match.save();
  await BankStatementLine.updateOne({ _id: match.bankStatementLineId }, { $set: { matchStatus: "Unmatched" } });
  return { undone: true };
}

/**
 * Lists match rows with enough of the statement line + journal line pulled
 * in to render a confirm/undo screen — nothing else exposed matchId at all,
 * so this is the piece that was actually missing to make the confirm/undo
 * routes reachable from a UI.
 */
export async function listMatches(societyId, bankAccountId, { status } = {}) {
  const query = { societyId, bankAccountId, isDeleted: false };
  if (status) query.status = status;
  const matches = await BankReconciliationMatch.find(query).sort({ createdAt: -1 }).lean();
  const stLineIds = matches.map((m) => m.bankStatementLineId);
  const jLineIds = matches.map((m) => m.journalLineId);
  const [stLines, jLines] = await Promise.all([
    BankStatementLine.find({ _id: { $in: stLineIds } }).select("date description amount type").lean(),
    JournalLine.find({ _id: { $in: jLineIds } }).select("date narration amount side").lean(),
  ]);
  const stById = new Map(stLines.map((l) => [String(l._id), l]));
  const jById = new Map(jLines.map((l) => [String(l._id), l]));
  return matches.map((m) => ({
    ...m,
    statementLine: stById.get(String(m.bankStatementLineId)) || null,
    journalLine: jById.get(String(m.journalLineId)) || null,
  }));
}

/** Live reconciliation status: ledger balance, statement balance, and outstanding (unmatched) items on each side. */
export async function getReconciliationSummary(societyId, bankAccountId, { asOf } = {}) {
  const bankAccount = await getBankAccountById(societyId, bankAccountId);
  const asOfDate = asOf ? new Date(asOf) : new Date();

  const ledger = await getAccountLedger(societyId, bankAccount.linkedAccountId, { dateTo: asOfDate });
  const ledgerBalance = ledger.closingSide === "Dr" ? ledger.closingBalance : -ledger.closingBalance;

  const statementLines = await BankStatementLine.find({
    societyId,
    bankAccountId,
    isDeleted: false,
    date: { $lte: asOfDate },
  }).lean();
  const statementBalance = round2(
    statementLines.reduce((sum, l) => sum + (l.type === "Credit" ? l.amount : -l.amount), 0),
  );

  const [unmatchedStatement, unmatchedJournal] = await Promise.all([
    unmatchedStatementLines(societyId, bankAccountId),
    listUnmatchedJournalLines(societyId, bankAccountId),
  ]);

  return {
    bankAccountId: String(bankAccountId),
    asOf: asOfDate,
    ledgerBalance: round2(ledgerBalance),
    statementBalance,
    difference: round2(ledgerBalance - statementBalance),
    isReconciled: Math.abs(round2(ledgerBalance - statementBalance)) < 0.005,
    unmatchedStatementCount: unmatchedStatement.length,
    unmatchedJournalCount: unmatchedJournal.length,
  };
}
