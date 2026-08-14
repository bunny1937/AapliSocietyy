import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import connectDB from "@/lib/mongodb";
import { requireAuth } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import { storeUploadedFile } from "@/lib/file-store";

export const runtime = "nodejs";
// POST /api/visitor/upload-photo
// Accepts a multipart/form-data image captured from the device camera (or chosen
// from the gallery) and stores it on disk, returning a hosted path URL that
// satisfies isSafePhotoValue (path, not a data: URI, < 600 chars).
//
// Open to ANY authenticated society user: guards log visitors, residents attach
// photos to pre-approved passes, admins add watchlist photos. We keep the
// validation strict (type + magic bytes + size) rather than restricting by role.
export async function POST(request) {
  try {
    const gate = await authorize(request, "visitor.visitor.enter");
    if (!gate.ok) return gate.response;
    await connectDB();
    const auth = requireAuth(request);
    if (!auth.valid) return auth;
    if (!auth.user.societyId) {
      return NextResponse.json({ error: "Society context required" }, { status: 403 });
    }
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: "Only JPG, PNG or WebP images are allowed" }, { status: 400 });
    }
    // 6MB hard cap. The client compresses before upload, so real payloads are
    // typically < 200KB; this is just a safety ceiling for raw camera files.
    if (file.size > 6 * 1024 * 1024) {
      return NextResponse.json({ error: "Image must be under 6MB" }, { status: 400 });
    }
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    // Magic-byte validation (defend against MIME spoofing).
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng =
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isWebp =
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50;
    if (!isJpeg && !isPng && !isWebp) {
      return NextResponse.json(
        { error: "File content does not match an image format" },
        { status: 400 },
      );
    }
    const ext = isPng ? "png" : isWebp ? "webp" : "jpg";
    const rand = randomBytes(4).toString("hex");
    const filename = `${auth.user.societyId}-${Date.now()}-${rand}.${ext}`;
    // Store in MongoDB (Vercel serverless FS is read-only -> EROFS). The short
    // "/api/files/<id>" URL satisfies isSafePhotoValue (path, not data:, <600).
    const stored = await storeUploadedFile({
      societyId: auth.user.societyId,
      kind: "visitor-photo",
      filename,
      contentType:
        file.type || (isPng ? "image/png" : isWebp ? "image/webp" : "image/jpeg"),
      buffer,
      createdBy: auth.user.userId,
    });
    const url = stored.url;
    return NextResponse.json({ success: true, url });
  } catch (error) {
    console.error("\u274c Visitor photo upload error:", error);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 },
    );
  }
}