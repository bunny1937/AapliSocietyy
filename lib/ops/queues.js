import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import SocietyHandover from "@/models/SocietyHandover";
import EntitlementDenial from "@/models/EntitlementDenial";
import { societyLifecycle, STATE } from "@/lib/entitlements/lifecycle";

const MIN_AGE_AFTER_SOFT_DELETE_MS = 60 * 60 * 1000;

/**
 * The work queues — everything currently waiting on something.
 *
 * ## Why this exists separately from the cron health
 *
 * A green cron does not mean nothing is stuck. society-purge can run perfectly
 * every night for six weeks and erase nothing at all, because every candidate
 * is failing a gate. From the cron's point of view that is a successful run; it
 * did exactly what it was told. From the operator's point of view six societies'
 * worth of personal data is sitting on disk with no explanation.
 *
 * So health answers "is the machinery turning" and this answers "is anything
 * coming out of it". Both are needed, and neither implies the other.
 *
 * Every row here carries **why** it is stuck, in words, not a status code — a
 * queue that says `status: pending` tells you nothing you could act on.
 */

/** Societies soft-deleted and waiting on the purge, with the gate that blocks each. */
export async function purgeQueue(now = new Date()) {
  await connectDB();

  const pending = await Society.find({ isDeleted: true })
    .select("name societyCode deletedAt purgeScheduledFor offboarding")
    .sort({ purgeScheduledFor: 1 })
    .limit(200)
    .lean();

  const rows = [];
  for (const society of pending) {
    const id = String(society._id);
    const blockers = [];

    // Reported in gate order so the list reads the same way the cron decides.
    if (process.env.SOCIETY_PURGE_ENABLED === "false") {
      blockers.push({ gate: 1, why: "Purging is disabled platform-wide (SOCIETY_PURGE_ENABLED=false)." });
    }
    if (!society.purgeScheduledFor) {
      blockers.push({ gate: 3, why: "No purge date was ever set. This society will sit here forever until one is." });
    } else if (new Date(society.purgeScheduledFor) > now) {
      blockers.push({
        gate: 3,
        why: `Scheduled for ${new Date(society.purgeScheduledFor).toISOString().slice(0, 10)} — not yet due.`,
        waiting: true,
      });
    }
    if (society.deletedAt && now - new Date(society.deletedAt) < MIN_AGE_AFTER_SOFT_DELETE_MS) {
      blockers.push({ gate: 5, why: "Soft-deleted less than an hour ago.", waiting: true });
    }
    if (!society.offboarding?.exportVerifiedAt) {
      blockers.push({
        gate: 4,
        why: "No export has been verified against live state. Run step 2 of the delete wizard.",
      });
    }

    const collected = await SocietyHandover.findOne({
      societyId: id,
      status: { $in: ["downloaded", "confirmed"] },
    })
      .select("_id")
      .lean();
    const waived = society.offboarding?.handoverWaivedAt;

    if (!collected && !waived) {
      const latest = await SocietyHandover.findOne({ societyId: id })
        .sort({ createdAt: -1 })
        .select("status notifiedAt reminderCount recipients")
        .lean();
      blockers.push({
        gate: 6,
        why: latest
          ? `The society has not collected its records (${latest.status}, ${latest.reminderCount || 0} reminder(s) sent to ${(latest.recipients || []).join(", ") || "nobody — no address on file"}).`
          : "No handover was ever built. Run step 1 of the delete wizard.",
      });
    }

    // A society waiting only on the calendar is not stuck — it is working as
    // designed, and mixing it in with genuinely blocked rows is how a real
    // problem gets lost in a list.
    const hardBlockers = blockers.filter((b) => !b.waiting);

    rows.push({
      societyId: id,
      name: society.name,
      code: society.societyCode || null,
      deletedAt: society.deletedAt,
      purgeScheduledFor: society.purgeScheduledFor || null,
      overdueDays: society.purgeScheduledFor
        ? Math.floor((now - new Date(society.purgeScheduledFor)) / 86400000)
        : null,
      waived: Boolean(waived),
      blockers,
      state: hardBlockers.length ? "blocked" : blockers.length ? "waiting" : "ready",
    });
  }

  return rows.sort((a, b) => {
    const order = { blocked: 0, ready: 1, waiting: 2 };
    const d = order[a.state] - order[b.state];
    return d !== 0 ? d : (b.overdueDays ?? -1e9) - (a.overdueDays ?? -1e9);
  });
}

/** Handovers sent but never collected — the input to the reminder cron. */
export async function handoverQueue(now = new Date()) {
  await connectDB();

  const rows = await SocietyHandover.find({ status: { $in: ["built", "notified"] } })
    .sort({ createdAt: 1 })
    .limit(200)
    .select("societyId societyName recipients notifiedAt notifyError reminderCount lastRemindedAt status createdAt")
    .lean();

  return rows.map((h) => ({
    handoverId: String(h._id),
    societyId: String(h.societyId),
    societyName: h.societyName,
    status: h.status,
    recipients: h.recipients || [],
    notifiedAt: h.notifiedAt || null,
    notifyError: h.notifyError || null,
    reminderCount: h.reminderCount || 0,
    lastRemindedAt: h.lastRemindedAt || null,
    ageDays: Math.floor((now - new Date(h.createdAt)) / 86400000),
    // The case that needs a human rather than another reminder. No amount of
    // chasing reaches a society with no address, and this is the row the
    // superadmin override exists for.
    unreachable: !(h.recipients || []).length,
  }));
}

/** Societies in a lapsed subscription state, worst first. */
export async function subscriptionQueue() {
  await connectDB();

  const societies = await Society.find({ isDeleted: { $ne: true } })
    .select("name societyCode contactEmail credentials.adminEmail subscription")
    .lean();

  const order = [STATE.BLOCKED, STATE.RESTRICTED, STATE.GRACE];
  return societies
    .map((society) => ({ society, lifecycle: societyLifecycle(society) }))
    .filter(({ lifecycle }) => order.includes(lifecycle.state))
    .map(({ society, lifecycle }) => ({
      societyId: String(society._id),
      name: society.name,
      code: society.societyCode || null,
      contact: society.credentials?.adminEmail || society.contactEmail || null,
      state: lifecycle.state,
      daysInState: lifecycle.daysInState,
      expiredAt: lifecycle.expiredAt || null,
    }))
    .sort((a, b) => {
      const d = order.indexOf(a.state) - order.indexOf(b.state);
      return d !== 0 ? d : b.daysInState - a.daysInState;
    });
}

/** Recent module denials — societies knocking on doors they have not bought. */
export async function denialQueue(days = 7) {
  await connectDB();

  // One row per refused request, so the count is the row count — see
  // models/EntitlementDenial.js, which stores events rather than tallies.
  const since = new Date(Date.now() - days * 86400000);
  const rows = await EntitlementDenial.aggregate([
    { $match: { at: { $gte: since } } },
    {
      $group: {
        _id: "$societyId",
        societyName: { $first: "$societyName" },
        denials: { $sum: 1 },
        modules: { $addToSet: "$module" },
        surfaces: { $addToSet: "$surface" },
        lastAt: { $max: "$at" },
      },
    },
    { $sort: { denials: -1 } },
    { $limit: 50 },
  ]);

  return rows.map((r) => ({
    societyId: String(r._id),
    societyName: r.societyName || "(unnamed)",
    denials: r.denials,
    modules: r.modules.filter(Boolean),
    // "app" here usually means a mobile build that predates the gate, not
    // somebody probing — worth distinguishing before anyone picks up a phone.
    surfaces: r.surfaces.filter(Boolean),
    lastAt: r.lastAt,
  }));
}
