// Renders a REAL sample PDF for the uploaded-PDF bill template: takes the
// admin's uploaded PDF + (optional) custom overlay field positions and fills
// it with an actual member's latest real bill data, using the exact same
// FlexiblePDFGenerator + buildPdfFillData code path that produces bills for
// members (see app/api/bills/download/route.js). This is what the admin
// confirms before Save is allowed — no mock data, no drift from production.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireRoles } from "@/lib/authz";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Society from "@/models/Society";
import { FlexiblePDFGenerator } from "@/lib/pdf-generator";
import { buildPdfFillData, buildOverlayBillData } from "@/lib/bill-pdf-fields";
import { extractFileId, loadUploadedFile } from "@/lib/file-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const auth = requireRoles(request, ["Admin", "Secretary", "Treasurer"]);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const societyId = auth.user.societyId;
    const body = await request.json();
    const { pdfUrl, imageUrl, memberId, pdfFields, imageFields } = body || {};
    const type = body?.type === "uploaded-image" ? "uploaded-image" : "uploaded-pdf";
    const templateUrl = type === "uploaded-image" ? imageUrl : pdfUrl;
    if (!templateUrl) {
      return NextResponse.json(
        { error: type === "uploaded-image" ? "No uploaded image to preview" : "No uploaded PDF to preview" },
        { status: 400 },
      );
    }
    if (!memberId) {
      return NextResponse.json({ error: "memberId required" }, { status: 400 });
    }

    const member = await Member.findOne({ _id: memberId, societyId }).lean();
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    const bill =
      (await Bill.findOne({ societyId, memberId, status: { $ne: "Scheduled" } })
        .sort({ billDate: -1, createdAt: -1 })
        .lean()) ||
      (await Bill.findOne({ societyId, memberId }).sort({ billDate: -1, createdAt: -1 }).lean());
    if (!bill) {
      return NextResponse.json(
        { error: "This member has no generated bill yet — pick a member with a real bill to preview" },
        { status: 404 },
      );
    }

    const society = await Society.findById(societyId).lean();
    if (!society) {
      return NextResponse.json({ error: "Society not found" }, { status: 404 });
    }

    const fileId = extractFileId(templateUrl);
    const stored = fileId ? await loadUploadedFile(fileId) : null;
    if (!stored) {
      return NextResponse.json(
        { error: type === "uploaded-image" ? "Uploaded image file not found" : "Uploaded PDF file not found" },
        { status: 404 },
      );
    }

    let pdfBytes;
    if (type === "uploaded-image") {
      const customPositions = Object.fromEntries(
        (Array.isArray(imageFields) ? imageFields : [])
          .filter((f) => f && f.name)
          .map((f) => [f.name, { x: f.x, y: f.y, fontSize: f.fontSize, maxWidth: f.width }]),
      );
      const generator = new FlexiblePDFGenerator(null, customPositions);
      const overlayData = buildOverlayBillData({ bill, society, member });
      pdfBytes = await generator.generateImageOverlay(stored.buffer, stored.contentType, overlayData);
    } else {
      const customPositions = Object.fromEntries(
        (Array.isArray(pdfFields) ? pdfFields : [])
          .filter((f) => f && f.name)
          .map((f) => [f.name, { x: f.x, y: f.y, fontSize: f.fontSize, maxWidth: f.width }]),
      );
      const generator = new FlexiblePDFGenerator({ buffer: stored.buffer }, customPositions);
      const { items, paymentDetails, formFieldData, currentBillTotal, totalPayable } = buildPdfFillData({
        bill,
        society,
        member,
      });
      pdfBytes = await generator.generateBill({
        companyName: society.name || "",
        invoiceNumber: bill.billPeriodId || String(bill._id),
        customerName: member?.ownerName || "",
        customerAddress: `${member?.wing || ""}-${member?.flatNo || ""}`,
        customerPhone: member?.contactNumber || "",
        billDate: bill.generatedAt || bill.createdAt || new Date(),
        dueDate: bill.dueDate || new Date(),
        items,
        subtotal: currentBillTotal,
        tax: bill.serviceTax || 0,
        total: totalPayable,
        paymentDetails,
        formFieldData,
      });
    }

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="sample-preview.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("preview-fill error", error);
    return NextResponse.json({ error: "Failed to render preview" }, { status: 500 });
  }
}
