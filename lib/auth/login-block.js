// lib/auth/login-block.js
//
// The one place that answers "may this account sign in right now?".
//
// Two separate states, deliberately distinct:
//   isActive: false   - switched off indefinitely (left the society, account
//                       closed, admin disabled the login).
//   loginPausedUntil  - a temporary hold with its own end date, so nobody has
//                       to remember to switch the account back on.
//
// Every login, refresh, session-read and profile-switch path calls this, so an
// account cannot be disabled on one door and still walk in through another.
// The message is written for the person reading it, never a bare code.

/**
 * @param user a User document (or lean object)
 * @returns {null | { code: string, message: string, until?: Date }}
 *          null = allowed to sign in.
 */
export function loginBlockFor(user) {
  if (!user) return { code: "NO_ACCOUNT", message: "This account no longer exists." };

  if (user.isActive === false) {
    return {
      code: "ACCOUNT_DISABLED",
      message:
        user.loginBlockedReason ||
        "This login has been switched off by your society's admin. Please contact the society office.",
    };
  }

  const until = user.loginPausedUntil ? new Date(user.loginPausedUntil) : null;
  if (until && until.getTime() > Date.now()) {
    const when = until.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return {
      code: "LOGIN_PAUSED",
      until,
      message:
        (user.loginBlockedReason ? `${user.loginBlockedReason} ` : "") +
        `This login is paused until ${when}. Please contact the society office if you need it sooner.`,
    };
  }

  return null;
}

/** True when a stored pause has already elapsed and should be cleared. */
export function pauseHasExpired(user) {
  const until = user?.loginPausedUntil ? new Date(user.loginPausedUntil) : null;
  return !!until && until.getTime() <= Date.now();
}
