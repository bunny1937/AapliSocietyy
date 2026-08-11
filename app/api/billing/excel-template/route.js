import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import BillingHead from "@/models/BillingHead";
import Society from "@/models/Society";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { buildWorkbook, addSheetFromJson, workbookBuffer } from "@/lib/excelParse";
import Bill from "@/models/Bill";
import { calculateMonthlyInterest } from "../../../../utils/interestUtils";
import { safeConfigDate } from "../../../../utils/dateUtils";
import { resolveOpeningBalances } from "@/lib/billing/generationService";
import { authorize } from "@/lib/rbac/authorize";
export async function GET(request) {
  const gate = await authorize(request, "billing.bill.view");
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
    const [members, heads, society] = await Promise.all([
      Member.find(memberQuery)
        .select(
          "_id flatNo wing carpetAreaSqft contactNumber parkingSlots openingBalance openingPrincipal openingInterest advanceCredit",
        )
        .sort({ wing: 1, flatNo: 1 })
        .lean(),
      BillingHead.find({
        societyId: decoded.societyId,
        isActive: true,
        isDeleted: false,
      })
        .sort({ order: 1 })
        .lean(),
      Society.findById(decoded.societyId).lean(),
    ]);
    const _dueDayNum = society?.config?.interestAfterDays || 15;
    const dueDate = `${year}-${String(month).padStart(2, "0")}-${String(_dueDayNum).padStart(2, "0")}`;
    const parkingHeads = heads.filter((h) =>
      h.headName?.toLowerCase().includes("parking"),
    );
    const rows = await Promise.all(
      members.map(async (m) => {
        const area = Number(m.carpetAreaSqft || 0);
        let subtotal = 0;
        const periodId = `${year}-${String(month).padStart(2, "0")}`;
        const row = {
          "Wing-FlatNo": `${m.wing || ""}-${m.flatNo || ""}`,
          Period: periodId,
          CurrentCharges: 0, // placeholder — filled after subtotal is computed
        };
        // Non-parking heads — apply by calculationType
        for (const head of heads) {
          if (parkingHeads.includes(head)) {
            row[head.headName] = 0; // placeholder, filled below
            continue;
          }
          const hLower = head.headName.trim().toLowerCase();
          const isParking =
            hLower.includes("parking") &&
            (hLower.includes("two") ||
              hLower.includes("four") ||
              hLower.includes("wheeler"));
          let amount = 0;
          if (isParking) {
            const matchCount = (m.parkingSlots ?? []).filter((slot) => {
              if (slot.type === "Stilt" || slot.monthlyBilling === false)
                return false;
              const vehicleLabel = (slot.vehicleType || "")
                .replace(/-/g, " ")
                .toLowerCase();
              const slotType = (slot.type || "").toLowerCase();
              return hLower.includes(slotType) && hLower.includes(vehicleLabel);
            }).length;
            amount = head.defaultAmount * matchCount;
          } else if (head.calculationType === "Fixed") {
            amount = head.defaultAmount;
          } else if (head.calculationType === "Per Sq Ft") {
            amount = area * head.defaultAmount;
          } else if (head.calculationType === "Percentage") {
            amount = (subtotal * head.defaultAmount) / 100;
          }
          row[head.headName] = parseFloat(amount.toFixed(2));
          subtotal += amount;
        }
        // Parking — only charge slots this member actually has (skip Stilt)
        for (const slot of m.parkingSlots || []) {
          if (slot.type === "Stilt" || slot.monthlyBilling === false) continue;
          const normalize = (s) => s.replace(/-/g, " ").toLowerCase();
          const slotKey = normalize(`${slot.type} Parking - ${slot.vehicleType}`);
          const matchHead = parkingHeads.find(
            (h) => normalize(h.headName) === slotKey,
          );
          if (!matchHead || matchHead.defaultAmount <= 0) continue;
          row[matchHead.headName] =
            (row[matchHead.headName] || 0) + matchHead.defaultAmount;
          subtotal += matchHead.defaultAmount;
        }
        row["CurrentCharges"] = parseFloat(subtotal.toFixed(2)); // overwritten below if bill already exists
        const interestRate = parseFloat(society?.config?.interestRate || 0);
        const currentPeriodId = `${year}-${String(month).padStart(2, "0")}`;
        // Ledger V2: same single-lookup carry-forward GenerationService uses,
        // so this preview can never diverge from what generateBill() computes.
        const { openingPrincipal: prevRemPrincipal, openingInterest: prevRemInt } =
          await resolveOpeningBalances({
            memberId: m._id,
            societyId: decoded.societyId,
            year,
            month,
            member: m,
          });
        // If bill already generated — use stored values exactly, never recalculate
        const existingBill = await Bill.findOne({
          memberId: m._id,
          societyId: decoded.societyId,
          billPeriodId: currentPeriodId,
          isDeleted: { $ne: true },
        })
          .select(
            "openingPrincipal openingInterest currentCharges currentBillTotal subtotal currentInterest billPrincipalBalance billInterestBalance totalBillDue totalAmount balanceAmount amountPaid status interestAmount",
          )
          .lean();
        let currInt,
          billPrincipal,
          billInterest,
          totalBillDue,
          alreadyPaid,
          remainingDue,
          billStatus;
        const advanceCredit = parseFloat((m.advanceCredit || 0).toFixed(2));
        if (existingBill) {
          // Use stored bill data — source of truth
          currInt = parseFloat(
            (
              existingBill.currentInterest ??
              existingBill.interestAmount ??
              0
            ).toFixed(2),
          );
          billPrincipal = parseFloat(
            (
              existingBill.billPrincipalBalance ??
              existingBill.totalAmount ??
              0
            ).toFixed(2),
          );
          billInterest = parseFloat(
            (existingBill.billInterestBalance ?? 0).toFixed(2),
          );
          totalBillDue = parseFloat(
            (
              existingBill.totalBillDue ??
              existingBill.totalAmount ??
              0
            ).toFixed(2),
          );
          alreadyPaid = parseFloat((existingBill.amountPaid ?? 0).toFixed(2));
          // Use balanceAmount directly — it's the live net after payments and advance
          remainingDue = parseFloat(
            Math.max(0, existingBill.balanceAmount ?? Math.max(0, totalBillDue - alreadyPaid)).toFixed(2),
          );
          // Compute status dynamically — never trust stored status (may be stale after payments)
          billStatus =
            remainingDue <= 0.005 ? "Paid" : alreadyPaid > 0 ? "Partial" : "Unpaid";
          // Use stored bill values — do not recalculate from billing heads
          row["OpeningPrincipal"] = parseFloat(
            (existingBill.openingPrincipal ?? openingPrincipal).toFixed(2),
          );
          row["OpeningInterest"] = parseFloat(
            (existingBill.openingInterest ?? openingInterest).toFixed(2),
          );
          // CurrentCharges = THIS MONTH's charge sum only. Never currentBillTotal
// (that's the grand total incl. opening + interest — it was showing 3580).
row["CurrentCharges"] = parseFloat(
  (
    existingBill.currentCharges ??
    existingBill.subtotal ??
    subtotal
  ).toFixed(2),
);
        } else {
          // Pre-generation preview — calculate fresh
          const { currInt: calcInt } = calculateMonthlyInterest({
            remainingPrincipal: prevRemPrincipal,
            remInt: prevRemInt,
            annualRate: interestRate,
            interestRounding:
              society?.config?.interestRounding || "TWO_DECIMAL",
          });
          currInt = calcInt;
          billPrincipal = parseFloat((prevRemPrincipal + subtotal).toFixed(2));
          billInterest = parseFloat((prevRemInt + currInt).toFixed(2));
          totalBillDue = parseFloat((billPrincipal + billInterest).toFixed(2));
          alreadyPaid = 0;
          remainingDue = parseFloat(
            Math.max(0, totalBillDue - advanceCredit).toFixed(2),
          );
          billStatus = "Not Generated";
          row["OpeningPrincipal"] = parseFloat(prevRemPrincipal.toFixed(2));
          row["OpeningInterest"] = parseFloat(prevRemInt.toFixed(2));
        }
        row["CurrentInterest"] = currInt;
        row["BillPrincipal"] = billPrincipal;
        row["BillInterest"] = billInterest;
        row["TotalBillDue"] = totalBillDue;
        row["AlreadyPaid"] = alreadyPaid;
        row["AdvanceCredit"] = advanceCredit;
        row["RemainingDue"] = remainingDue;
        row["AmountPaid"] = "";
        row["PaymentMethod"] = "";
        row["PaymentDate"] = "";
        row["Remarks"] = "";
        return row;
      }),
    );
    const instructions = [
      {
        "Wing-FlatNo": "⚠ DO NOT change Wing-FlatNo, Period columns",
        Period: "",
        CurrentCharges: "READ ONLY",
        OpeningPrincipal: "READ ONLY",
        OpeningInterest: "READ ONLY",
        CurrentInterest: "READ ONLY",
        BillPrincipal: "READ ONLY",
        BillInterest: "READ ONLY",
        TotalBillDue: "READ ONLY",
        AlreadyPaid: "READ ONLY",
        AdvanceCredit: "READ ONLY",
        RemainingDue: "READ ONLY",
          AmountPaid: "← FILL THIS",
    PaymentMethod: "Cash / Cheque / Online / NEFT / UPI",
    PaymentDate: "YYYY-MM-DD",
    Remarks: "",
    // charge-head breakdown columns (now at the end) — reference only
    ...Object.fromEntries(heads.map((h) => [h.headName, "READ ONLY (breakdown)"])),
  },
];
 // Explicit, deterministic column order so headers and data ALWAYS line up.
// Previously json_to_sheet inferred columns from the first object (the
// instructions row), which omitted the charge-head keys and pushed them to
// the far right — misaligning every charge value by one column and injecting
// phantom parking amounts into the system re-sum (the ₹400 mismatch).
const chargeHeadCols = heads.map((h) => h.headName);
const columns = [
  "Wing-FlatNo",
  "Period",
  "CurrentCharges",
  "OpeningPrincipal",
  "OpeningInterest",
  "CurrentInterest",
  "BillPrincipal",
  "BillInterest",
  "TotalBillDue",
  "AlreadyPaid",
  "AdvanceCredit",
  "RemainingDue",
  "AmountPaid",
  "PaymentMethod",
  "PaymentDate",
  "Remarks",
    ...chargeHeadCols,

];
    // Note in instructions row already says "DO NOT EDIT" — PreviousBalance/InterestDue/GrandTotal are for reference only
    const wb = buildWorkbook();
    addSheetFromJson(wb, `Bills_${year}_${String(month).padStart(2, "0")}`, [...instructions, ...rows], {
      headers: columns,
      colWidths: columns.map((k) => Math.max(k.length + 2, 16)),
    });
    const buf = await workbookBuffer(wb);
    return new NextResponse(buf, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="BillTemplate_${year}-${String(month).padStart(2, "0")}.xlsx"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
