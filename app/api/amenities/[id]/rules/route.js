import Amenity from "@/models/amenities/Amenity";
import AmenityRule from "@/models/amenities/AmenityRule";
import { rulesReplaceSchema } from "@/lib/amenities/schemas";
import { logAmenityActivity } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, RULE_KINDS } from "@/lib/amenities/constants";
import { notifyRulesUpdated } from "@/lib/amenities/notify";
import { getSettings } from "@/lib/amenities/settingsService";
import { CAPABILITY, gate, ok, fail, zodFail, isId, withAmenityRoute } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function group(rules) {
  return RULE_KINDS.reduce((acc, kind) => {
    acc[kind] = rules.filter((r) => r.kind === kind);
    return acc;
  }, {});
}

export const GET = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.VIEW_AMENITIES);
  if (!g.ok) return g.response;

  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid amenity id");

  const rules = await AmenityRule.find({ amenityId: id, isActive: true })
    .sort({ kind: 1, displayOrder: 1 })
    .lean();

  return ok({ rules: group(rules), total: rules.length });
});

// PUT /api/amenities/[id]/rules
//
// Whole-list replace, not per-rule CRUD. The admin edits rules as one block of
// text in the UI; replacing the set atomically avoids a half-saved rulebook, and
// residents never see rules 1-3 of a 6-rule update.
export const PUT = withAmenityRoute(async (request, { params }) => {
  const g = await gate(request, CAPABILITY.MANAGE_RULES);
  if (!g.ok) return g.response;

  const { id } = await params;
  if (!isId(id)) return fail(400, "Invalid amenity id");

  const parsed = rulesReplaceSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);
  const { rules, notify = true } = parsed.data;

  const amenity = await Amenity.findOne({ _id: id, societyId: g.societyId, isDeleted: false })
    .select("name").lean();
  if (!amenity) return fail(404, "Amenity not found");

  const previous = await AmenityRule.find({ amenityId: id, isActive: true }).lean();

  // Retired rules are deactivated, never removed: an incident raised for a rule
  // violation must still be able to name the rule as it stood that day.
  await AmenityRule.updateMany({ amenityId: id }, { $set: { isActive: false } });

  const docs = rules.map((r, idx) => ({
    societyId: g.societyId,
    amenityId: id,
    kind: r.kind,
    text: r.text,
    displayOrder: r.displayOrder ?? idx,
    isActive: r.isActive !== false,
    createdBy: g.actor.userId,
  }));
  const saved = docs.length ? await AmenityRule.insertMany(docs) : [];

  const settings = await getSettings(g.societyId);
  if (notify && settings.notifyOnRulesUpdate !== false && previous.length) {
    // Only notify when rules actually changed, not on a no-op save.
    const before = previous.map((r) => `${r.kind}:${r.text}`).sort().join("|");
    const after = saved.map((r) => `${r.kind}:${r.text}`).sort().join("|");
    if (before !== after) {
      await notifyRulesUpdated({ societyId: g.societyId, amenity, actor: g.actor });
    }
  }

  await logAmenityActivity({
    societyId: g.societyId,
    entityType: "RULE",
    entityId: id,
    amenityId: id,
    amenityName: amenity.name,
    action: ACTIVITY_ACTION.RULES_UPDATED,
    actor: g.actor,
    oldValue: { count: previous.length, rules: previous.map((r) => ({ kind: r.kind, text: r.text })) },
    newValue: { count: saved.length, rules: saved.map((r) => ({ kind: r.kind, text: r.text })) },
  });

  return ok({ rules: group(saved.map((d) => d.toObject())), total: saved.length });
});
