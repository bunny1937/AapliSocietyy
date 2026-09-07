import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { validateAdminRequest } from "@/lib/admin-middleware";
import connectDB from "@/lib/mongodb";
import SupportTicket from "@/models/SupportTicket";
import { getAdminModels } from "@/lib/admin-models";
import { TICKET_STATUSES } from "@/lib/support/ticketPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/superadmin/tickets/:id — full detail: screenshots, error logs,
// status history. Rendered inline on the tickets page — nothing here is
// ever exposed as a downloadable file.
export async function GET(request, { params }) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  const { id } = await params;

  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  await connectDB();
  const ticket = await SupportTicket.findById(id).lean();
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  return NextResponse.json({ ticket });
}

// PATCH /api/superadmin/tickets/:id — move status forward (or back), with an
// optional note. Appends to statusHistory rather than overwriting it — the
// admin's own ticket-detail view is that timeline, so every change must be
// visible to them, not just the latest value.
export async function PATCH(request, { params }) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  const { id } = await params;

  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { status, note } = body || {};
  if (!TICKET_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `Status must be one of: ${TICKET_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }
  const trimmedNote = typeof note === "string" ? note.trim().slice(0, 1000) : "";

  await connectDB();
  const { SuperAdmin } = await getAdminModels();
  const admin = await SuperAdmin.findById(validation.admin.userId).select("name").lean();

  const ticket = await SupportTicket.findByIdAndUpdate(
    id,
    {
      $set: { status },
      $push: {
        statusHistory: {
          status,
          note: trimmedNote || undefined,
          changedBy: validation.admin.userId,
          changedByName: admin?.name || validation.admin.email,
          changedAt: new Date(),
        },
      },
    },
    { new: true },
  ).lean();

  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  return NextResponse.json({ ticket });
}
