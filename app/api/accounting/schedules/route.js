import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import { listSchedules, createSchedule, ScheduleServiceError } from "@/lib/services/ScheduleService";
import { authorize } from "@/lib/rbac/authorize";

// GET /api/accounting/schedules
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const schedules = await listSchedules(auth.user.societyId);
    return NextResponse.json({ schedules });
  } catch (error) {
    console.error("List schedules error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

// POST /api/accounting/schedules — per-society schedule. Admin/Secretary only.
export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const schedule = await createSchedule(auth.user.societyId, body);
    return NextResponse.json({ schedule }, { status: 201 });
  } catch (error) {
    if (error instanceof ScheduleServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Create schedule error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}
