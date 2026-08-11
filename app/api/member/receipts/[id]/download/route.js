import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Receipt from "@/models/Receipt";
import Bill from "@/models/Bill";
import Society from "@/models/Society";
import Member from "@/models/Member";
import { FlexiblePDFGenerator } from "@/lib/pdf-generator";
import { buildReceiptFillData } from "@/lib/receipt-pdf-fields";
import { extractFileId, loadUploadedFile } from "@/lib/file-store";
import { authorize } from "@/lib/rbac/authorize";
export async function GET(request, { params }) {
  try {
    const gate = await authorize(request, "finance.receipt.download");
    if (!gate.ok) return gate.response;
    await connectDB();
    const { id } = await params;
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded || !decoded.memberId)
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    const receipt = await Receipt.findOne({
      _id: id,
      memberId: decoded.memberId,
    }).lean();
    if (!receipt)
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    const [bill, society, member] = await Promise.all([
      Bill.findById(receipt.billId).lean(),
      Society.findById(decoded.societyId)
        .select("name address receiptTemplate")
        .lean(),
      Member.findById(decoded.memberId)
        .select(
          "ownerName wing flatNo contactNumber emailPrimary carpetAreaSqft membershipNumber",
        )
        .lean(),
    ]);
    const receiptTemplate = society?.receiptTemplate;
    // Uploaded-PDF / uploaded-image templates — same generator + field
    // config (receiptTemplate.pdfFields / imageFields) the admin previewed
    // and confirmed in the Bill Template page → Receipt scope → Upload tab.
    if (
      (receiptTemplate?.type === "uploaded-pdf" && receiptTemplate.pdfUrl) ||
      (receiptTemplate?.type === "uploaded-image" && receiptTemplate.imageUrl)
    ) {
      const isImage = receiptTemplate.type === "uploaded-image";
      const storedUrl = isImage ? receiptTemplate.imageUrl : receiptTemplate.pdfUrl;
      const fileId = extractFileId(storedUrl);
      const stored = fileId ? await loadUploadedFile(fileId) : null;
      if (!stored) {
        return NextResponse.json({ error: "Receipt template file not found" }, { status: 404 });
      }
      const { overlayData, formFieldData } = buildReceiptFillData({ receipt, bill, society, member });
      let pdfBytes;
      if (isImage) {
        const customPositions = Object.fromEntries(
          (receiptTemplate.imageFields || [])
            .filter((f) => f && f.name)
            .map((f) => [f.name, { x: f.x, y: f.y, fontSize: f.fontSize, maxWidth: f.width }]),
        );
        const generator = new FlexiblePDFGenerator(null, customPositions);
        pdfBytes = await generator.generateImageOverlay(stored.buffer, stored.contentType, overlayData);
      } else {
        const customPositions = Object.fromEntries(
          (receiptTemplate.pdfFields || [])
            .filter((f) => f && f.name)
            .map((f) => [f.name, { x: f.x, y: f.y, fontSize: f.fontSize, maxWidth: f.width }]),
        );
        const generator = new FlexiblePDFGenerator({ buffer: stored.buffer }, customPositions);
        pdfBytes = await generator.generateGenericOverlay(overlayData, formFieldData);
      }
      await Receipt.findByIdAndUpdate(id, { status: "Downloaded" });
      return new NextResponse(Buffer.from(pdfBytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${receipt.filename || receipt.receiptNo || "receipt"}.pdf"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    // Same admin-designed template (Bill Template page → Receipt scope) the
    // admin sees in preview — a saved design change is picked up on the very
    // next member download, no republish step needed.
    const design =
      receiptTemplate?.type === "custom" && receiptTemplate.design
        ? receiptTemplate.design
        : null;
    const html = generateReceiptHtml({ receipt, bill, society, member, design });
    // Mark as downloaded
    await Receipt.findByIdAndUpdate(id, { status: "Downloaded" });
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html",
        "Content-Disposition": `inline; filename="${receipt.filename || receipt.receiptNo || "receipt"}.html"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error", details: error.message },
      { status: 500 },
    );
  }
}
function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
// design comes from Society.receiptTemplate.design — the SAME object the
// admin edits/previews in the Bill Template page (Receipt scope). Any field
// left unset here falls back to the original built-in green receipt look, so
// a society that never customized its receipt sees no visual change.
function generateReceiptHtml({ receipt, bill, society, member, design }) {
  const d = design || {};
  const headerBg = d.headerBg || "linear-gradient(135deg, #059669, #10b981)";
  const headerColor = d.headerColor || "#ffffff";
  const tableHeaderBg = d.tableHeaderBg || "#F9FAFB";
  const tableHeaderColor = d.tableHeaderColor || "#374151";
  const totalBg = d.totalBg || "#ECFDF5";
  const totalColor = d.totalColor || "#059669";
  const totalBorderColor = d.totalColor || "#059669";
  const footerSize = d.footerSize || 11;
  const footerLines = Array.isArray(d.footerText) && d.footerText.length
    ? d.footerText
    : null;
  const formatDate = (d2) =>
    new Date(d2).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  const baseCharges = bill?.charges ? Object.entries(bill.charges) : [];
  const allChargeRows = [
    ...baseCharges,
    ...(bill?.interestAmount > 0
      ? [["Interest on Arrears", bill.interestAmount]]
      : []),
    ...((receipt.previousBalanceSnapshot ?? bill?.previousBalance ?? 0) > 0
      ? [
          [
            "Previous Balance",
            receipt.previousBalanceSnapshot ?? bill.previousBalance,
          ],
        ]
      : []),
  ];
  return `<!DOCTYPE html>
<html>
<head>
  <title>${receipt.filename || receipt.receiptNo || "Receipt"}</title>
  <meta charset="UTF-8"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: #f0f2f5; padding: 30px; color: #1a1a1a; }
    .wrapper { max-width: 680px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.1); }
    .header { background: ${headerBg}; color: ${headerColor}; padding: 32px; text-align: center; }
    .logo { max-height: 56px; margin-bottom: 10px; }
    .checkmark { font-size: 48px; margin-bottom: 12px; }
    .header h1 { font-size: 28px; margin-bottom: 4px; }
    .receipt-no { font-size: 13px; opacity: 0.85; margin-top: 6px; }
    .society-name { font-size: 16px; margin-top: 8px; opacity: 0.9; }
    .body { padding: 32px; }
    .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #F3F4F6; font-size: 14px; }
    .row:last-child { border-bottom: none; }
    .label { color: #6B7280; }
    .value { font-weight: 600; color: #1F2937; }
    .charges-section { background: #F9FAFB; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .charges-title { font-size: 13px; font-weight: 700; color: ${tableHeaderColor}; background: ${tableHeaderBg}; text-transform: uppercase; letter-spacing: 0.5px; margin: -20px -20px 14px -20px; padding: 10px 20px; border-radius: 8px 8px 0 0; }
    .charge-row { display: flex; justify-content: space-between; font-size: 13px; padding: 6px 0; }
    .total-box { background: ${totalBg}; border: 2px solid ${totalBorderColor}; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
    .total-label { font-size: 13px; color: ${totalColor}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .total-amount { font-size: 36px; font-weight: 700; color: ${totalColor}; }
    .footer { background: #F9FAFB; padding: 20px 32px; text-align: center; font-size: ${footerSize}px; color: #9CA3AF; border-top: 1px solid #E5E7EB; }
    .signature { margin-top: 24px; text-align: right; padding: 0 32px; }
    .signature img { max-height: 48px; }
    @media print {
  body { background: white; padding: 0; }
  .bill-wrapper { box-shadow: none; border-radius: 0; }
  @page { margin: 8mm; size: A4; }
  .page-break { page-break-before: always; }
}
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      ${d.logoUrl ? `<img class="logo" src="${escapeHtml(d.logoUrl)}" alt="logo"/>` : `<div class="checkmark">✅</div>`}
      <h1>Payment Receipt</h1>
      <div class="receipt-no">Receipt No: ${escapeHtml(receipt.receiptNo)}</div>
      <div class="society-name">${escapeHtml(society?.name || "")}</div>
    </div>
    <div class="body">
      <div class="row"><span class="label">Date of Payment</span><span class="value">${formatDate(receipt.paidAt)}</span></div>
      <div class="row"><span class="label">Member Name</span><span class="value">${escapeHtml(member?.ownerName || "")}</span></div>
      <div class="row"><span class="label">Flat No.</span><span class="value">${escapeHtml(member?.wing)}-${escapeHtml(member?.flatNo)}</span></div>
      <div class="row"><span class="label">Membership No.</span><span class="value">${escapeHtml(member?.membershipNumber || "—")}</span></div>
      <div class="row"><span class="label">Bill Period</span><span class="value">${escapeHtml(receipt.billPeriodId)}</span></div>
      <div class="row"><span class="label">Payment Mode</span><span class="value">${escapeHtml(receipt.paymentMode)}</span></div>
      <div class="row"><span class="label">Transaction ID</span><span class="value" style="font-family: monospace; font-size: 12px;">${escapeHtml(receipt.transactionId)}</span></div>
           ${
             allChargeRows.length > 0
               ? `
      <div class="charges-section">
        <div class="charges-title">Bill Breakdown</div>
        ${allChargeRows
          .map(
            ([name, amt]) => `
          <div class="charge-row">
            <span>${escapeHtml(name)}</span>
            <span style="font-weight:600">₹${parseFloat(amt).toLocaleString("en-IN")}</span>
          </div>
        `,
          )
          .join("")}
      </div>
    `
               : ""
           }
      <div class="total-box">
        <div class="total-label">Amount Paid</div>
        <div class="total-amount">₹${receipt.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
      </div>
      ${
        d.showSignature && d.signatureUrl
          ? `<div class="signature"><img src="${escapeHtml(d.signatureUrl)}" alt="signature"/><div style="font-size:11px;color:#6B7280;">${escapeHtml(d.signatureLabel || "Authorized Signatory")}</div></div>`
          : ""
      }
    </div>
    <div class="footer">
      ${
        footerLines
          ? footerLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")
          : `${escapeHtml(society?.name || "")} | ${escapeHtml(society?.address || "")}<br/>Generated on ${new Date().toLocaleString("en-IN")} | Computer Generated Receipt`
      }
    </div>
  </div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 400); }</script>
</body>
</html>`;
}
