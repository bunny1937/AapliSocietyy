import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Society from "@/models/Society";
import fs from "fs";
import path from "path";
import { writeFile } from "fs/promises";

export async function POST(request) {
  try {
    await connectDB();

    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    if (decoded.role === "Accountant") {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("template");

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Validate file type
    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Only PDF files are allowed" },
        { status: 400 }
      );
    }

    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(process.cwd(), "public", "templates");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Generate unique filename
    const fileName = `bill-template-${decoded.societyId}-${Date.now()}.pdf`;
    const filePath = path.join(uploadsDir, fileName);
    const publicPath = `/templates/${fileName}`;

    // Convert file to buffer and save
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    // Update society with template info
    const society = await Society.findByIdAndUpdate(
      decoded.societyId,
      {
        $set: {
          "billTemplate.type": "uploaded",
          "billTemplate.fileName": fileName,
          "billTemplate.filePath": publicPath,
          "billTemplate.uploadedAt": new Date(),
          "billTemplate.uploadedBy": decoded.userId,
        },
      },
      { new: true }
    );

    return NextResponse.json({
      success: true,
      message: "Template uploaded successfully",
      template: {
        fileName,
        filePath: publicPath,
        uploadedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("Template upload error:", error);
    return NextResponse.json(
      { error: "Upload failed", details: error.message },
      { status: 500 }
    );
  }
}

// DELETE template
export async function DELETE(request) {
  try {
    await connectDB();

    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const society = await Society.findById(decoded.societyId);
    if (!society) {
      return NextResponse.json({ error: "Society not found" }, { status: 404 });
    }

    // Delete file from filesystem
    if (society.billTemplate?.fileName) {
      const filePath = path.join(
        process.cwd(),
        "public",
        "templates",
        society.billTemplate.fileName
      );
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // Reset to default template
    society.billTemplate = {
      type: "default",
      fileName: null,
      filePath: null,
      uploadedAt: null,
      uploadedBy: null,
    };
    await society.save();

    return NextResponse.json({
      success: true,
      message: "Template deleted, using default",
    });
  } catch (error) {
    console.error("Template delete error:", error);
    return NextResponse.json(
      { error: "Delete failed", details: error.message },
      { status: 500 }
    );
  }
}
