import { getExportRows } from "@/lib/amenities/analyticsService";
import { getTimezone } from "@/lib/amenities/settingsService";
import { gate, fail, isId, dateRange, withAmenityRoute, CAPABILITY } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(value) {
  if (value == null) return "";
  const s = String(value);
  // Quote anything that could break the row, and guard against spreadsheet
  // formula injection from user-entered amenity names.
  const needsQuote = /[",\n\r]/.test(s);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return needsQuote ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// GET /api/amenities/analytics/export?from=&to=&amenityId=&granularity=
//
// Emits CSV, which both Excel and Google Sheets open natively. PDF export is
// produced client-side from the rendered dashboard using the printing/pdf
// libraries already in this project, so the server does not need a headless
// browser and the exported document matches what the admin sees on screen.
export const GET = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.EXPORT_ANALYTICS);
  if (!g.ok) return g.response;

  const sp = new URL(request.url).searchParams;
  const range = dateRange(sp, { defaultDays: 30 });
  if (!range) return fail(422, "Invalid date range");

  const timezone = await getTimezone(g.societyId);
  const { headers, rows } = await getExportRows({
    societyId: g.societyId,
    from: range.from,
    to: range.to,
    amenityId: isId(sp.get("amenityId")) ? sp.get("amenityId") : null,
    granularity: sp.get("granularity") || "daily",
    timezone,
  });

  const csv = [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(`\uFEFF${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="amenity-usage-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
