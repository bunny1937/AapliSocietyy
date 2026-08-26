// Shared password complexity policy (SEC-07). One rule set, used everywhere
// a password is created or reset, instead of five copies that had drifted
// out of sync (6-char onboarding vs 8-char everywhere else).
//
// Rule: 8+ chars, at least one uppercase, one lowercase, one digit, one
// symbol. Returns an error string, or null if the password is acceptable.

export const PASSWORD_MIN_LENGTH = 8;

const SYMBOL_RE = /[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/;

export function passwordPolicyProblem(pw) {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[a-z]/.test(pw)) return "Password must contain at least one lowercase letter.";
  if (!/[A-Z]/.test(pw)) return "Password must contain at least one uppercase letter.";
  if (!/[0-9]/.test(pw)) return "Password must contain at least one number.";
  if (!SYMBOL_RE.test(pw)) return "Password must contain at least one symbol (e.g. ! @ # $ %).";
  if (/^(.)\1+$/.test(pw)) return "Password cannot be a single repeated character.";
  return null;
}
