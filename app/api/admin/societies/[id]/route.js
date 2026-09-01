import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import SocietyHandover from "@/models/SocietyHandover";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { offboardingChecklist } from "@/lib/superadmin/offboardingGates";
export async function GET(request, { params }) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const { id: societyId } = await params;
    // Fetch society
    const society = await Society.findById(societyId).lean();
    if (!society) {
      return NextResponse.json({ error: "Society not found" }, { status: 404 });
    }
    // Get stats
    const [memberCount, billCount, transactionCount] = await Promise.all([
      Member.countDocuments({ societyId }),
      Bill.countDocuments({ societyId }),
      Transaction.countDocuments({ societyId }),
    ]);
    // The newest handover, so the offboarding checklist can say whether the
    // society has its own copy without the client making a second call.
    const handover = await SocietyHandover.findOne({ societyId: society._id })
      .sort({ createdAt: -1 })
      .select("status notifiedAt downloadedAt confirmedAt reminderCount recipients driftMismatchCount")
      .lean();

    const paidBills = await Bill.countDocuments({
      societyId,
      status: { $in: ["Paid", "PaymentDone"] },
    });

    return NextResponse.json({
      success: true,
      society: {
        ...society,
        stats: {
          members: memberCount,
          bills: billCount,
          paidBills,
          transactions: transactionCount,
        },
        handover: handover || null,
        offboarding: offboardingChecklist(society, handover),
      },
    });
  } catch (error) {
    console.error("Society fetch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
