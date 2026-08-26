import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken } from "@/lib/jwt";
import PageClient from "./PageClient";

export const dynamic = "force-dynamic";

const ACCESS_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "token";
const ALLOWED = ["Admin", "Secretary"];

// Deliberately NOT requirePagePermission().
//
// This is the page a society is sent to when its data is being handed back —
// typically while the society is paused and inside its erasure grace window.
// Gating it on a granular RBAC permission would mean a society could lose the
// ability to collect its own records because of a permission-set change, at
// the one moment that access matters most and is least recoverable. So the
// gate here is only "a valid, unexpired session belonging to this society's
// Admin or Secretary" — the same people the handover email was addressed to.
//
// Every route the page calls (/api/v1/society-handover/*) re-checks the same
// thing server-side and scopes its queries to the societyId on the token, so
// this guard is a redirect convenience, not the security boundary.
export default async function Page() {
  const store = await cookies();
  const token = store.get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/auth/login");
  let decoded = null;
  try {
    decoded = verifyToken(token);
  } catch {
    redirect("/auth/login");
  }
  if (!decoded || !ALLOWED.includes(decoded.role)) redirect("/auth/login");
  return <PageClient />;
}
