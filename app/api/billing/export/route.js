import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { buildWorkbook, addSheetFromJson, workbookBuffer } from "@/lib/excelParse";
import { authorize } from "@/lib/rbac/authorize";
export async function POST(request) {
  const gate = await authorize(request, "billing.bill.export");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const { period } = await request.json();
    const query = {
      societyId: decoded.societyId,
      isDeleted: { $ne: true },
    };
    if (period) query.billPeriodId = period;
    const bills = await Bill.find(query)
      .populate(
        "memberId",
        "flatNo wing ownerName contactNumber carpetAreaSqft",
      )
      .sort({ billYear: -1, billMonth: -1, "memberId.wing": 1 })
      .lean();
    if (!bills.length) {
      return NextResponse.json(
        { error: "No bills found for this period" },
        { status: 404 },
      );
    }
    // Normalize charge key — strip slot number suffix like " (P-A-101)"
    const normalizeKey = (k) => k.replace(/\s*\(P-[A-Z]-\d+\)\s*$/i, "").trim();
    // Collect all unique normalized charge head names
    const allHeads = new Set();
    bills.forEach((b) => {
      Object.keys(b.charges || {}).forEach((k) =>
        allHeads.add(normalizeKey(k)),
      );
    });
    const headCols = [...allHeads].sort();
    const rows = bills.map((b) => {
      const row = {
        "Bill Period": b.billPeriodId || "",
        Wing: b.memberId?.wing || "",
        "Flat No": b.memberId?.flatNo || "",
        "Owner Name": b.memberId?.ownerName || "",
        Contact: b.memberId?.contactNumber || "",
        "Area (Sq Ft)": b.memberId?.carpetAreaSqft || "",
        "Previous Balance": parseFloat((b.previousBalance || 0).toFixed(2)),
        "Interest Amount": parseFloat((b.interestAmount || 0).toFixed(2)),
      };
      // Sum all charge keys that normalize to the same head name
      for (const head of headCols) {
        let total = 0;
        Object.entries(b.charges || {}).forEach(([k, v]) => {
          if (normalizeKey(k) === head) total += Number(v) || 0;
        });
        row[head] = parseFloat(total.toFixed(2));
      }
      row["Subtotal"] = parseFloat((b.subtotal || 0).toFixed(2));
      row["Service Tax"] = parseFloat((b.serviceTax || 0).toFixed(2));
      row["Total Amount"] = parseFloat((b.totalAmount || 0).toFixed(2));
      row["Amount Paid"] = parseFloat((b.amountPaid || 0).toFixed(2));
      row["Balance Due"] = parseFloat((b.balanceAmount || 0).toFixed(2));
      row["Due Date"] = b.dueDate
        ? new Date(b.dueDate).toLocaleDateString("en-IN")
        : "";
      row["Status"] = b.status || "Unpaid";
      row["Generated At"] = b.generatedAt
        ? new Date(b.generatedAt).toLocaleDateString("en-IN")
        : "";
      return row;
    });
    const wb = buildWorkbook();
    addSheetFromJson(wb, period ? `Bills_${period}` : "All_Bills", rows, {
      colWidths: Object.keys(rows[0] || {}).map((k) => Math.max(k.length + 2, 14)),
    });
    const buf = await workbookBuffer(wb);
    const filename = period ? `Bills-${period}.xlsx` : `Bills-All.xlsx`;
    return new NextResponse(buf, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("Export bills error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
