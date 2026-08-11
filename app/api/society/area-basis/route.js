// app/api/society/area-basis/route.js
//
// Q3 — one society-wide switch: are RESIDENTIAL bills calculated on carpet area
// or built-up area? It is live: change it and the next bill run (and every
// preview) uses the new basis immediately. Bills already generated keep the
// area frozen on them, so history never silently re-prices (Q12).
//
// Shops are deliberately NOT affected. A shop carries its own area on its own
// record, because a shop's billable area is a commercial fact that has nothing
// to do with how the society measures flats.

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Member from "@/models/Member";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { logAudit } from "@/lib/audit-logger";
import { authorizeAny } from "@/lib/rbac/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASES = ["carpet", "builtup"];
const LABEL = { carpet: "Carpet area", builtup: "Built-up area" };

async function auth(request, level) {
  await connectDB();
  const token = getTokenFromRequest(request);
  if (!token) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const decoded = verifyToken(token);
  if (!decoded) return { error: NextResponse.json({ error: "Invalid token" }, { status: 401 }) };
  // Also read/written from the Commercial page (peripheral — shop area rules
  // reference this switch), not just Billing Config — same
  // cross-page-dependency pattern as financial-years.
  const action = level === "manage" ? "update" : "view";
  const gate = await authorizeAny(request, [`billing.config.${action}`, `commercial.admin.${action}`]);
  if (!gate.ok) return { error: gate.response };
  return { decoded: { ...decoded, societyId: gate.context.societyId || decoded.societyId, userId: gate.context.userId } };
}

export async function GET(request) {
  const { error, decoded } = await auth(request, "view");
  if (error) return error;

  const societyId = decoded.societyId;
  const society = await Society.findById(societyId).select("config").lean();
  const basis = society?.config?.areaBasis || "carpet";

  // How many flats would actually be affected by switching. Showing this BEFORE
  // the change is the whole point — otherwise an admin flips a radio button and
  // silently re-prices the entire society.
  const [total, withCarpet, withBuiltUp] = await Promise.all([
    Member.countDocuments({ societyId, isDeleted: { $ne: true } }),
    Member.countDocuments({ societyId, isDeleted: { $ne: true }, carpetAreaSqft: { $gt: 0 } }),
    Member.countDocuments({ societyId, isDeleted: { $ne: true }, builtUpAreaSqft: { $gt: 0 } }),
  ]);

  return NextResponse.json({
    areaBasis: basis,
    label: LABEL[basis],
    coverage: {
      total,
      withCarpet,
      withBuiltUp,
      missingIfCarpet: total - withCarpet,
      missingIfBuiltUp: total - withBuiltUp,
    },
    note: "Shops and offices are not affected \u2014 each one carries its own area.",
  });
}

export async function PUT(request) {
  const { error, decoded } = await auth(request, "manage");
  if (error) return error;

  const societyId = decoded.societyId;
  const body = await request.json().catch(() => null);
  const next = String(body?.areaBasis || "");

  if (!BASES.includes(next)) {
    return NextResponse.json(
      {
        error: "Choose either carpet area or built-up area.",
        code: "VALIDATION_ERROR",
        hint: "These are the only two measurements bills can be calculated on.",
      },
      { status: 400 },
    );
  }

  const society = await Society.findById(societyId).select("config").lean();
  const current = society?.config?.areaBasis || "carpet";

  if (current === next) {
    return NextResponse.json({ areaBasis: next, label: LABEL[next], changed: false });
  }

  // Refuse to switch to a basis most flats do not have. Silently falling back
  // unit-by-unit would produce a bill run where some flats are on built-up and
  // some on carpet — impossible for an admin to explain to members.
  if (next === "builtup") {
    const [total, withBuiltUp] = await Promise.all([
      Member.countDocuments({ societyId, isDeleted: { $ne: true } }),
      Member.countDocuments({ societyId, isDeleted: { $ne: true }, builtUpAreaSqft: { $gt: 0 } }),
    ]);
    const missing = total - withBuiltUp;
    if (total > 0 && missing > total / 2) {
      return NextResponse.json(
        {
          error: `${missing} of ${total} flats have no built-up area recorded.`,
          code: "AREA_MISSING",
          hint:
            "Those flats would fall back to carpet area, so your society would be billing on two different measurements at once.",
          fix: "Add built-up areas on the Members screen first, then switch.",
          fixHref: "/admin/members",
        },
        { status: 409 },
      );
    }
  }

  await Society.updateOne({ _id: societyId }, { $set: { "config.areaBasis": next } });

  await logAudit(
    decoded.userId || decoded.id,
    societyId,
    "SOCIETY_AREA_BASIS_CHANGED",
    { areaBasis: current },
    { areaBasis: next },
  );

  return NextResponse.json({
    areaBasis: next,
    label: LABEL[next],
    changed: true,
    nextStep: `Residential bills will now be calculated on ${LABEL[
      next
    ].toLowerCase()}. Bills you have already generated are unchanged. Preview one flat before running the next month.`,
  });
}
