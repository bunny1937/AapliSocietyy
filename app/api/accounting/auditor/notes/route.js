import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import { authorizeAny } from "@/lib/rbac/authorize";
import { raiseNote, listNotes, AuditorNoteServiceError } from "@/lib/services/AuditorNoteService";

// GET/POST /api/accounting/auditor/notes — the Auditor Queries tab.
// design doc §8/§10/§12 Phase 5.
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, ["auditor.workspace.view"]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;
    const notes = await listNotes(auth.user.societyId, { status });
    return NextResponse.json({ notes });
  } catch (error) {
    console.error("[auditor] notes GET failed:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, ["auditor.workspace.raiseQuery"]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const note = await raiseNote(auth.user.societyId, body, auth.user.userId);
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    if (error instanceof AuditorNoteServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[auditor] notes POST failed:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
