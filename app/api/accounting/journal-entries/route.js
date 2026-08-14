import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import {
  listJournalEntries,
  postManualJournal,
  JournalEntryServiceError,
} from "@/lib/services/JournalEntryService";
import { AccountingEngineError } from "@/lib/accounting/AccountingEngine.js";
import { AccountingEventError } from "@/lib/accounting/events.js";
import { PostingRuleError } from "@/lib/accounting/postingRules/accountResolvers.js";
import { authorize } from "@/lib/rbac/authorize";

// GET /api/accounting/journal-entries?financialYearId=&status=&sourceModule=
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const entries = await listJournalEntries(auth.user.societyId, {
      financialYearId: searchParams.get("financialYearId") || undefined,
      status: searchParams.get("status") || undefined,
      sourceModule: searchParams.get("sourceModule") || undefined,
    });
    return NextResponse.json({ journalEntries: entries });
  } catch (error) {
    console.error("List journal entries error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/accounting/journal-entries — post a manual journal voucher.
// Body: { financialYearId, date?, narration?, idempotencyKey?, lines: [{ accountId, side, amount, ... }] }
export async function POST(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const result = await postManualJournal(
      auth.user.societyId,
      {
        financialYearId: body.financialYearId,
        date: body.date,
        narration: body.narration,
        lines: body.lines,
        idempotencyKey: body.idempotencyKey,
      },
      auth.user.userId,
    );
    return NextResponse.json({ voucher: result.voucher, journalEntry: result.journalEntry }, { status: 201 });
  } catch (error) {
    // Every posting-path error type carries a .status — map it straight through.
    if (
      error instanceof JournalEntryServiceError ||
      error instanceof AccountingEngineError ||
      error instanceof AccountingEventError ||
      error instanceof PostingRuleError
    ) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Post manual journal error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
