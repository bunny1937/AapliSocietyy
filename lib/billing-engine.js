import Member from "@/models/Member";
import User from "@/models/User";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import Society from "@/models/Society";
import {
  calculateDaysBetween,
  isDateAfterGracePeriod,
  getLastDayOfMonth,
  generateBillingPeriodId,
  getFinancialYear,
} from "./date-utils";

export class BillingEngine {
  constructor(societyId, userId) {
    this.societyId = societyId;
    this.userId = userId;
    this.society = null;
    this.errors = [];
    this.successCount = 0;
    this.failedMembers = [];
  }

  async initialize() {
    this.society = await Society.findById(this.societyId);
    if (!this.society) {
      throw new Error("Society not found");
    }
    return this;
  }

  async calculateArrears(memberId) {
    const unpaidBills = await Bill.find({
      memberId,
      societyId: this.societyId,
      status: { $in: ["Unpaid", "Partial", "Overdue"] },
    }).sort({ billYear: 1, billMonth: 1 });

    let totalArrears = 0;
    let oldestUnpaidDate = null;

    unpaidBills.forEach((bill) => {
      totalArrears += bill.balanceAmount;
      if (!oldestUnpaidDate) {
        oldestUnpaidDate = bill.dueDate;
      }
    });

    return {
      totalArrears,
      unpaidBillCount: unpaidBills.length,
      oldestUnpaidDate,
      bills: unpaidBills,
    };
  }

  applyInterest(principalAmount, interestRate, dueDate, gracePeriodDays) {
    if (principalAmount <= 0) return 0;

    const now = new Date();
    const graceEndDate = new Date(dueDate);
    graceEndDate.setDate(graceEndDate.getDate() + gracePeriodDays);

    // If still within grace period, no interest
    if (now <= graceEndDate) return 0;

    const daysOverdue = Math.floor(
      (now - graceEndDate) / (1000 * 60 * 60 * 24)
    );

    const method = this.society.config.interestCalculationMethod || "COMPOUND";
    const frequency =
      this.society.config.interestCompoundingFrequency || "MONTHLY";

    let interest = 0;

    if (method === "SIMPLE") {
      // Simple Interest: I = P × R × T
      const monthsOverdue = daysOverdue / 30;
      interest = principalAmount * (interestRate / 100) * monthsOverdue;
    } else {
      // Compound Interest: A = P(1 + r/n)^(nt)
      let n; // Compounding periods per month
      let t; // Time in months

      if (frequency === "DAILY") {
        n = 30; // 30 days per month
        t = daysOverdue / 30; // Time in months
      } else {
        // MONTHLY
        n = 1;
        t = Math.floor(daysOverdue / 30); // Full months only
      }

      if (t > 0) {
        const r = interestRate / 100; // Annual rate as decimal
        const amount = principalAmount * Math.pow(1 + r / n, n * t);
        interest = amount - principalAmount;
      }
    }

    return Math.round(interest * 100) / 100;
  }

  calculateMaintenanceCharges(member) {
    const { config } = this.society;

    const maintenance = member.areaSqFt * (config.maintenanceRate || 0);
    const sinkingFund = member.areaSqFt * (config.sinkingFundRate || 0);
    const repairFund = member.areaSqFt * (config.repairFundRate || 0);

    return {
      maintenance: Math.round(maintenance * 100) / 100,
      sinkingFund: Math.round(sinkingFund * 100) / 100,
      repairFund: Math.round(repairFund * 100) / 100,
    };
  }

  calculateFixedCharges() {
    const { fixedCharges } = this.society.config;

    const total =
      (fixedCharges.water || 0) +
      (fixedCharges.security || 0) +
      (fixedCharges.electricity || 0);

    return {
      water: fixedCharges.water || 0,
      security: fixedCharges.security || 0,
      electricity: fixedCharges.electricity || 0,
      total,
    };
  }

  calculateServiceTax(baseAmount) {
    const taxRate = this.society.config.serviceTaxRate || 0;
    const tax = (baseAmount * taxRate) / 100;
    return Math.round(tax * 100) / 100;
  }

  async getMemberCurrentBalance(memberId) {
    const lastTransaction = await Transaction.findOne({
      memberId,
      societyId: this.societyId,
      isReversed: false,
    }).sort({ date: -1, createdAt: -1 });

    return lastTransaction ? lastTransaction.balanceAfterTransaction : 0;
  }

  async executeBillingCycle(month, year, customCharges = {}) {
    if (!this.society) {
      await this.initialize();
    }

    const billPeriodId = generateBillingPeriodId(month, year);

    const existingBills = await Bill.countDocuments({
      societyId: this.societyId,
      billPeriodId,
    });

    if (existingBills > 0) {
      throw new Error(
        `Bills for ${billPeriodId} already generated. Delete existing bills first or use update operation.`
      );
    }

    const members = await Member.find({ societyId: this.societyId });

    if (members.length === 0) {
      throw new Error(
        "No members found. Import members before generating bills."
      );
    }

    this.errors = [];
    this.successCount = 0;
    this.failedMembers = [];

    const dueDate = getLastDayOfMonth(year, month);
    dueDate.setDate(10);
    if (dueDate.getMonth() !== month) {
      dueDate.setMonth(month + 1, 10);
    }

    const billPromises = members.map((member) =>
      this.generateSingleBill(
        member,
        month,
        year,
        billPeriodId,
        dueDate,
        customCharges
      )
    );

    await Promise.allSettled(billPromises);

    return {
      success: this.errors.length === 0,
      totalMembers: members.length,
      successCount: this.successCount,
      failedCount: this.failedMembers.length,
      errors: this.errors,
      failedMembers: this.failedMembers,
      billPeriodId,
    };
  }

  async generateSingleBill(
    member,
    month,
    year,
    billPeriodId,
    dueDate,
    customCharges = {}
  ) {
    try {
      const memberKey = `${member.wing}-${member.roomNo}`;

      const arrearsData = await this.calculateArrears(member._id);

      const maintenanceBreakdown = this.calculateMaintenanceCharges(member);
      const fixedChargesBreakdown = this.calculateFixedCharges();

      let dynamicChargesTotal = 0;
      const chargesMap = new Map();

      if (customCharges[memberKey]) {
        Object.entries(customCharges[memberKey]).forEach(([label, amount]) => {
          const numAmount = parseFloat(amount) || 0;
          chargesMap.set(label, numAmount);
          dynamicChargesTotal += numAmount;
        });
      }

      let interestOnArrears = 0;
      if (arrearsData.totalArrears > 0 && arrearsData.oldestUnpaidDate) {
        interestOnArrears = this.applyInterest(
          arrearsData.totalArrears,
          this.society.config.interestRate,
          arrearsData.oldestUnpaidDate,
          this.society.config.gracePeriodDays
        );
      }

      const subtotal =
        maintenanceBreakdown.maintenance +
        maintenanceBreakdown.sinkingFund +
        maintenanceBreakdown.repairFund +
        fixedChargesBreakdown.total +
        dynamicChargesTotal;

      const serviceTax = this.calculateServiceTax(subtotal);

      const totalAmount =
        subtotal + serviceTax + arrearsData.totalArrears + interestOnArrears;

      const bill = await Bill.create({
        billPeriodId,
        billMonth: month,
        billYear: year,
        memberId: member._id,
        societyId: this.societyId,
        charges: chargesMap,
        breakdown: {
          maintenance: maintenanceBreakdown.maintenance,
          sinkingFund: maintenanceBreakdown.sinkingFund,
          repairFund: maintenanceBreakdown.repairFund,
          fixedCharges: fixedChargesBreakdown.total,
          dynamicCharges: dynamicChargesTotal,
          previousArrears: arrearsData.totalArrears,
          interestOnArrears,
          serviceTax,
        },
        totalAmount: Math.round(totalAmount * 100) / 100,
        amountPaid: 0,
        balanceAmount: Math.round(totalAmount * 100) / 100,
        dueDate: new Date(dueDate),
        status: "Unpaid",
        generatedBy: this.userId,
        generatedAt: new Date(),
      });

      const currentBalance = await this.getMemberCurrentBalance(member._id);
      const newBalance = currentBalance + bill.totalAmount;

      await Transaction.create({
        transactionId: Transaction.generateTransactionId(),
        date: new Date(),
        memberId: member._id,
        societyId: this.societyId,
        type: "Debit",
        category: "Maintenance",
        description: `Bill generated for ${billPeriodId}`,
        amount: bill.totalAmount,
        balanceAfterTransaction: newBalance,
        referenceId: bill._id,
        referenceModel: "Bill",
        billPeriodId,
        paymentMode: "System",
        createdBy: this.userId,
        financialYear: getFinancialYear(new Date()),
      });

      this.successCount++;
    } catch (error) {
      this.errors.push({
        member: `${member.wing}-${member.roomNo}`,
        error: error.message,
      });
      this.failedMembers.push({
        memberId: member._id,
        roomNo: member.roomNo,
        wing: member.wing,
        ownerName: member.ownerName,
        error: error.message,
      });
    }
  }

  async getDefaultersList(monthsThreshold = 3) {
    const members = await Member.find({ societyId: this.societyId });
    const defaulters = [];

    for (const member of members) {
      const arrearsData = await this.calculateArrears(member._id);

      if (arrearsData.unpaidBillCount >= monthsThreshold) {
        defaulters.push({
          memberId: member._id,
          roomNo: member.roomNo,
          wing: member.wing,
          ownerName: member.ownerName,
          contact: member.contact,
          unpaidBills: arrearsData.unpaidBillCount,
          totalArrears: arrearsData.totalArrears,
          oldestUnpaidDate: arrearsData.oldestUnpaidDate,
        });
      }
    }

    return defaulters.sort((a, b) => b.totalArrears - a.totalArrears);
  }

  async finalizeMonthlyCycle(month, year) {
    const billPeriodId = generateBillingPeriodId(month, year);

    const result = await Bill.updateMany(
      {
        societyId: this.societyId,
        billPeriodId,
        isLocked: false,
      },
      {
        $set: { isLocked: true },
      }
    );

    return {
      billPeriodId,
      lockedCount: result.modifiedCount,
    };
  }
}

export async function calculateMemberOutstanding(memberId, societyId) {
  const bills = await Bill.find({
    memberId,
    societyId,
    status: { $in: ["Unpaid", "Partial", "Overdue"] },
  });

  let outstanding = 0;
  bills.forEach((bill) => {
    outstanding += bill.balanceAmount;
  });

  return outstanding;
}

export async function getMemberLedger(
  memberId,
  societyId,
  startDate = null,
  endDate = null
) {
  const query = {
    memberId,
    societyId,
    isReversed: false,
  };

  if (startDate && endDate) {
    query.date = {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    };
  }

  const transactions = await Transaction.find(query)
    .sort({ date: 1, createdAt: 1 })
    .populate("createdBy", "name email")
    .lean();

  return transactions;
}
