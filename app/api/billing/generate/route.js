import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import Transaction from "@/models/Transaction";
import Society from "@/models/Society";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";

export async function POST(request) {
  try {
    await connectDB();

    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    if (decoded.role === "Accountant") {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const { year, month, bills } = await request.json();

    if (!year || !month || !bills || bills.length === 0) {
      return NextResponse.json(
        { error: "Year, month, and bills data are required" },
        { status: 400 }
      );
    }

    const billPeriod = `${year}-${String(month).padStart(2, "0")}`;
    const startDate = new Date(year, month - 1, 1);

    // Check if bills already exist
    const existingBills = await Transaction.countDocuments({
      societyId: decoded.societyId,
      billPeriodId: billPeriod,
      category: "Maintenance",
    });

    if (existingBills > 0) {
      return NextResponse.json(
        { error: `Bills already exist for ${billPeriod}` },
        { status: 400 }
      );
    }

    // Get society and template
    const society = await Society.findById(decoded.societyId).lean();
    const billTemplate = society?.billTemplate;

    if (!billTemplate) {
      return NextResponse.json(
        { error: "No bill template found. Please create one first." },
        { status: 400 }
      );
    }

    // Calculate financial year
    const financialYear =
      month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;

    const createdBills = [];
    const errors = [];

    for (const billData of bills) {
      try {
        // Fetch member
        const member = await Member.findById(billData.memberId).lean();
        if (!member) {
          errors.push({
            memberId: billData.memberId,
            error: "Member not found",
          });
          continue;
        }

        // Get previous balance
        const previousTransactions = await Transaction.find({
          societyId: decoded.societyId,
          memberId: member._id,
          date: { $lt: startDate },
        })
          .sort({ date: -1, createdAt: -1 })
          .limit(1)
          .lean();

        const previousBalance =
          previousTransactions.length > 0
            ? previousTransactions[0].balanceAfterTransaction
            : member.openingBalance || 0;

        const newBalance = previousBalance + billData.totalAmount;

        // Render HTML
        const billHtml = renderBillHtml(billTemplate.html, {
          society,
          member,
          breakdown: billData.breakdown,
          totalAmount: billData.totalAmount,
          previousBalance,
          newBalance,
          billPeriod,
          billDate: new Date().toLocaleDateString("en-IN"),
          dueDate: new Date(year, month - 1, 10).toLocaleDateString("en-IN"),
        });

        // Create transaction
        const transactionId = Transaction.generateTransactionId();

        const transaction = await Transaction.create({
          transactionId,
          societyId: decoded.societyId,
          memberId: member._id,
          date: startDate,
          type: "Debit",
          category: "Maintenance",
          description: `Bill for ${billPeriod}`,
          amount: billData.totalAmount,
          balanceAfterTransaction: newBalance,
          paymentMode: "System",
          createdBy: decoded.userId,
          billPeriodId: billPeriod,
          financialYear,
          billHtml, // Store rendered HTML
        });

        createdBills.push(transaction);
      } catch (err) {
        console.error(`Error creating bill:`, err);
        errors.push({
          memberId: billData.memberId,
          error: err.message,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Generated ${createdBills.length} bills`,
      billsGenerated: createdBills.length,
      billsFailed: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Bill generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate bills", details: error.message },
      { status: 500 }
    );
  }
}

function renderBillHtml(template, data) {
  let html = template;

  // Calculate interest if previous balance exists and overdue
  let interestAmount = 0;
  let interestDays = 0;
  const interestRate = data.society?.config?.interestRate || 21;
  const gracePeriod = data.society?.config?.interestGracePeriod || 15;

  if (data.previousBalance > 0) {
    // Assuming previous bill was from last month
    const previousDueDate = new Date(data.billDate);
    previousDueDate.setMonth(previousDueDate.getMonth() - 1);
    previousDueDate.setDate(10); // Due on 10th

    const today = new Date(data.billDate);
    const daysOverdue = Math.floor(
      (today - previousDueDate) / (1000 * 60 * 60 * 24)
    );

    if (daysOverdue > gracePeriod) {
      interestDays = daysOverdue - gracePeriod;
      // Interest = Principal × Rate × Time / 365
      interestAmount = Math.round(
        (data.previousBalance * (interestRate / 100) * interestDays) / 365
      );
    }
  }

  // Replace variables
  const replacements = {
    "{{societyName}}": data.society?.name || "",
    "{{societyAddress}}": data.society?.address || "",
    "{{memberName}}": data.member?.ownerName || "",
    "{{memberWing}}": data.member?.wing || "",
    "{{memberRoomNo}}": data.member?.roomNo || "",
    "{{memberArea}}": data.member?.areaSqFt || 0,
    "{{memberContact}}": data.member?.contact || "",
    "{{billPeriod}}": data.billPeriod || "",
    "{{billDate}}": data.billDate || "",
    "{{dueDate}}": data.dueDate || "",
    "{{totalAmount}}": `₹${data.totalAmount?.toLocaleString("en-IN") || 0}`,
    "{{previousBalance}}": `₹${Math.abs(
      data.previousBalance || 0
    ).toLocaleString("en-IN")} ${data.previousBalance < 0 ? "DR" : "CR"}`,
    "{{interestAmount}}": `₹${interestAmount.toLocaleString("en-IN")}`,
    "{{interestDays}}": interestDays.toString(),
    "{{interestRate}}": interestRate.toString(),
    "{{currentBalance}}": `₹${Math.abs(data.newBalance || 0).toLocaleString(
      "en-IN"
    )} ${data.newBalance < 0 ? "DR" : "CR"}`,
  };

  Object.entries(replacements).forEach(([key, value]) => {
    html = html.replace(new RegExp(key, "g"), value);
  });

  // Generate billing table
  const tableHtml = `
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <thead>
        <tr style="background-color: #f3f4f6;">
          <th style="border: 1px solid #000; padding: 8px; text-align: left;">Sr.</th>
          <th style="border: 1px solid #000; padding: 8px; text-align: left;">Description</th>
          <th style="border: 1px solid #000; padding: 8px; text-align: right;">Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(data.breakdown)
          .map(
            ([desc, amt], idx) => `
          <tr>
            <td style="border: 1px solid #ddd; padding: 8px;">${idx + 1}</td>
            <td style="border: 1px solid #ddd; padding: 8px;">${desc}</td>
            <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">₹${parseFloat(
              amt
            ).toFixed(2)}</td>
          </tr>
        `
          )
          .join("")}
        ${
          interestAmount > 0
            ? `
        <tr style="background-color: #FEE2E2;">
          <td style="border: 1px solid #DC2626; padding: 8px;">${
            Object.keys(data.breakdown).length + 1
          }</td>
          <td style="border: 1px solid #DC2626; padding: 8px; color: #DC2626;">
            <strong>Interest (${interestRate}% p.a.)</strong><br/>
            <span style="font-size: 11px;">Payment overdue by ${interestDays} days</span>
          </td>
          <td style="border: 1px solid #DC2626; padding: 8px; text-align: right; color: #DC2626; font-weight: bold;">₹${interestAmount.toFixed(
            2
          )}</td>
        </tr>
        `
            : ""
        }
        <tr style="font-weight: bold; background-color: #f9fafb;">
          <td colspan="2" style="border: 1px solid #000; padding: 8px; text-align: right;">TOTAL</td>
          <td style="border: 1px solid #000; padding: 8px; text-align: right;">₹${(
            data.totalAmount + interestAmount
          ).toLocaleString("en-IN")}</td>
        </tr>
      </tbody>
    </table>
  `;

  html = html.replace("{{BILLING_TABLE}}", tableHtml);

  return html;
}
