import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import { verifyToken } from "@/lib/jwt";
import { societyLifecycle, STATE } from "@/lib/entitlements/lifecycle";
import PageClient from "./PageClient";

export const dynamic = "force-dynamic";

const ACCESS_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "token";

// The one page a blocked society can reach.
//
// Every other route redirects here, which is deliberate: a banner on forty
// pages is thirty-nine reminders too many for a committee that needs one
// decision. And unlike an unbought module there is nothing to conceal — they
// know they have not paid — so the honest thing is a screen that says so and
// offers the only two things they can still do.
//
// Deliberately not behind requirePagePermission. The people who need this page
// are locked out of everything else; gating it on a granular permission would
// mean a society could lose the ability to see why it is locked out, and to
// leave, because of an unrelated permission change.
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
  const societyId = decoded?.activeContext?.societyId || decoded?.societyId;
  if (!societyId) redirect("/auth/login");

  await connectDB();
  const society = await Society.findById(societyId)
    .select("name subscription")
    .lean();
  if (!society) redirect("/auth/login");

  const lifecycle = societyLifecycle(society);

  // A society that renewed while sitting on this page should not be stranded
  // on it. Anything other than blocked belongs back in the app.
  if (lifecycle.state !== STATE.BLOCKED) redirect("/admin/dashboard");

  return (
    <PageClient
      societyName={society.name}
      expiredAt={lifecycle.expiredAt ? lifecycle.expiredAt.toISOString() : null}
      daysBlocked={lifecycle.daysInState}
    />
  );
}
