import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import { authorizeAny } from "@/lib/rbac/authorize";
import { resolveNote, AuditorNoteServiceError } from "@/lib/services/AuditorNoteService";

// PATCH /api/accounting/auditor/notes/:id/resolve — records the resolution,
// per design doc §8: "resolution is recorded."
export async function PATCH(request, ctx) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, ["auditor.workspace.resolveQuery"]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const { resolution } = await request.json();
    const note = await resolveNote(auth.user.societyId, id, { resolution }, auth.user.userId);
    return NextResponse.json({ note });
  } catch (error) {
    if (error instanceof AuditorNoteServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[auditor] notes resolve PATCH failed:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
