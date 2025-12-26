import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";

// THIS FIXES THE FORMDATA ISSUE IN NEXT.JS 15
export const config = {
  api: {
    bodyParser: false,
  },
};

export async function POST(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    if (decoded.role === "Accountant")
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file)
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
    ];
    if (!allowedTypes.includes(file.type))
      return NextResponse.json(
        { error: "Only PDF, JPG, PNG allowed" },
        { status: 400 }
      );
    if (file.size > 5 * 1024 * 1024)
      return NextResponse.json(
        { error: "File must be less than 5MB" },
        { status: 400 }
      );

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const uploadsDir = join(process.cwd(), "public", "uploads", "bills");
    if (!existsSync(uploadsDir)) await mkdir(uploadsDir, { recursive: true });

    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const filename = `${decoded.societyId}_${Date.now()}_${sanitizedName}`;
    await writeFile(join(uploadsDir, filename), buffer);

    const fileUrl = `/uploads/bills/${filename}`;
    const isPdf = file.type === "application/pdf";

    const templateHtml = isPdf
      ? `<div style="max-width:850px;margin:0 auto;padding:20px"><embed src="${fileUrl}" type="application/pdf" width="100%" height="1200px"/></div>`
      : `<div style="max-width:850px;margin:0 auto;padding:20px"><img src="${fileUrl}" style="width:100%;height:auto"/></div>`;

    await Society.findByIdAndUpdate(decoded.societyId, {
      billTemplate: {
        name: `Uploaded - ${file.name}`,
        html: templateHtml,
        type: "uploaded",
        fileUrl,
        fileType: file.type,
        uploadedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      message: "Template uploaded successfully",
      fileUrl,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
