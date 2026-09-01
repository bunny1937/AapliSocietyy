import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { getJournalEntry, JournalEntryServiceError } from "@/lib/services/JournalEntryService";
import { authorizeAny } from "@/lib/rbac/authorize";

// GET /api/accounting/journal-entries/:id — entry header + its lines.
export async function GET(request, ctx) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, [
    "accounting.journalEntries.view",
    "accounting.vouchers.view",
    "society.systemTests.view",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const entry = await getJournalEntry(auth.user.societyId, id);
    return NextResponse.json({ journalEntry: entry });
  } catch (error) {
    if (error instanceof JournalEntryServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Get journal entry error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
