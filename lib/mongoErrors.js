// Shared MongoDB/Mongoose error-shape detection.
//
// `err.code === 11000` is the check every duplicate-key catch in this codebase
// used to write inline, and it misses real production races: the driver/
// Mongoose can surface a duplicate-key failure with the code nested under
// `.cause`, inside `.writeErrors[]`, or only recoverable from `.message` at
// all, depending on version and whether the write went through a bulk path.
// One raced /v1/amenities/my-cards request hit exactly this gap - the code
// existed to catch the race and re-fetch the winner, but the check didn't
// match the error's actual shape, so it fell through to an unhandled 500
// instead of self-healing. Every duplicate-key catch in the codebase should
// go through this instead of re-writing the same fragile inline check.
export function isDuplicateKeyError(err) {
  if (!err) return false;
  if (err.code === 11000 || err.code === "11000") return true;
  if (err.cause && isDuplicateKeyError(err.cause)) return true;
  if (Array.isArray(err.writeErrors) && err.writeErrors.some((w) => isDuplicateKeyError(w))) return true;
  if (typeof err.message === "string" && err.message.includes("E11000")) return true;
  return false;
}
