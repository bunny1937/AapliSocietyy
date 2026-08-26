import { setting } from "@/lib/platform/settings";
// D7, narrow half — *who* may pull break-glass.
//
// Three actions in the offboarding flow step outside the process the rest of
// it exists to enforce:
//
//   1. exporting a society's data onto an operator's own machine
//   2. deleting a society immediately, with no grace window and no notice
//   3. waiving the requirement that the society ever collected its records
//
// Each is defensible in a genuine emergency and indefensible as a routine.
// Until now any superadmin could do all three, which meant the protection was
// entirely procedural: the only thing standing between a bad afternoon and an
// unrecoverable society was that nobody happened to click.
//
// This narrows it to a named list. Not a role, because a role drifts — someone
// gets made a superadmin for an unrelated reason and silently inherits the
// power to erase a society. A list has to be edited deliberately, and the
// edit is visible in deployment config rather than in a database row.
//
// ## Fails closed
//
// With SOCIETY_BREAK_GLASS_ADMINS unset, nobody can break glass. That is the
// intended default: the ordinary path — hand over, verify, delete-until —
// needs none of these three, so an empty list costs nothing until the day
// somebody needs it, and on that day setting an env var is a smaller problem
// than having had it open all along.

// Resolves database override -> SOCIETY_BREAK_GLASS_ADMINS -> empty. Editable
// from the superadmin settings page, which is why that field costs a written
// reason: adding yourself to this list is the one change here that grants
// somebody the power to erase a society.
const listFromEnv = () =>
  setting("SOCIETY_BREAK_GLASS_ADMINS").map((s) => String(s).trim().toLowerCase()).filter(Boolean);

/**
 * Matches on either the admin's user id or their email, so the list can be
 * written in whichever form the operator running the deployment can actually
 * read. Ids are unambiguous; emails are legible; requiring one or the other
 * would just mean the list is wrong.
 */
export function breakGlassAuthorized(admin) {
  const allowed = listFromEnv();
  if (!allowed.length) return false;
  const identities = [admin?.userId, admin?.id, admin?.sub, admin?.email]
    .filter(Boolean)
    .map((v) => String(v).trim().toLowerCase());
  return identities.some((i) => allowed.includes(i));
}

/**
 * The refusal, shaped so the operator knows what to do next rather than just
 * that they were stopped — including which of the two things they should
 * probably be doing instead.
 */
export function breakGlassRefusal(action) {
  return {
    error: "You are not authorised for break-glass actions",
    detail:
      `${action} steps outside the normal offboarding process, so it is restricted to a named list of ` +
      "administrators (SOCIETY_BREAK_GLASS_ADMINS). For an ordinary offboarding use the handover and " +
      "'Delete until date' instead — neither needs this. If this genuinely is an emergency, ask whoever " +
      "controls the deployment configuration to add you, so that the decision to grant it is recorded too.",
    code: "BREAK_GLASS_FORBIDDEN",
  };
}
