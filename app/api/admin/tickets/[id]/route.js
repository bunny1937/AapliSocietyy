import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { requireRoles } from "@/lib/authz";
import connectDB from "@/lib/mongodb";
import SupportTicket from "@/models/SupportTicket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/tickets/:id — full ticket detail (screenshots, error logs,
// status history), scoped to the caller's own society. Never returns a
// ticket belonging to another society, even to an Admin — 404, not 403, so
// a guess at another society's ticket id learns nothing.
export async function GET(request, { params }) {
  const auth = requireRoles(request, ["Admin"]);
  if (!auth.valid) return auth;
  const { societyId } = auth.user;
  const { id } = await params;

  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  await connectDB();
  const ticket = await SupportTicket.findOne({ _id: id, societyId }).lean();
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  return NextResponse.json({ ticket });
}
