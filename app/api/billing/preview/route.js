// app/api/billing/preview/route.js
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import Society from "@/models/Society";
import BillingHead from "@/models/BillingHead";
import Transaction from "@/models/Transaction";
import { safeConfigDate } from "../../../../utils/dateUtils";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
export async function POST(request) {
  const gate = await authorize(request, "billing.bill.view");
  if (!gate.ok) return gate.response;
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
    const { month, year, memberId } = await request.json();
    if (month === undefined || !year) {
      return NextResponse.json(
        { error: "Month and year required" },
        { status: 400 },
      );
    }
    // Fetch society config
    const society = await Society.findById(decoded.societyId).lean();
    if (!society) {
      return NextResponse.json({ error: "Society not found" }, { status: 404 });
    }
    // Fetch billing heads
    const billingHeads = await BillingHead.find({
      societyId: decoded.societyId,
      isActive: true,
      isDeleted: false,
    })
      .sort({ order: 1 })
      .lean();
    // Fetch members
    const memberQuery = { societyId: decoded.societyId };
    if (memberId) {
      memberQuery._id = memberId;
    }
    const members = await Member.find(memberQuery).lean();
    if (members.length === 0) {
      return NextResponse.json({ error: "No members found" }, { status: 404 });
    }
    // Generate preview data
    const billPeriod = `${year}-${String(month + 1).padStart(2, "0")}`;
    const billDate = new Date(year, month - 1, 1); // also fix: was using month (0-based off-by-one bug)
    const dueDate = safeConfigDate(
      year,
      month,
      society.config?.billDueDay || 10,
    );
    const preview = [];
    for (const member of members) {
      // Get previous balance
      const lastTransaction = await Transaction.findOne({
        societyId: decoded.societyId,
        memberId: member._id,
        date: { $lt: billDate },
      })
        .sort({ date: -1, createdAt: -1 })
        .lean();
      const previousBalance = lastTransaction?.balanceAfterTransaction || 0;
      // Calculate charges
      const charges = [];
      let subtotal = 0;
      // Default charges (per sq ft)
      // Normalize area — Member model uses carpetAreaSqft, fallback chain
      const areaSqFt = Number(
        member.carpetAreaSqft ?? member.builtUpAreaSqft ?? member.areaSqFt ?? 0,
      );
      if (society.config?.maintenanceRate) {
        const amount = areaSqFt * society.config.maintenanceRate;
        charges.push({
          name: "Maintenance",
          rate: `₹${society.config.maintenanceRate}/sq ft × ${areaSqFt} sq ft`,
          amount,
        });
        subtotal += amount;
      }
      if (society.config?.sinkingFundRate) {
        const amount = areaSqFt * society.config.sinkingFundRate;
        charges.push({
          name: "Sinking Fund",
          rate: `₹${society.config.sinkingFundRate}/sq ft × ${areaSqFt} sq ft`,
          amount,
        });
        subtotal += amount;
      }
      if (society.config?.repairFundRate) {
        const amount = areaSqFt * society.config.repairFundRate;
        charges.push({
          name: "Repair Fund",
          rate: `₹${society.config.repairFundRate}/sq ft × ${areaSqFt} sq ft`,
          amount,
        });
        subtotal += amount;
      }
      // Fixed charges
      if (society.config?.fixedCharges?.water) {
        charges.push({
          name: "Water",
          rate: "Fixed",
          amount: society.config.fixedCharges.water,
        });
        subtotal += society.config.fixedCharges.water;
      }
      if (society.config?.fixedCharges?.security) {
        charges.push({
          name: "Security",
          rate: "Fixed",
          amount: society.config.fixedCharges.security,
        });
        subtotal += society.config.fixedCharges.security;
      }
      if (society.config?.fixedCharges?.electricity) {
        charges.push({
          name: "Electricity",
          rate: "Fixed",
          amount: society.config.fixedCharges.electricity,
        });
        subtotal += society.config.fixedCharges.electricity;
      }
      // Custom billing heads
      for (const head of billingHeads) {
        let amount = 0;
        let rateDisplay = "";
        const headNameLower = head.headName.trim().toLowerCase();
        const isParkingCharge =
          headNameLower.includes("parking") ||
          headNameLower.includes("two-wheeler") ||
          headNameLower.includes("four-wheeler") ||
          headNameLower.includes("two wheeler") ||
          headNameLower.includes("four wheeler");
        if (isParkingCharge && head.calculationType === "Fixed") {
          const slots = member.parkingSlots ?? [];
          const matchingCount = slots.filter((slot) => {
            if (slot.type === "Stilt" || slot.monthlyBilling === false)
              return false;
            const slotType = slot.type?.toLowerCase();
            const slotVehicle = slot.vehicleType?.toLowerCase();
            return (
              headNameLower.includes(slotType) &&
              (headNameLower.includes(slotVehicle) ||
                headNameLower.includes(slotVehicle?.replace("-", " ")) ||
                headNameLower.includes(slotVehicle?.replace(" ", "-")))
            );
          }).length;
          if (matchingCount === 0) continue; // skip — member has no matching slot
          amount = head.defaultAmount * matchingCount;
          rateDisplay = `₹${head.defaultAmount} × ${matchingCount} slot(s)`;
        } else if (head.calculationType === "Fixed") {
          amount = head.defaultAmount;
          rateDisplay = "Fixed";
        } else if (head.calculationType === "Per Sq Ft") {
          amount = areaSqFt * head.defaultAmount;
          rateDisplay = `₹${head.defaultAmount}/sq ft × ${areaSqFt} sq ft`;
        } else if (head.calculationType === "Percentage") {
          amount = subtotal * (head.defaultAmount / 100);
          rateDisplay = `${head.defaultAmount}% of subtotal`;
        }
        charges.push({ name: head.headName, rate: rateDisplay, amount });
        subtotal += amount;
      }
      const total = subtotal + previousBalance;
      preview.push({
        member: {
          id: member._id,
          wing: member.wing,
          roomNo: member.roomNo ?? member.flatNo,
          ownerName: member.ownerName,
          areaSqFt, // normalized value from above
          contactNumber: member.contactNumber ?? member.contact,
        },
        billNumber: `INV-${billPeriod}-${member.roomNo}`,
        billDate: billDate.toLocaleDateString("en-IN"),
        dueDate: dueDate.toLocaleDateString("en-IN"),
        charges,
        subtotal,
        previousBalance,
        total,
      });
    }
    return NextResponse.json({
      success: true,
      preview,
      period: billPeriod,
    });
  } catch (error) {
    console.error("Preview bills error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error.message,
      },
      { status: 500 },
    );
  }
}
