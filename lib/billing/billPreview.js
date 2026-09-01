/**
 * Read-only preview of a bill run — the `?dryRun=1` half of the same
 * Plan -> Stream -> Receipt pattern accounting's Setup wizard uses (design
 * doc §6), applied to billing per the design doc's own Phase 6 scope.
 *
 * Deliberately NOT built by importing generationService's loadGenerationContext
 * or persistBill: loadGenerationContext has one write buried in it (a cleanup
 * delete of soft-deleted duplicate-key rows, generationService.js:168), and
 * persistBill writes the Bill itself. Reusing either here would make a
 * "preview" quietly touch the database. This file only ever reads, then
 * calls the two PURE functions generationService already exports for exactly
 * this reason — computeBill() and resolveOpeningBalances() — so the ₹
 * figures shown are computed by the identical math the real run uses, with
 * zero risk to generationService.js itself (nothing in it changed).
 */
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Shop from "@/models/Shop";
import Society from "@/models/Society";
import BillingHead from "@/models/BillingHead";
import { listActiveCommercialHeads } from "@/lib/commercial/commercialBillingHeadService";
import { getSettings } from "@/lib/commercial/commercialSettingsService";
import { computeBill, resolveOpeningBalances } from "@/lib/billing/generationService";

/**
 * @returns {Promise<{billPeriodId, willGenerate: Array, willSkip: Array, totalCurrentCharges: number}>}
 */
export async function previewBillsForMembers({ societyId, memberIds, year, month, billSeries = "RESIDENTIAL" }) {
  const billPeriodId = `${year}-${String(month).padStart(2, "0")}`;

  const [society, heads, commercialSettings] = await Promise.all([
    Society.findById(societyId).lean(),
    billSeries === "COMMERCIAL"
      ? listActiveCommercialHeads(societyId)
      : BillingHead.find({ societyId, isActive: true, isDeleted: false }).sort({ order: 1 }).lean(),
    billSeries === "COMMERCIAL" ? getSettings({ societyId }) : null,
  ]);

  const willGenerate = [];
  const willSkip = [];

  for (const memberId of memberIds) {
    try {
      const existing = await Bill.findOne({
        societyId, memberId, billPeriodId, billSeries, isDeleted: { $ne: true },
      }).select("_id").lean();

      const unit =
        billSeries === "COMMERCIAL"
          ? await Shop.findById(memberId)
              .select("shopNo wing ownerName unitKind areaSqft occupancyType electricityMode lastMeterReading openingPrincipal openingInterest isDeleted isActive isBillable")
              .lean()
          : await Member.findById(memberId)
              .select("flatNo wing ownerName carpetAreaSqft flatType openingPrincipal openingInterest openingBalance advanceCredit parkingSlots")
              .lean();

      if (!unit || (billSeries === "COMMERCIAL" && unit.isDeleted)) {
        willSkip.push({ memberId, label: memberId, reason: billSeries === "COMMERCIAL" ? "Shop not found" : "Member not found" });
        continue;
      }
      const label = billSeries === "COMMERCIAL" ? `${unit.shopNo || ""} ${unit.ownerName || ""}`.trim() : `${unit.flatNo || ""} ${unit.ownerName || ""}`.trim();

      if (existing) {
        willSkip.push({ memberId, label, reason: "Already generated for this period" });
        continue;
      }

      const { openingPrincipal, openingInterest } = await resolveOpeningBalances({
        memberId, societyId, year, month, member: unit, billClass: billSeries,
      });

      const nonOccupancyCharged =
        billSeries === "COMMERCIAL" &&
        commercialSettings?.nonOccupancy?.enabled === true &&
        ["Commercial", "Both"].includes(commercialSettings?.nonOccupancy?.appliesTo) &&
        unit.occupancyType === "Rented out";
      const meterUnits = billSeries === "COMMERCIAL" ? Number(unit.lastMeterReading) || 0 : 0;

      const computed = computeBill({
        member: unit, heads, society, year, month, openingPrincipal, openingInterest,
        billClass: billSeries, nonOccupancyCharged, commercialSettings, meterUnits,
      });

      willGenerate.push({
        memberId, label,
        currentCharges: computed.currentCharges,
        currentInterest: computed.currentInterest,
        totalBillDue: computed.totalBillDue,
        skippedHeads: computed.skipped,
      });
    } catch (e) {
      // One member's data problem never blanks the whole preview — the real
      // run reports per-member failures the same way (see generate-final's
      // NDJSON `error` events), so the preview mirrors that shape.
      willSkip.push({ memberId, label: memberId, reason: e.message });
    }
  }

  return {
    billPeriodId,
    willGenerate,
    willSkip,
    totalCurrentCharges: willGenerate.reduce((sum, b) => sum + b.currentCharges, 0),
    totalBillDue: willGenerate.reduce((sum, b) => sum + b.totalBillDue, 0),
  };
}
