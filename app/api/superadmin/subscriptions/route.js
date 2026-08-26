import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { validateAdminRequest } from "@/lib/admin-middleware";
import Society from "@/models/Society";
import { societyLifecycle, STATE } from "@/lib/entitlements/lifecycle";
import { MODULES } from "@/lib/entitlements/modules";
import { normalizeFeatures, bumpEntitlementVersion } from "@/lib/entitlements/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/superadmin/subscriptions        — the queue
// PATCH /api/superadmin/subscriptions       — grant/revoke modules, set dates
//
// ## Why the queue exists
//
// A society that stops paying, gets blocked, and then does nothing is a state
// with no exit. We hold its data indefinitely, its members keep read-only
// access indefinitely, and nobody ever presses a button — the same open-ended
// retention the offboarding work exists to close, arriving from a different
// direction.
//
// The plan considered auto-starting the offboarding handover after N days and
// rejected it: starting a handover starts a clock that ends in erasure, and
// doing that to a society whose secretary is mid-hospital-stay or
// mid-committee-election is technically defensible and commercially fatal.
//
// So a person decides, and this is what they look at. The cost of a human in
// the loop is that a human can ignore it, which is what the weekly reminder in
// /v1/cron/subscription-lifecycle is for.
export async function GET(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const url = new URL(request.url);
    const filter = url.searchParams.get("state"); // optional

    const societies = await Society.find({ isDeleted: { $ne: true } })
      .select("name societyCode contactEmail credentials.adminEmail subscription features")
      .lean();

    const rows = societies
      .map((society) => {
        const lifecycle = societyLifecycle(society);
        const modules = normalizeFeatures(society.features);
        return {
          societyId: String(society._id),
          name: society.name,
          code: society.societyCode || null,
          // So a human can pick up the phone, which is the entire point.
          contact: society.credentials?.adminEmail || society.contactEmail || null,
          plan: society.subscription?.planType || null,
          state: lifecycle.state,
          daysInState: lifecycle.daysInState,
          trialEndsAt: lifecycle.trialEndsAt,
          expiredAt: lifecycle.expiredAt,
          blockedAt: lifecycle.blockedAt,
          modules: MODULES.filter((m) => modules[m.key]).map((m) => m.key),
        };
      })
      .filter((row) => (filter ? row.state === filter : true))
      // Worst first: blocked societies are the ones needing a decision, and a
      // list sorted by name buries them.
      .sort((a, b) => {
        const order = [STATE.BLOCKED, STATE.RESTRICTED, STATE.GRACE, STATE.TRIAL, STATE.ACTIVE];
        const d = order.indexOf(a.state) - order.indexOf(b.state);
        return d !== 0 ? d : b.daysInState - a.daysInState;
      });

    return NextResponse.json({
      rows,
      counts: Object.fromEntries(
        Object.values(STATE).map((s) => [s, rows.filter((r) => r.state === s).length]),
      ),
      catalogue: MODULES.map((m) => ({ key: m.key, label: m.label })),
    });
  } catch (err) {
    console.error("superadmin subscriptions read error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Body: { societyId, modules?: {key: boolean}, trialDays?, trialEndsAt?,
//         nextPaymentDate?, planType?, status? }
export async function PATCH(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const body = await request.json().catch(() => ({}));
    const { societyId } = body;
    if (!societyId) {
      return NextResponse.json({ error: "societyId is required" }, { status: 400 });
    }

    const society = await Society.findById(societyId).select("name subscription").lean();
    if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });

    const $set = {};

    if (body.modules && typeof body.modules === "object") {
      for (const mod of MODULES) {
        if (typeof body.modules[mod.key] === "boolean") {
          $set[`features.${mod.key}.enabled`] = body.modules[mod.key];
        }
      }
    }

    // The trial is stamped once at signup and not adjustable afterwards, so
    // this only ever fills it in where it is missing — a society onboarded
    // before trials existed, or one created by a script.
    if (body.trialDays && !society.subscription?.trialEndsAt) {
      const days = Number(body.trialDays);
      if (![7, 14, 21, 30].includes(days)) {
        return NextResponse.json(
          { error: "Trial length must be 7, 14, 21 or 30 days" },
          { status: 400 },
        );
      }
      $set["subscription.trialDays"] = days;
      $set["subscription.trialEndsAt"] = new Date(Date.now() + days * 86400000);
    }

    if (body.nextPaymentDate) {
      const date = new Date(body.nextPaymentDate);
      if (Number.isNaN(date.getTime())) {
        return NextResponse.json({ error: "Invalid nextPaymentDate" }, { status: 400 });
      }
      $set["subscription.nextPaymentDate"] = date;
      $set["subscription.lastPaymentDate"] = new Date();
      $set["subscription.status"] = "Active";
    }

    if (body.planType) $set["subscription.planType"] = body.planType;
    if (body.status) $set["subscription.status"] = body.status;

    if (!Object.keys($set).length) {
      return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    }

    await Society.updateOne({ _id: societyId }, { $set });
    // Without this the change would take up to five minutes to reach the
    // resolver and up to a week to reach the edge.
    await bumpEntitlementVersion(societyId);

    const updated = await Society.findById(societyId).select("name subscription features").lean();
    return NextResponse.json({
      success: true,
      societyId,
      state: societyLifecycle(updated).state,
      modules: normalizeFeatures(updated.features),
    });
  } catch (err) {
    console.error("superadmin subscriptions write error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
