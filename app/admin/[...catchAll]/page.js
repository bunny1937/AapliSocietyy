import Link from "next/link";
import { ADMIN_NAVIGATION } from "@/components/adminNavigation";

// Used to silently redirect() any unknown /admin/* to the dashboard. That
// hid every broken link — a typo'd href just landed you on the dashboard
// with no error, no console line, nothing to grep for. See
// AapliSociety Accounting + Billing UX Overhaul, §7 Fix 3.
//
// Now: a real "page not found" screen naming the path that was tried and
// pointing at the nearest real pages, so a broken link is loud instead of
// invisible.

function allAdminPaths() {
  const paths = [];
  for (const group of ADMIN_NAVIGATION) {
    for (const item of group.items || []) {
      if (item.path) paths.push({ name: item.name, path: item.path, group: group.title });
    }
  }
  return paths;
}

// Cheap similarity: shared path segments + substring overlap. Good enough to
// surface "you probably meant /admin/accounting/chart-of-accounts" for a
// mistyped /admin/accounting/chart-of-account without pulling in a library.
function scoreMatch(triedPath, candidatePath) {
  const a = triedPath.toLowerCase().split("/").filter(Boolean);
  const b = candidatePath.toLowerCase().split("/").filter(Boolean);
  let shared = 0;
  for (const seg of a) {
    if (b.includes(seg)) shared += 2;
    else if (b.some((s) => s.includes(seg) || seg.includes(s))) shared += 1;
  }
  return shared;
}

export default async function AdminCatchAll({ params }) {
  const { catchAll } = await params;
  const triedPath = "/admin/" + (catchAll || []).join("/");

  const suggestions = allAdminPaths()
    .map((p) => ({ ...p, score: scoreMatch(triedPath, p.path) }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  return (
    <div style={{ maxWidth: 640, margin: "64px auto", padding: "0 20px" }}>
      <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.3, color: "#b91c1c", marginBottom: 8 }}>
        404 — PAGE NOT FOUND
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
        <code style={{ background: "#f3f4f6", padding: "2px 6px", borderRadius: 4 }}>{triedPath}</code> doesn&apos;t exist
      </h1>
      <p style={{ color: "#6b7280", fontSize: 14, marginBottom: 24 }}>
        Nothing in the admin area is at this address. If you followed a link to get here, that link is broken — worth
        reporting.
      </p>

      {suggestions.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 8 }}>Did you mean:</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {suggestions.map((s) => (
              <Link
                key={s.path}
                href={s.path}
                style={{
                  fontSize: 14,
                  padding: "8px 12px",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  color: "#111827",
                  textDecoration: "none",
                }}
              >
                {s.name} <span style={{ color: "#9ca3af" }}>· {s.path}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <Link href="/admin/dashboard" style={{ fontSize: 14, color: "#2563eb", textDecoration: "underline" }}>
        Go to Dashboard →
      </Link>
    </div>
  );
}
