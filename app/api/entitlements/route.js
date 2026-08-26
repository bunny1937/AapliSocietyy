import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAuth } from "@/lib/authz";
import { loadEntitlements } from "@/lib/entitlements/resolve";
import { MODULES } from "@/lib/entitlements/modules";
import { lifecycleMessage } from "@/lib/entitlements/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/entitlements
//
// What this society has, for the UI to render with. Read by the sidebar, the
// generate-bills page and anything else that needs to show or hide a feature.
//
// ## This is a hint, not a control
//
// Nothing here is trusted for enforcement. A client that lies about its
// entitlements gets a correctly-rendered sidebar full of links that all 404 —
// because the gate is in middleware, reading a server-side snapshot, and has
// never heard of this response.
//
// It exists so the sidebar is right on first paint instead of flashing a menu
// that then disappears, which looks like a bug and invites exactly the "what
// was that?" curiosity the 404s are meant to avoid.
//
// Never gated itself, obviously: a society has to be able to ask what it has.
export async function GET(request) {
  try {
    await connectDB();
    const auth = requireAuth(request);
    if (!auth.valid) return auth;

    const societyId = auth.user?.activeContext?.societyId || auth.user?.societyId;
    if (!societyId) {
      return NextResponse.json({ modules: {}, lifecycle: null, catalogue: [] });
    }

    const { modules, lifecycle, societyName } = await loadEntitlements(societyId);

    return NextResponse.json(
      {
        modules,
        lifecycle: lifecycle
          ? {
              state: lifecycle.state,
              canRead: lifecycle.canRead,
              canWrite: lifecycle.canWrite,
              trialEndsAt: lifecycle.trialEndsAt,
              expiredAt: lifecycle.expiredAt,
              blockedAt: lifecycle.blockedAt,
              daysInState: lifecycle.daysInState,
              message: lifecycleMessage(lifecycle, societyName || "This society"),
            }
          : null,
        // Labels only — never the prefixes. The catalogue tells the UI what to
        // call a module it already knows it has; it is not a map of the
        // platform's route surface for anyone who asks.
        catalogue: MODULES.filter((m) => modules[m.key]).map((m) => ({
          key: m.key,
          label: m.label,
        })),
      },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  } catch (err) {
    console.error("entitlements read error:", err);
    // Fail open in shape, not in fact: an empty set renders a minimal sidebar
    // rather than a broken page, and the real gate is elsewhere regardless.
    return NextResponse.json({ modules: {}, lifecycle: null, catalogue: [] }, { status: 200 });
  }
}
