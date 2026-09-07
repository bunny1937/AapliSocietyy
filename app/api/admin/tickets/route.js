import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/authz";
import connectDB from "@/lib/mongodb";
import SupportTicket from "@/models/SupportTicket";
import User from "@/models/User";
import Society from "@/models/Society";
import { getAdminModels } from "@/lib/admin-models";
import { sendEmail, ticketNotificationEmailHtml } from "@/lib/brevo-email";
import {
  TICKET_CATEGORIES,
  MAX_SCREENSHOTS,
  MAX_TITLE_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_ERROR_LOG_CHARS,
  parseAndValidateScreenshot,
} from "@/lib/support/ticketPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/tickets — this society's own tickets, own-only, lightweight
// (no screenshots/logs — see [id]/route.js for the full read). Newest first.
export async function GET(request) {
  const auth = requireRoles(request, ["Admin"]);
  if (!auth.valid) return auth;
  const { societyId } = auth.user;

  await connectDB();
  const tickets = await SupportTicket.find({ societyId })
    .select("category title status createdAt updatedAt statusHistory")
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json({
    tickets: tickets.map((t) => ({
      id: t._id,
      category: t.category,
      title: t.title,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      // Latest note only, for a one-line preview in the list — full
      // history is on the detail read.
      lastNote: t.statusHistory?.length
        ? t.statusHistory[t.statusHistory.length - 1]
        : null,
    })),
  });
}

// POST /api/admin/tickets — submit a new ticket. Admin role only (see
// lib/authz.js requireRoles) — deliberately not RBAC-gated (see
// docs decision: only one role can ever reach this, nothing to grant).
export async function POST(request) {
  const auth = requireRoles(request, ["Admin"]);
  if (!auth.valid) return auth;
  const { userId, societyId } = auth.user;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { category, title, description, errorLogs, screenshots } = body || {};

  if (!TICKET_CATEGORIES.includes(category)) {
    return NextResponse.json(
      { error: `Category must be one of: ${TICKET_CATEGORIES.join(", ")}` },
      { status: 400 },
    );
  }
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  if (trimmedTitle.length < 5 || trimmedTitle.length > MAX_TITLE_CHARS) {
    return NextResponse.json(
      { error: `Title must be 5-${MAX_TITLE_CHARS} characters` },
      { status: 400 },
    );
  }
  const trimmedDescription = typeof description === "string" ? description.trim() : "";
  if (trimmedDescription.length < 10 || trimmedDescription.length > MAX_DESCRIPTION_CHARS) {
    return NextResponse.json(
      { error: `Description must be 10-${MAX_DESCRIPTION_CHARS} characters` },
      { status: 400 },
    );
  }
  const trimmedLogs =
    typeof errorLogs === "string" ? errorLogs.trim().slice(0, MAX_ERROR_LOG_CHARS) : "";

  const screenshotInput = Array.isArray(screenshots) ? screenshots : [];
  if (screenshotInput.length > MAX_SCREENSHOTS) {
    return NextResponse.json(
      { error: `Maximum ${MAX_SCREENSHOTS} screenshots allowed` },
      { status: 400 },
    );
  }
  let parsedScreenshots;
  try {
    parsedScreenshots = screenshotInput.map((s, i) => ({
      ...parseAndValidateScreenshot(typeof s === "string" ? s : s?.data, i),
      filename: typeof s?.filename === "string" ? s.filename.slice(0, 200) : undefined,
    }));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  await connectDB();

  const [user, society] = await Promise.all([
    User.findById(userId).select("name").lean(),
    Society.findById(societyId).select("name").lean(),
  ]);
  if (!user || !society) {
    return NextResponse.json({ error: "Account or society not found" }, { status: 404 });
  }

  const ticket = await SupportTicket.create({
    societyId,
    societyName: society.name,
    submittedByUserId: userId,
    submittedByName: user.name,
    category,
    title: trimmedTitle,
    description: trimmedDescription,
    errorLogs: trimmedLogs,
    screenshots: parsedScreenshots,
    status: "Received",
    statusHistory: [{ status: "Received", changedAt: new Date() }],
  });

  // Best-effort notification — a ticket must exist regardless of whether the
  // email happens to succeed. Superadmin also has the tickets page as the
  // real source of truth; email is a nudge, not the record.
  notifySuperAdmins(ticket, society.name, user.name).catch((err) => {
    console.error("[tickets] superadmin notification failed:", err?.message);
  });

  return NextResponse.json({ ok: true, ticketId: ticket._id }, { status: 201 });
}

async function notifySuperAdmins(ticket, societyName, adminName) {
  const { SuperAdmin } = await getAdminModels();
  const superAdmins = await SuperAdmin.find({ isActive: true }).select("email").lean();
  if (!superAdmins.length) return;

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000";
  const html = ticketNotificationEmailHtml({
    societyName,
    adminName,
    category: ticket.category,
    title: ticket.title,
    description: ticket.description,
    ticketUrl: `${baseUrl}/superadmin/tickets?open=${ticket._id}`,
  });
  const subject = `[${ticket.category}] ${societyName}: ${ticket.title}`;

  await Promise.allSettled(
    superAdmins.map((sa) => sendEmail({ to: sa.email, subject, html })),
  );
}
