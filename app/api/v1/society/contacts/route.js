// GET /v1/society/contacts
//
// THIS ROUTE DID NOT EXIST.
//
// essential_contacts_page.dart line 55 calls `GET /society/contacts`, wraps it
// in a bare try/catch, and on failure silently keeps only the hardcoded
// national helplines:
//
//     } catch (_) {
//       // Endpoint not deployed / offline / not permitted. Stay quiet.
//     }
//
// So the Society group (`if (_society.isNotEmpty)`, line 108) never rendered a
// single time. There was no bug in the screen. The numbers it was asking for
// were never served by anything.
//
// Returns the people a resident actually needs from their OWN society:
// secretary, chairman, treasurer, admin, the society office and the builder.
// Everything is best-effort - a society that has filled in nothing returns an
// empty list and the app falls back to the built-in directory exactly as now.
//
// 2026-09-06: the "Society group" numbers below (the free-form watchman/
// plumber/gas-agency entries) used to read society.emergencyContacts /
// society.staffContacts — fields that were never in the Society schema, so
// that half of the list was permanently empty too. They now read
// society.contacts, the field /admin/society-contacts actually writes.

import { withRoute, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { Society, User, Member } from "@/lib/v1/models";
import cache from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Committee roles that live on the User document.
const COMMITTEE_ROLES = ["Secretary", "Chairman", "Treasurer", "Accountant", "Admin"];

function clean(v) {
  const s = `${v ?? ""}`.trim();
  return s && s !== "null" && s !== "undefined" ? s : "";
}

// A phone number is the entire point of this screen. Anything without one is
// noise, so it is dropped rather than shown as an un-callable row.
function entry(name, phone, role) {
  const n = clean(name);
  const p = clean(phone);
  if (!p) return null;
  return { name: n || clean(role) || "Contact", phone: p, role: clean(role) };
}

// The same person can appear as both a committee User and a Member row.
// Dedupe on the last 10 digits so the secretary is not listed twice.
function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const c of list) {
    if (!c) continue;
    const key = c.phone.replace(/[^0-9]/g, "").slice(-10);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// This runs 2-3 queries plus a dedupe pass for data that barely ever
// changes (committee roster, society office number) and is identical for
// every resident of the society — a strong SWR candidate. Soft 60s / hard
// 300s: nothing in the mobile app writes these fields today (they're edited
// from the web admin side), so there's no invalidation hook here — an admin
// edit can take up to 5 minutes to show up in the app. Acceptable for a
// phone book; revisit if that side ever needs to feel instant too.
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  return json({ contacts: await cache.getOrSetSWR(
    `v1:society-contacts:${societyId}`,
    () => fetchContacts(societyId),
    { softTtlSeconds: 60, hardTtlSeconds: 300 },
  ) });
});

async function fetchContacts(societyId) {
  const [society, committee] = await Promise.all([
    Society.findById(societyId).lean(),
    // Committee members of THIS society only. A tenant must never be handed
    // the phone book of a society they do not live in.
    User.find({ societyId, role: { $in: COMMITTEE_ROLES }, isActive: { $ne: false } })
      .select("name username role phone email memberId")
      .limit(25)
      .lean(),
  ]);

  const contacts = [];

  // ---- The society office itself -----------------------------------------
  // personOfContact / contactPhone are exactly the fields the bulk-import
  // wizard writes from the Society sheet, so an imported society has these
  // populated on day one.
  if (society) {
    contacts.push(
      entry(society.personOfContact || "Society office", society.contactPhone, "Society office"),
    );
    contacts.push(
      entry(
        society.builderName || society.developerName || "Builder",
        society.builderPhone || society.developerPhone,
        "Builder",
      ),
    );
    // Admin-managed directory — /admin/society-contacts, see
    // app/api/admin/society-contacts/route.js. One row can carry up to 3
    // numbers (own + WhatsApp/alternate); the phone book shows the first
    // that survives entry()'s validity check as the row, so numbers beyond
    // the first are folded in as a second/third entry under the same name.
    const directory = Array.isArray(society.contacts) ? society.contacts : [];
    for (const c of directory.slice(0, 25)) {
      for (const num of (c?.numbers || []).slice(0, 3)) {
        contacts.push(entry(c?.name || c?.category, num, c?.category));
      }
    }
  }

  // ---- Committee ----------------------------------------------------------
  // A committee User often has no phone of its own - the number lives on the
  // linked Member row, which is where bulk import puts it. Resolve those in one
  // batched query rather than one lookup per person.
  const needMember = committee.filter((u) => !clean(u.phone) && u.memberId);
  let memberPhones = new Map();
  if (needMember.length) {
    const rows = await Member.find({
      _id: { $in: needMember.map((u) => u.memberId) },
      societyId,
    })
      .select("contactNumber alternateContact whatsappNumber ownerName")
      .lean();
    memberPhones = new Map(
      rows.map((m) => [
        String(m._id),
        { phone: m.contactNumber || m.whatsappNumber || m.alternateContact, name: m.ownerName },
      ]),
    );
  }

  for (const u of committee) {
    const fallback = u.memberId ? memberPhones.get(String(u.memberId)) : null;
    contacts.push(entry(u.name || fallback?.name || u.username, u.phone || fallback?.phone, u.role));
  }

  return dedupe(contacts);
}
