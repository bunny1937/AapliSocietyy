import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Society from "@/models/Society";
import BillingHead from "@/models/BillingHead";
import { parseFirstSheet } from "@/lib/excelParse";
import { requireRoles, BILLING_WRITE_ROLES } from "@/lib/authz";
import { calculateMonthlyInterest } from "@/utils/interestUtils";
import { resolveOpeningBalances } from "@/lib/billing/generationService";
import { validateBillInvariants } from "@/lib/billing/invariants";
import { getSocietySnapshot, getBilledSet } from "@/lib/import/societySnapshot";
import ImportStaging from "@/models/ImportStaging";
import { authorize } from "@/lib/rbac/authorize";

const twoDp = (n) => parseFloat((Number(n) || 0).toFixed(2));
export async function POST(request) {
  try {
    const gate = await authorize(request, "billing.bill.import");
    if (!gate.ok) return gate.response;
    await connectDB();    const decoded = gate.context;
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    // STEP 1: PREVIEW
    if (action === "preview") {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file) {
        return NextResponse.json(
          { error: "No file uploaded" },
          { status: 400 },
        );
      }
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const fileHash = createHash("sha256").update(buffer).digest("hex");
      // Read Excel
      const data = await parseFirstSheet(buffer);
      if (data.length === 0) {
        return NextResponse.json(
          { error: "Excel file is empty" },
          { status: 400 },
        );
      }
      // Get headers
      const headers = Object.keys(data[0]);
      // Required columns
      const required = ["Member ID", "Bill Month", "Bill Year"];
      const missing = required.filter((r) => !headers.includes(r));
      if (missing.length > 0) {
        return NextResponse.json(
          {
            error: `Missing required columns: ${missing.join(", ")}`,
          },
          { status: 400 },
        );
      }
      // Only the periods this file actually mentions - not every bill the
      // society has ever had. See lib/import/societySnapshot.js for why the
      // old unbounded Bill.find({ societyId }) got slower every month.
      const periodIds = [
        ...new Set(
          data
            .map((r) => {
              const m = parseInt(r["Bill Month"]);
              const y = parseInt(r["Bill Year"]);
              return isNaN(m) || isNaN(y) ? null : `${y}-${String(m + 1).padStart(2, "0")}`;
            })
            .filter(Boolean),
        ),
      ];
      const [snapshot, billedSet] = await Promise.all([
        getSocietySnapshot(decoded.societyId),
        getBilledSet(decoded.societyId, periodIds),
      ]);
      const memberMap = new Map(
        snapshot.members.map((m) => [m._id.toString(), m]),
      );
      // Validate rows
      const rows = [];
      let valid = 0,
        warnings = 0,
        errors = 0,
        duplicates = 0;
      const duplicateList = [];
      const errorList = [];
      data.forEach((row, index) => {
        const issues = [];
        let status = "Valid";
        const rowNumber = index + 2; // Excel row number
        // Validate Member ID
        const memberId = row["Member ID"]?.toString().trim();
        if (!memberId) {
          issues.push("Member ID missing");
          status = "Error";
        } else if (!memberMap.has(memberId)) {
          issues.push("Member ID not found");
          status = "Error";
        }
        // Validate Month & Year
        const billMonth = parseInt(row["Bill Month"]);
        const billYear = parseInt(row["Bill Year"]);
        if (isNaN(billMonth) || billMonth < 0 || billMonth > 11) {
          issues.push("Invalid Bill Month (0-11)");
          status = "Error";
        }
        if (isNaN(billYear) || billYear < 2000 || billYear > 2100) {
          issues.push("Invalid Bill Year");
          status = "Error";
        }
        // Check duplicates
        const periodId = `${billYear}-${String(billMonth + 1).padStart(2, "0")}`;
        if (billedSet.has(`${memberId}|${periodId}`)) {
          issues.push("Duplicate bill exists");
          status = "Error";
          duplicates++;
          const member = memberMap.get(memberId);
          duplicateList.push({
            member: member ? `${member.wing}-${member.roomNo}` : "Unknown",
            period: `${billYear}-${String(billMonth + 1).padStart(2, "0")}`,
            rowNumber,
          });
        }
        // Validate amounts (all charge columns)
        const chargeColumns = headers.filter(
          (h) =>
            ![
              "Member ID",
              "Wing",
              "Room No",
              "Bill Month",
              "Bill Year",
              "Due Date",
              "Notes",
            ].includes(h),
        );
        const charges = {};
        chargeColumns.forEach((col) => {
          const value = parseFloat(row[col]);
          if (!isNaN(value) && value > 0) {
            charges[col] = value;
          }
        });
        const totalAmount = Object.values(charges).reduce(
          (sum, val) => sum + val,
          0,
        );
        if (totalAmount === 0) {
          issues.push("Total amount is 0");
          status = "Warning";
          warnings++;
        }
        if (status === "Error") {
          errors++;
          errorList.push({ rowNumber, message: issues.join(", ") });
        } else if (status === "Valid") {
          valid++;
        }
        const member = memberMap.get(memberId);
        rows.push({
          rowNumber,
          status,
          member: member ? `${member.wing}-${member.roomNo}` : "Unknown",
          period: `${billYear}-${String(billMonth + 1).padStart(2, "0")}`,
          amount: totalAmount.toFixed(2),
          issues,
          data: row,
        });
      });
      // Staged in Mongo, not process memory - a serverless instance can be
      // frozen or recycled between this request and the confirm click, and
      // there is no guarantee both land on the same instance anyway.
      const staged = await ImportStaging.create({
        societyId: decoded.societyId,
        createdBy: decoded.userId,
        kind: "bills",
        fileHash,
        fileName: file.name,
        rows,
        rowCount: rows.length,
      });
      return NextResponse.json({
        batchId: String(staged._id),
        total: rows.length,
        valid,
        warnings,
        errors,
        duplicates,
        duplicateList: duplicateList.slice(0, 50),
        errorList: errorList.slice(0, 50),
        rows,
      });
    }
    // STEP 2: CONFIRM
    if (action === "confirm") {
      const { batchId } = await request.json();
      // Atomic claim, scoped to this society: a double-submit races the same
      // document and only one request can win.
      const staged = await ImportStaging.findOneAndUpdate(
        {
          _id: batchId,
          societyId: decoded.societyId,
          kind: "bills",
          consumedAt: null,
        },
        { $set: { consumedAt: new Date() } },
        { new: true },
      ).lean();
      if (!staged) {
        const any = await ImportStaging.exists({ _id: batchId, societyId: decoded.societyId });
        return NextResponse.json(
          { error: any ? "This import was already completed." : "Preview expired. Re-upload the file." },
          { status: any ? 409 : 410 },
        );
      }
      const { rows, societyId: cachedSocietyId, createdBy: cachedUserId } = staged;
      const validRows = rows.filter((r) => r.status === "Valid");
      // Fetch members again
      const members = await Member.find({
        societyId: cachedSocietyId,
      }).lean();
      const memberMap = new Map(members.map((m) => [m._id.toString(), m]));
      const society = await Society.findById(cachedSocietyId).lean();
      const interestRate = society?.config?.interestRate || 0;
      const interestRounding = society?.config?.interestRounding || "TWO_DECIMAL";

      // Ledger V2: admin-specified custom charge columns bypass BillingHeads
      // (that's the point of this importer), so it can't call generateBill()
      // directly — but opening-balance carry-forward and interest still use
      // the SAME canonical formula/invariants as every other generation path.
      const billsToInsert = [];
      const errors = [];
      for (const row of validRows) {
        try {
          const data = row.data;
          const memberId = data["Member ID"].toString().trim();
          const member = memberMap.get(memberId);
          if (!member) throw new Error("Member not found");
          const billMonth = parseInt(data["Bill Month"]);
          const billYear = parseInt(data["Bill Year"]);
          const billPeriodId = `${billYear}-${String(billMonth + 1).padStart(2, "0")}`;

          const chargesMap = new Map();
          Object.keys(data).forEach((key) => {
            if (
              ![
                "Member ID", "Wing", "Room No", "Bill Month", "Bill Year",
                "Due Date", "Notes", "Total Amount",
              ].includes(key)
            ) {
              const value = parseFloat(data[key]);
              if (!isNaN(value) && value > 0) chargesMap.set(key, value);
            }
          });
          const currentCharges = twoDp(
            Array.from(chargesMap.values()).reduce((sum, v) => sum + v, 0),
          );

          const { openingPrincipal, openingInterest } = await resolveOpeningBalances({
            memberId,
            societyId: cachedSocietyId,
            year: billYear,
            month: billMonth + 1,
            member,
          });

          let currentInterest = 0;
          if (openingPrincipal > 0) {
            const { currInt } = calculateMonthlyInterest({
              remainingPrincipal: openingPrincipal,
              remInt: 0,
              annualRate: interestRate,
              interestRounding,
            });
            currentInterest = twoDp(currInt);
          }

          const billPrincipalBalance = twoDp(openingPrincipal + currentCharges);
          const billInterestBalance = twoDp(openingInterest + currentInterest);
          const totalBillDue = twoDp(billPrincipalBalance + billInterestBalance);
          // No-payment-yet default (§1/§3): closing = opening + current.
          const closingPrincipal = billPrincipalBalance;
          const closingInterest = billInterestBalance;
          const balanceAmount = twoDp(closingPrincipal + closingInterest);

          const chargesObj = Object.fromEntries(chargesMap);
          validateBillInvariants({
            openingPrincipal, openingInterest, currentCharges, currentInterest,
            totalBillDue, closingPrincipal, closingInterest, balanceAmount,
            charges: chargesObj,
          });

          const dueDate = data["Due Date"]
            ? new Date(data["Due Date"])
            : new Date(billYear, billMonth, 10);

          billsToInsert.push({
            billPeriodId,
            billMonth,
            billYear,
            memberId,
            societyId: cachedSocietyId,
            charges: chargesObj,
            openingPrincipal,
            openingInterest,
            currentCharges,
            currentInterest,
            interestRateApplied: interestRate,
            billPrincipalBalance,
            billInterestBalance,
            totalBillDue,
            closingPrincipal,
            closingInterest,
            closingTotal: balanceAmount,
            totalAmount: totalBillDue,
            balanceAmount,
            amountPaid: 0,
            dueDate,
            status: "Unpaid",
            importedFrom: "Excel",
            notes: data["Notes"] || "",
            generatedBy: cachedUserId,
            generatedAt: new Date(),
            schemaVersion: 2,
            calculationVersion: 1,
            engineVersion: "Ledger V2",
          });
        } catch (err) {
          errors.push({ rowNumber: row.rowNumber, error: err.message });
        }
      }
      if (billsToInsert.length > 0) await Bill.insertMany(billsToInsert);
      return NextResponse.json({
        success: true,
        imported: billsToInsert.length,
        failed: errors.length,
        errors: errors.length > 0 ? errors : undefined,
        message: `${billsToInsert.length} bill(s) imported successfully`,
      });
    }
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Import bills error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error.message,
      },
      { status: 500 },
    );
  }
}
