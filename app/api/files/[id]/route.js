import { NextResponse } from "next/server";
import { loadUploadedFile } from "@/lib/file-store";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";

// Serves an uploaded binary stored in MongoDB. Content-addressed by Mongo _id,
// so bytes can be cached immutably.
//
// Mongo ObjectIds are NOT secret (time+counter based, enumerable) — this was
// previously reachable by anyone with no auth at all. Two layers now:
//   1. Any valid session required (was: none).
//   2. Tenant scoping: if the file record has a societyId, the caller's
//      token societyId must match — closes cross-society IDOR, the real risk
//      (any authenticated user from Society A reading Society B's uploads).
// Per-uploader ownership within the same society (only the uploader or an
// admin, not any staff member) is NOT enforced here — files of this kind
// (bill PDFs, tenant docs, visitor photos) are legitimately viewed by more
// than their uploader within a society, so a same-society check is the
// correct boundary, not a stricter one that would break normal viewing.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      decoded = null;
    }
    if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const callerSocietyId =
      decoded.activeContext?.societyId || decoded.societyId || null;

    const { id } = await params;
    const file = await loadUploadedFile(id);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (file.societyId && (!callerSocietyId || String(callerSocietyId) !== file.societyId)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    return new NextResponse(file.buffer, {
      headers: {
        "Content-Type": file.contentType || "application/octet-stream",
        "Content-Length": String(file.size != null ? file.size : file.buffer.length),
        "Content-Disposition": `inline; filename="${file.filename || "file"}"`,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("file serve error:", error);
    return NextResponse.json(
      { error: "Failed to load file" },
      { status: 500 }
    );
  }
}
