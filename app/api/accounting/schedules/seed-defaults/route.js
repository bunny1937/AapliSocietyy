import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import { seedDefaultSchedules } from "@/lib/services/ScheduleService";
import { authorize } from "@/lib/rbac/authorize";

// POST /api/accounting/schedules/seed-defaults
export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const result = await seedDefaultSchedules();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Seed default schedules error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
