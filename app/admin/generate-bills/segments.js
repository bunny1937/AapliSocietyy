// app/admin/generate-bills/segments.js
//
// Segment configuration for the bill-generation wizard. Both Residential and
// Commercial render the SAME <BillGenerationFlow /> — the only difference is
// which config object it receives.
//
// CHANGED 2026-08-07 — the commercial segment no longer reads Members.
//
// It used to be:
//     membersUrl:  "/api/members/list"
//     memberFilter: (m) => ["Shop", "Office"].includes(m.flatType)
//
// which is the root of the whole A-103 mess: a flat had to be RE-LABELLED as a
// Shop to appear here, which destroyed its residential identity, and then it
// was billed twice — once in each series — off the same carpet area and the
// same opening balance.
//
// Commercial now reads the Shop collection, which is a separate record with its
// own area and its own ledger. A flat is never touched, never re-labelled, and
// never appears in both runs.
export const SEGMENTS = {
  residential: {
    key: "residential",
    billSeries: "RESIDENTIAL",
    label: "Residential",
    unitNoun: "flat",
    unitNounPlural: "flats",
    supportsExcelUpload: true,
    // Was "client" — computeCurrentCharges() reimplemented in the browser, a
    // second copy of the billing math kept in sync with
    // lib/billing/generationService.js by hand. Commercial was already fixed
    // to run the real engine as a dry run instead (see its own comment:
    // "the numbers on screen can never diverge from what generation
    // writes"); /api/bills/preview-residential gives residential the same
    // guarantee, on the same contract.
    previewMode: "server",
    previewUrl: "/api/bills/preview-residential",
    membersUrl: "/api/members/list",
    membersQueryKey: ["members-list"],
    headsUrl: "/api/billing-heads/list",
    headsQueryKey: ["billing-heads"],
    memberFilter: (m) => !m.isDeleted,
    // Where the admin goes when there is nothing to bill.
    setupHref: "/admin/members",
    setupLabel: "Add flats",
    emptyMessage:
      "No flats found. Add flats before generating residential bills.",
  },
  commercial: {
    key: "commercial",
    billSeries: "COMMERCIAL",
    label: "Commercial",
    unitNoun: "shop",
    unitNounPlural: "shops and offices",
    supportsExcelUpload: false,
    previewMode: "server", // calls previewUrl instead of client-side math
    previewUrl: "/api/commercial/preview-bills",
    // Shops, not members. Rows already arrive filtered to billable ones.
    membersUrl: "/api/commercial/shops?billable=1",
    membersQueryKey: ["commercial-shops", "billable"],
    membersResponseKey: "shops",
    headsUrl: "/api/commercial/billing-heads",
    headsQueryKey: ["commercial-billing-heads"],
    // The API already excludes deleted / non-billable shops. This is only a
    // client-side safety net, and it deliberately does NOT look at flatType.
    memberFilter: (s) => !s.isDeleted && s.isBillable !== false,
    setupHref: "/admin/commercial/shops",
    setupLabel: "Add shops",
    emptyMessage:
      "No shops or offices are set up yet. Add them on the Shops screen — this does not change any flat.",
  },
};

/** Small helper so callers stop hardcoding the string in three places. */
export function segmentFor(key) {
  return SEGMENTS[key] || SEGMENTS.residential;
}
