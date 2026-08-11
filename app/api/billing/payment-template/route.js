import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import Receipt from "@/models/Receipt";
import Society from "@/models/Society";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { buildWorkbook, addSheetFromJson, workbookBuffer } from "@/lib/excelParse";
import { authorize } from "@/lib/rbac/authorize";
function twoDp(n) {
  return parseFloat((Number(n) || 0).toFixed(2));
}
export async function GET(request) {
  const gate = await authorize(request, "finance.payment.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const month = parseInt(
      searchParams.get("month") || new Date().getMonth() + 1,
    );
    const year = parseInt(searchParams.get("year") || new Date().getFullYear());
    if (isNaN(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: "Invalid month" }, { status: 400 });
    }
    if (isNaN(year) || year < 2000) {
      return NextResponse.json({ error: "Invalid year" }, { status: 400 });
    }
    const billPeriodId = `${year}-${String(month).padStart(2, "0")}`;
    const memberIdFilter = searchParams.get("memberIds");
    const memberIdSet = memberIdFilter
      ? memberIdFilter
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : null;
    const memberQuery = {
      societyId: decoded.societyId,
      isDeleted: { $ne: true },
    };
    if (memberIdSet?.length) memberQuery._id = { $in: memberIdSet };
    const [members, society] = await Promise.all([
      Member.find(memberQuery)
        .select("_id flatNo wing")
        .sort({ wing: 1, flatNo: 1 })
        .lean(),
      Society.findById(decoded.societyId).select("config").lean(),
    ]);
    const dueDay = society?.config?.billDueDay || 10;
    const dueDate = new Date(year, month - 1, dueDay)
      .toISOString()
      .split("T")[0];
    const memberIds = members.map((m) => m._id);
    const bills = await Bill.find({
      societyId: decoded.societyId,
      billPeriodId,
      memberId: { $in: memberIds },
      isDeleted: { $ne: true },
    })
      .select(
        "memberId openingPrincipal openingInterest currentCharges currentInterest billPrincipalBalance billInterestBalance totalBillDue amountPaid balanceAmount status principalBalance interestBalance totalAmount dueDate",
      )
      .lean();
    const billMap = new Map(bills.map((b) => [b.memberId.toString(), b]));
    // Fetch last receipt per member for LastReceiptNo / LastPaymentDate columns
    const lastReceipts = await Receipt.find({
      societyId: decoded.societyId,
      memberId: { $in: memberIds },
    })
      .sort({ paidAt: -1 })
      .select("memberId receiptNo paidAt")
      .lean();
    // Keep only latest receipt per member
    const receiptMap = new Map();
    for (const r of lastReceipts) {
      const key = r.memberId.toString();
      if (!receiptMap.has(key)) receiptMap.set(key, r);
    }
    const today = new Date().toISOString().split("T")[0];
    const rows = members.map((m) => {
      const bill = billMap.get(m._id.toString());
      const lastReceipt = receiptMap.get(m._id.toString());
      const lastReceiptNo = lastReceipt?.receiptNo || "";
      const lastPaymentDate = lastReceipt?.paidAt
        ? new Date(lastReceipt.paidAt).toISOString().split("T")[0]
        : "";
      if (bill) {
        const openingPrincipal = twoDp(bill.openingPrincipal || 0);
        const openingInterest = twoDp(bill.openingInterest || 0);
        const currentCharges = twoDp(
          bill.currentCharges || bill.totalAmount || 0,
        );
        const currentInterest = twoDp(bill.currentInterest || 0);
        const billPrincipal = twoDp(
          bill.billPrincipalBalance || bill.principalBalance || 0,
        );
        const billInterest = twoDp(
          bill.billInterestBalance || bill.interestBalance || 0,
        );
        const totalBillDue = twoDp(bill.totalBillDue || bill.totalAmount || 0);
        const alreadyPaid = twoDp(bill.amountPaid || 0);
        const remaining = twoDp(
          bill.balanceAmount ?? Math.max(0, totalBillDue - alreadyPaid),
        );
        const advanceCredit = twoDp(bill.advanceApplied || 0);
        const billDueDate = bill.dueDate
          ? new Date(bill.dueDate).toISOString().split("T")[0]
          : dueDate;
        return {
          MemberId: m._id.toString(),
          "Wing-FlatNo": `${m.wing}-${m.flatNo}`,
          Month: month,
          Year: year,
          DueDate: billDueDate,
          OpeningPrincipal: openingPrincipal,
          OpeningInterest: openingInterest,
          CurrentCharges: currentCharges,
          CurrentInterest: currentInterest,
          BillPrincipal: billPrincipal,
          BillInterest: billInterest,
          TotalBillDue: totalBillDue,
          AlreadyPaid: alreadyPaid,
          AdvanceCredit: advanceCredit,
          RemainingDue: remaining,
          AmountPaid: "",
          PaymentMethod: "Cash",
          PaymentDate: today,
          Remarks: "",
          LastReceiptNo: lastReceiptNo,
          LastPaymentDate: lastPaymentDate,
        };
      }
      // No bill generated for this period yet
      return {
        MemberId: m._id.toString(),
        "Wing-FlatNo": `${m.wing}-${m.flatNo}`,
        Month: month,
        Year: year,
        DueDate: dueDate,
        OpeningPrincipal: "",
        OpeningInterest: "",
        CurrentCharges: "",
        CurrentInterest: "",
        BillPrincipal: "",
        BillInterest: "",
        TotalBillDue: "",
        AlreadyPaid: "",
        AdvanceCredit: "",
        RemainingDue: "",
        AmountPaid: "",
        PaymentMethod: "Cash",
        PaymentDate: today,
        Remarks: "",
        LastReceiptNo: lastReceiptNo,
        LastPaymentDate: lastPaymentDate,
      };
    });
    const instructions = [
      {
        MemberId: "⚠ DO NOT change MemberId, Wing-FlatNo, Month, Year",
        "Wing-FlatNo": "Fill AmountPaid, PaymentMethod, PaymentDate, Remarks only",
        Month: "",
        Year: "",
        DueDate: "",
        OpeningPrincipal: "READ ONLY",
        OpeningInterest: "READ ONLY",
        CurrentCharges: "READ ONLY",
        CurrentInterest: "READ ONLY",
        BillPrincipal: "READ ONLY",
        BillInterest: "READ ONLY",
        TotalBillDue: "READ ONLY",
        AlreadyPaid: "READ ONLY",
        AdvanceCredit: "READ ONLY",
        RemainingDue: "READ ONLY",
        AmountPaid: "← FILL THIS",
        PaymentMethod: "Cash/Cheque/Online/NEFT/UPI",
        PaymentDate: "DD-MM-YYYY or YYYY-MM-DD",
        Remarks: "Optional note",
        LastReceiptNo: "READ ONLY - previous receipt",
        LastPaymentDate: "READ ONLY - previous payment date",
      },
    ];
    const wb = buildWorkbook();
    const headerKeys = Object.keys(rows[0] || {});
    addSheetFromJson(wb, `Payments_${billPeriodId}`, [...instructions, ...rows], {
      colWidths: headerKeys.map((k) => Math.max(k.length + 2, 14)),
    });
    const buf = await workbookBuffer(wb);
    return new NextResponse(buf, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="PaymentTemplate_${billPeriodId}.xlsx"`,
      },
    });
  } catch (err) {
    console.error("payment-template error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
