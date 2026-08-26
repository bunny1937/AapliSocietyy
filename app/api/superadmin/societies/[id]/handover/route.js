import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { validateAdminRequest } from "@/lib/admin-middleware";
import Society from "@/models/Society";
import SocietyHandover from "@/models/SocietyHandover";
import {
  createHandover,
  handoverRecipients,
  normalizeRecipients,
} from "@/lib/superadmin/societyHandover";
import { logSocietyLifecycle, SOCIETY_LIFECYCLE_ACTIONS } from "@/lib/superadmin/societyAudit";
import { breakGlassAuthorized, breakGlassRefusal } from "@/lib/superadmin/breakGlass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Building a 75-collection bundle plus a multi-sheet workbook is CPU-bound and
// scales with society size. Runs at most a handful of times per society, ever.
export const maxDuration = 300;

// POST /api/superadmin/societies/[id]/handover
//   Build the society's own copy of its records, record the manifest and the
//   digests, and email the society's registered address(es) telling them to
//   come and collect it. The bytes are never stored — see
//   lib/superadmin/societyHandover.js.
//
//   Body: { notify?: boolean }  — notify:false builds and records without
//   sending, for a dry run before committing to the mail.
//
// GET  /api/superadmin/societies/[id]/handover
//   The handover history for this society: what was built, who it went to,
//   whether they collected it and whether they confirmed it. No payload, and
//   the salt is not returned — it is an HMAC key, not a display field.

export async function POST(request, { params }) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const notify = body.notify !== false;

    // ── the no-address-on-file exception ──────────────────────────────
    //
    // handoverRecipients() deliberately has no platform fallback: a handover
    // addressed to us defeats its own purpose. But that leaves a real society
    // in a real dead end — committee dissolved, mailbox gone, address never
    // captured at signup — where nobody can be told the records are ready,
    // purge gate 6 can never clear, and we hold their data forever.
    //
    // So the operator may supply an address. Three constraints keep it an
    // exception rather than a convenience:
    //
    //   1. It is REFUSED when the society already has a reachable address.
    //      Otherwise it becomes the easy path and the society's own record
    //      quietly stops being the thing we send to.
    //   2. It costs a written reason, recorded against the operator's name.
    //      An unexplained operator-supplied address in a year-old audit log
    //      is indistinguishable from a handover sent to the wrong person.
    //   3. It is stored as `recipientSource: "override"` alongside what WAS
    //      on file, so the evidence that it was necessary survives.
    //
    // Note this is NOT break-glass. Break-glass covers the three actions that
    // destroy or disclose data; this one delivers a society its own records,
    // which is the outcome the whole flow exists to produce. Gating it behind
    // the same named-admin list would mean the ordinary rescue needs the
    // emergency key.
    const overrideRecipients = normalizeRecipients(body.overrideRecipients ?? body.overrideEmail);
    let overrideReason = "";

    if (overrideRecipients.length) {
      const society = await Society.findById(id).lean();
      if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });

      const registered = handoverRecipients(society);
      if (registered.length) {
        return NextResponse.json(
          {
            error:
              "This society has a registered address on file. The handover must go there — an override is only for a society with no reachable address.",
            code: "OVERRIDE_NOT_NEEDED",
            registered,
          },
          { status: 400 },
        );
      }

      overrideReason = String(body.overrideReason || "").trim();
      if (overrideReason.length < 10) {
        return NextResponse.json(
          {
            error:
              "A written reason (at least 10 characters) is required — say how this address was obtained and who confirmed it.",
            code: "OVERRIDE_REASON_REQUIRED",
          },
          { status: 400 },
        );
      }
    }

    const result = await createHandover({
      societyId: id,
      actorUserId: validation.admin?.userId,
      notify,
      overrideRecipients,
      overrideReason,
    });
    if (!result) return NextResponse.json({ error: "Society not found" }, { status: 404 });

    const { handover, recipients, notify: notifyResult, usingOverride, registeredRecipients } = result;

    await logSocietyLifecycle({
      action: SOCIETY_LIFECYCLE_ACTIONS.HANDOVER_SENT,
      societyId: id,
      societyName: handover.societyName,
      actorUserId: validation.admin?.userId,
      details: {
        handoverId: String(handover._id),
        manifestRoot: handover.manifestRoot,
        recipients,
        emailsSent: notifyResult.sent,
        emailsFailed: notifyResult.failed.map((f) => f.to),
        notified: notify,
        // Named in the audit row rather than inferred from the address list —
        // an override is a judgement somebody made, and it should read like one.
        ...(usingOverride
          ? {
              recipientSource: "override",
              overrideReason,
              registeredRecipients,
            }
          : {}),
        ...handover.counts,
      },
    });

    return NextResponse.json({
      success: true,
      handoverId: handover._id,
      manifestRoot: handover.manifestRoot,
      counts: handover.counts,
      artifacts: handover.artifacts,
      recipients,
      recipientSource: usingOverride ? "override" : "registered",
      emailsSent: notifyResult.sent,
      emailsFailed: notifyResult.failed,
      // Surfaced loudly rather than buried: a society with no address on file
      // cannot be handed anything, and the superadmin has to fix that before
      // the grace window runs out. The client turns this code into a prompt
      // for an address rather than a dead end.
      needsRecipient: !recipients.length,
      warning: recipients.length
        ? usingOverride
          ? "Sent to an operator-supplied address. The society's own record still has none — fix that before the next handover."
          : null
        : "This society has no registered email address. Nobody was told the records are ready.",
    });
  } catch (err) {
    console.error("society handover error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(request, { params }) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const { id } = await params;
    const handovers = await SocietyHandover.find({ societyId: id })
      .sort({ createdAt: -1 })
      .limit(20)
      // manifest holds every leaf; salt is a key. Neither belongs in a list.
      .select("-manifest -salt")
      .lean();
    return NextResponse.json({ handovers });
  } catch (err) {
    console.error("society handover list error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/superadmin/societies/[id]/handover
// Body: { waive: true, reason: "<why>" }  |  { waive: false }
//
// The escape hatch for gate 6 of the purge cron, for the case the gate was
// never designed to hold shut on: a society whose committee has dissolved,
// whose registered address bounces, and which will therefore never collect
// anything. Without a waiver its data would sit on our disks forever — the
// gate would have turned into the very thing it was built to prevent.
//
// A waiver is a judgement, so it is recorded as one: who made it, when, and on
// what grounds, in a field the purge audit entry then carries. Deliberately
// not a boolean toggle and deliberately not reason-optional — an unexplained
// waiver in a year-old audit log is indistinguishable from a mistake.
export async function PATCH(request, { params }) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    if (body.waive === false) {
      await Society.updateOne(
        { _id: id },
        {
          $unset: {
            "offboarding.handoverWaivedAt": "",
            "offboarding.handoverWaivedByUserId": "",
            "offboarding.handoverWaivedReason": "",
          },
        },
      );
      return NextResponse.json({ success: true, waived: false });
    }

    // D7 — waiving is the third break-glass action: it clears the gate that
    // says a society must have collected its records before we erase them.
    if (!breakGlassAuthorized(validation.admin)) {
      return NextResponse.json(breakGlassRefusal("Waiving the handover requirement"), { status: 403 });
    }

    const reason = String(body.reason || "").trim();
    if (reason.length < 10) {
      return NextResponse.json(
        { error: "A written reason (at least 10 characters) is required to waive the handover" },
        { status: 400 },
      );
    }

    const society = await Society.findById(id).select("name").lean();
    if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });

    await Society.updateOne(
      { _id: id },
      {
        $set: {
          "offboarding.handoverWaivedAt": new Date(),
          "offboarding.handoverWaivedByUserId": validation.admin?.userId || null,
          "offboarding.handoverWaivedReason": reason,
        },
      },
    );

    await logSocietyLifecycle({
      action: SOCIETY_LIFECYCLE_ACTIONS.HANDOVER_SENT,
      societyId: id,
      societyName: society.name,
      actorUserId: validation.admin?.userId,
      details: { waived: true, reason },
    });

    return NextResponse.json({ success: true, waived: true, reason });
  } catch (err) {
    console.error("society handover waive error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
