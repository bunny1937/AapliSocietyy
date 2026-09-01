import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import { listSchedules, createSchedule, ScheduleServiceError } from "@/lib/services/ScheduleService";
import { authorizeAny } from "@/lib/rbac/authorize";

const OVERRIDE = ["accounting.schedules.override", "society.systemTests.update"];

// GET /api/accounting/schedules
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  // Widened from society.systemTests.view — that is the test-harness
  // permission, and gating a real page on it made the page unreachable
  // for every role that is supposed to read it.
  const gate = await authorizeAny(request, [
    "accounting.schedules.view",
    "accounting.overview.view",
    "society.systemTests.view",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const schedules = await listSchedules(auth.user.societyId);
    return NextResponse.json({ schedules });
  } catch (error) {
    console.error("List schedules error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/accounting/schedules — per-society schedule. Admin/Secretary only.
export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorizeAny(request, OVERRIDE);
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
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
