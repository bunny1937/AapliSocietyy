import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "fs/promises";
import { join } from "path";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Receipt from "@/models/Receipt";
import Society from "@/models/Society";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import renderBillHtml from "@/lib/bill-renderer"; // ← default import NOT named { renderBillHtml }
import { FlexiblePDFGenerator } from "@/lib/pdf-generator";
import { extractFileId, loadUploadedFile } from "@/lib/file-store";
import { buildPdfFillData, buildOverlayBillData } from "@/lib/bill-pdf-fields";
import { authorize } from "@/lib/rbac/authorize";
function formatMoney(value) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
async function appendReceiptPage(pdfDoc, receipt, bill, society, member) {
  if (!receipt) return;
  const page = pdfDoc.addPage([595.28, 841.89]);
  const { height } = page.getSize();
  const margin = 40;
  const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const drawLine = (label, value, y) => {
    page.drawText(label, {
      x: margin,
      y,
      size: 11,
      font: bodyFont,
      color: rgb(0.4, 0.4, 0.4),
    });
    page.drawText(value || "-", {
      x: 180,
      y,
      size: 11,
      font: titleFont,
      color: rgb(0.12, 0.12, 0.12),
    });
  };
  page.drawText("Previous Paid Receipt", {
    x: margin,
    y: height - 60,
    size: 18,
    font: titleFont,
    color: rgb(0.12, 0.28, 0.6),
  });
  page.drawText(society?.name || "", {
    x: margin,
    y: height - 82,
    size: 11,
    font: bodyFont,
    color: rgb(0.35, 0.35, 0.35),
  });
  drawLine("Receipt No.", receipt.receiptNo, height - 120);
  drawLine(
    "Paid At",
    new Date(receipt.paidAt).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    height - 140,
  );
  drawLine("Member", member?.ownerName || "", height - 160);
  drawLine(
    "Flat",
    `${member?.wing || ""}-${member?.flatNo || ""}`,
    height - 180,
  );
  drawLine(
    "Bill Period",
    receipt.billPeriodId || bill.billPeriodId,
    height - 200,
  );
  drawLine("Payment Mode", receipt.paymentMode, height - 220);
  drawLine("Transaction ID", receipt.transactionId, height - 240);
  drawLine("Receipt Amount", formatMoney(receipt.amount), height - 260);
  page.drawRectangle({
    x: margin,
    y: height - 340,
    width: 515.28,
    height: 70,
    color: rgb(0.97, 0.98, 1),
    borderColor: rgb(0.74, 0.79, 0.9),
    borderWidth: 1,
  });
  page.drawText("Bill Reference", {
    x: margin + 16,
    y: height - 300,
    size: 12,
    font: titleFont,
    color: rgb(0.2, 0.2, 0.2),
  });
  page.drawText(`Previous balance: ${formatMoney(bill.previousBalance)}`, {
    x: margin + 16,
    y: height - 318,
    size: 11,
    font: bodyFont,
    color: rgb(0.25, 0.25, 0.25),
  });
  page.drawText(`Interest: ${formatMoney(bill.interestAmount)}`, {
    x: margin + 16,
    y: height - 334,
    size: 11,
    font: bodyFont,
    color: rgb(0.25, 0.25, 0.25),
  });
}
export async function GET(request) {
  try {
    const gate = await authorize(request, "billing.bill.download");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = verifyToken(token);
    const { searchParams } = new URL(request.url);
    const billId = searchParams.get("id");
    if (!billId || billId === "undefined" || billId === "null") {
      return NextResponse.json({ error: "Bill ID required" }, { status: 400 });
    }
    const memberIdFilter = decoded.memberId
      ? { memberId: decoded.memberId }
      : {};
    const bill = await Bill.findOne({
      _id: billId,
      societyId: decoded.societyId,
      ...memberIdFilter,
    })
      .populate(
        "memberId",
        "flatNo wing ownerName carpetAreaSqft contactNumber emailPrimary",
      )
      .lean();
    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }
    const society = await Society.findById(decoded.societyId).lean();
    const hasPdfTemplate = Boolean(society?.billTemplate?.pdfUrl);
    const hasImageTemplate =
      !hasPdfTemplate &&
      society?.billTemplate?.type === "uploaded-image" &&
      Boolean(society?.billTemplate?.imageUrl);
    const member = bill.memberId;
    const currentBillTotal = Number(
      bill.currentBillTotal ?? bill.totalAmount ?? 0,
    );
    const previousBalance = Number(bill.previousBalance || 0);
    const interestAmount = Number(bill.interestAmount || 0);
    // previousBalance already includes carried interest (openingInterest);
    // only add this month's NEW interest, not the full interestAmount
    // (which also includes that same carried interest) — see bill-pdf-fields.js.
    const currentInterestOnly = Number(bill.currentInterest ?? interestAmount);
    const totalPayable = +(
      currentBillTotal +
      previousBalance +
      currentInterestOnly
    ).toFixed(2);
    // ─── Fetch previous bill HTML for ALL cases (page 3 prev receipt) ───
    const prevBill = await Bill.findOne({
      memberId: bill.memberId?._id || bill.memberId,
      societyId: decoded.societyId,
      billPeriodId: { $lt: bill.billPeriodId }, // strictly earlier period
      billHtml: { $exists: true, $ne: null },
    })
      .sort({ billYear: -1, billMonth: -1 })
      .lean();
    // NOTE: colors below (and in printButton/htmlWrapper) are intentionally
    // left as literal hex/rgb — this HTML is served as a standalone
    // text/html document (opened in its own window/blob, printed to PDF) and
    // never loads the app's globals.css, so var(--token) would not resolve
    // here. The printed bill must render identically regardless of the
    // viewer's app-side light/dark toggle.
    const prevBillPage = prevBill?.billHtml
      ? `<div style="page-break-before:always; padding:40px; background:var(--bg-surface);">
          <div style="border-bottom:2px solid var(--border); padding-bottom:12px; margin-bottom:24px;">
            <h2 style="margin:0; font-size:16px; color:var(--fg-4);">
              📎 Previous Month's Bill — ${prevBill.billPeriodId} (Reference Copy)
            </h2>
          </div>
          ${prevBill.billHtml}
        </div>`
      : "";
    // ─── Shared filename slug ───
    const ownerRaw = bill.memberId?.ownerName || "Member";
    const nameParts = ownerRaw.trim().split(/\s+/);
    const nameSlug =
      nameParts.length > 1
        ? `${nameParts[0]}_${nameParts[nameParts.length - 1]}`
        : nameParts[0];
    const pdfTitle =
      `${nameSlug}_${bill.memberId?.wing}-${bill.memberId?.flatNo}_${bill.billPeriodId}`
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_\-\.]/g, "");
    const printButton = `<div style="text-align:center; margin: 24px 0; padding-bottom: 16px;">
      <button onclick="window.print()" style="background:var(--success-fg);color:white;border:none;padding:10px 32px;border-radius:6px;font-size:15px;font-weight:600;cursor:pointer;">
        🖨️ Print / Save as PDF
      </button>
    </div>`;
    const htmlWrapper = (body) => `<!DOCTYPE html><html>
<head>
  <title>${pdfTitle}</title>
  <meta charset="UTF-8"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: var(--bg-muted); padding: 30px; color: var(--fg-1); }
    @media print {
      body { background: white; padding: 0; }
      .bill-wrapper { box-shadow: none !important; border-radius: 0 !important; }
      @page { margin: 8mm; size: A4; }
    }
  </style>
</head>
<body>${body}${printButton}</body>
</html>`;
    // ─── Case 1: Custom PDF template exists — keep the uploaded PDF format ───
    if (hasPdfTemplate) {
      // Templates now live in MongoDB (URL like /api/files/<id>). Load bytes
      // from the DB when the stored URL points there; else fall back to the
      // legacy on-disk path for old templates.
      const storedUrl = society.billTemplate.pdfUrl;
      // Custom overlay positions the admin configured/confirmed in the
      // bill-template designer's PDF field editor (only relevant for PDFs
      // with no fillable form fields — see FlexiblePDFGenerator).
      const customPositions = Object.fromEntries(
        (society.billTemplate.pdfFields || [])
          .filter((f) => f && f.name)
          .map((f) => [f.name, { x: f.x, y: f.y, fontSize: f.fontSize, maxWidth: f.width }]),
      );
      let generator;
      if (typeof storedUrl === "string" && storedUrl.includes("/api/files/")) {
        const stored = await loadUploadedFile(extractFileId(storedUrl));
        if (!stored) {
          return NextResponse.json(
            { error: "Bill template file not found" },
            { status: 404 },
          );
        }
        generator = new FlexiblePDFGenerator({ buffer: stored.buffer }, customPositions);
      } else {
        const templatePath = join(process.cwd(), "public", storedUrl);
        generator = new FlexiblePDFGenerator(templatePath, customPositions);
      }
      const { items, paymentDetails, formFieldData } = buildPdfFillData({
        bill,
        society,
        member,
      });
      const pdfBytes = await generator.generateBill({
        companyName: society.name || "",
        invoiceNumber: bill.billPeriodId || pdfTitle,
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
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const previousReceipt = await Receipt.findOne({
        memberId: bill.memberId?._id || bill.memberId,
        societyId: decoded.societyId,
        billPeriodId: { $lt: bill.billPeriodId },
      })
        .sort({ billPeriodId: -1, paidAt: -1 })
        .lean();
      await appendReceiptPage(pdfDoc, previousReceipt, bill, society, member);
      const finalPdf = await pdfDoc.save();
      return new NextResponse(Buffer.from(finalPdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${pdfTitle}.pdf"`,
        },
      });
    }
    // ─── Case 1b: Uploaded-image template — composite the image + overlay
    // fields into a fresh single-page PDF via the same generator + field
    // config (society.billTemplate.imageFields) the admin previewed. ───
    if (hasImageTemplate) {
      const storedUrl = society.billTemplate.imageUrl;
      const fileId = extractFileId(storedUrl);
      const stored = fileId ? await loadUploadedFile(fileId) : null;
      if (!stored) {
        return NextResponse.json(
          { error: "Bill template image not found" },
          { status: 404 },
        );
      }
      const customPositions = Object.fromEntries(
        (society.billTemplate.imageFields || [])
          .filter((f) => f && f.name)
          .map((f) => [f.name, { x: f.x, y: f.y, fontSize: f.fontSize, maxWidth: f.width }]),
      );
      const generator = new FlexiblePDFGenerator(null, customPositions);
      const overlayData = buildOverlayBillData({ bill, society, member });
      const pdfBytes = await generator.generateImageOverlay(stored.buffer, stored.contentType, overlayData);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const previousReceipt = await Receipt.findOne({
        memberId: bill.memberId?._id || bill.memberId,
        societyId: decoded.societyId,
        billPeriodId: { $lt: bill.billPeriodId },
      })
        .sort({ billPeriodId: -1, paidAt: -1 })
        .lean();
      await appendReceiptPage(pdfDoc, previousReceipt, bill, society, member);
      const finalPdf = await pdfDoc.save();
      return new NextResponse(Buffer.from(finalPdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${pdfTitle}.pdf"`,
        },
      });
    }
    // ─── Case 2: Bill has stored HTML ───
    if (bill.billHtml) {
      return new NextResponse(htmlWrapper(`${bill.billHtml}${prevBillPage}`), {
        headers: {
          "Content-Type": "text/html",
          "Content-Disposition": `inline; filename="${pdfTitle}.html"`,
        },
      });
    }
    // ─── Case 3: No stored HTML, no PDF template — re-render ───
    // Ledger V2: never recompute interest here — read the persisted canonical
    // fields and hand them to the renderer as precomputed values (root cause
    // of the ₹17.50-vs-₹21 divergence fixed by never letting this fall
    // through to the renderer's own calculateMonthlyInterest fallback).
    if (!hasPdfTemplate) {
      const renderResult = renderBillHtml(null, society, member, {
        breakdown: bill.charges || {},
        totalAmount: bill.currentCharges ?? bill.totalAmount,
        previousBalance: parseFloat(((bill.openingPrincipal || 0) + (bill.openingInterest || 0)).toFixed(2)),
        prevRemPrincipal: bill.openingPrincipal || 0,
        prevRemInt: bill.openingInterest || 0,
        precomputedCurrInt: bill.currentInterest,
        precomputedMonthInterest: bill.billInterestBalance,
        balanceAmount: bill.balanceAmount,
        status: bill.status,
        billPeriod: bill.billPeriodId,
        billDate: bill.generatedAt || bill.createdAt,
        dueDate: bill.dueDate,
        unpaidBills: bill.unpaidBills || [],
        recentTransactions: bill.recentTransactions || [],
        previousBillHtml: prevBill?.billHtml || null, // appended inside renderer too
      });
      return new NextResponse(htmlWrapper(renderResult.html), {
        headers: {
          "Content-Type": "text/html",
          "Content-Disposition": `inline; filename="${pdfTitle}.html"`,
        },
      });
    }
  } catch (error) {
    console.error("❌ Download error:", error);
    return NextResponse.json(
      { error: "Failed" },
      { status: 500 },
    );
  }
}