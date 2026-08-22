import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { CommercialError } from "@/lib/commercial/errors";
import { generateBillsForMembers } from "@/lib/billing/generationService";
import Shop from "@/models/Shop";
import Bill from "@/models/Bill";

// FIXED: this used to resolve targets from legacy `Member` records carrying
// flatType Shop/Office, while /api/commercial/preview-bills resolves them from
// the `Shop` collection. The admin therefore previewed one set of units and
// generated a different one — on a society that has migrated to Shop records
// the preview showed every shop and generation found nothing at all.
// Both sides now read the same collection with the same billable test the
// shop list uses (see app/api/commercial/shops/route.js `billable=1`).
export async function resolveCommercialTargetMemberIds(societyId, memberIds) {
  if (Array.isArray(memberIds) && memberIds.length) return memberIds;
  const rows = await Shop.find({
    societyId,
    isDeleted: { $ne: true },
    isActive: { $ne: false },
    isBillable: { $ne: false },
    areaSqft: { $gt: 0 },
  })
    .select("_id")
    .lean();
  return rows.map((r) => r._id);
}

export const POST = adminCommercialRoute(
  "commercial.generateBills",
  async ({ societyId, userId, req }) => {
    const { billMonth, billYear, memberIds } = await req.json();
    if (billMonth === undefined || !billYear) {
      throw new CommercialError(400, "billMonth and billYear are required", "VALIDATION_ERROR");
    }
    const month = billMonth + 1; // client sends 0-indexed, matches /api/bills/generate-final convention
    const billPeriodId = `${billYear}-${String(month).padStart(2, "0")}`;

    // Scoped to commercial units only — a residential regeneration in the same
    // period must never be blocked by, or block, a commercial one.
    const existing = await Bill.findOne({
      societyId, billPeriodId, billSeries: "COMMERCIAL", isDeleted: { $ne: true },
    });
    if (existing) {
      throw new CommercialError(409, `Commercial bills for ${billPeriodId} already exist`, "P4_DUPLICATE");
    }

    const targetIds = await resolveCommercialTargetMemberIds(societyId, memberIds);
    if (!targetIds.length) {
      throw new CommercialError(400, "No Shop/Office units found to generate for", "NO_TARGET_UNITS");
    }

    const results = await generateBillsForMembers({
      societyId, memberIds: targetIds, year: billYear, month, performedBy: userId, billClass: "COMMERCIAL",
    });
    return { generated: results.generated.length, failed: results.failed, billPeriodId };
  },
  { requireFlag: "commercialBillingEnabled" },
);
