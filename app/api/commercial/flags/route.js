import Society from "@/models/Society";
import { logAudit } from "@/lib/audit-logger";
import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { CommercialError } from "@/lib/commercial/errors";
import { normalizeCommercialFlags } from "@/lib/commercial/featureFlags";

// Read + write the society's commercial switches. Deliberately NOT flag-gated,
// otherwise the module could never be switched on in the first place and the
// sidebar could never discover that it was.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLAG_KEYS = [
  "enabled",
  "directoryEnabled",
  "ownerEditingEnabled",
  "commercialBillingEnabled",
];

export const GET = adminCommercialRoute("flags.read", async ({ flags }) => ({
  flags,
}), { requireFlag: null, skipAuthorize: true });

export const POST = adminCommercialRoute(
  "flags.update",
  async ({ req, societyId, userId, flags }) => {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new CommercialError(400, "Invalid request body", "VALIDATION");
    }

    // Unknown fields are rejected rather than silently ignored, so a typo can
    // never look like a successful save.
    const unknown = Object.keys(body).filter((k) => !FLAG_KEYS.includes(k));
    if (unknown.length) {
      throw new CommercialError(
        400,
        `Unknown field(s): ${unknown.join(", ")}`,
        "VALIDATION",
      );
    }

    // Only the four boolean flags are writable. Nothing else on the society
    // document can be reached through this endpoint.
    const $set = {};
    for (const key of FLAG_KEYS) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== "boolean") {
        throw new CommercialError(400, `${key} must be true or false`, "VALIDATION");
      }
      $set[`features.commercial.${key}`] = body[key];
    }
    if (!Object.keys($set).length) return { flags, changed: false };

    const updated = await Society.findByIdAndUpdate(societyId, { $set }, { new: true })
      .select("features")
      .lean();

    const next = normalizeCommercialFlags(updated?.features);
    const changed = FLAG_KEYS.some((k) => flags[k] !== next[k]);
    if (changed) {
      await logAudit(
        userId,
        societyId,
        next.enabled ? "COMMERCIAL_FEATURE_ENABLED" : "COMMERCIAL_FEATURE_DISABLED",
        flags,
        next,
      );
    }
    return { flags: next, changed };
  },
  { requireFlag: null },
);
