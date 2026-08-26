import mongoose from "mongoose";

/**
 * One row per overridden platform setting.
 *
 * ## Why rows and not one document
 *
 * A single settings document means every write is a read-modify-write of the
 * whole thing, and two superadmins saving different sections a second apart
 * silently lose one of the changes. One row per key makes each save
 * independent, and makes "who last changed the grace ceiling, and what was it
 * before" a question with an answer.
 *
 * ## Why only overrides are stored
 *
 * A key with no row here is not "unset" — it falls through to the environment
 * variable, and then to the code default. So the collection starts empty and
 * stays small, the defaults live next to the code that explains them, and
 * "reset to default" is a delete rather than a value somebody has to remember.
 */
const PlatformSettingSchema = new mongoose.Schema(
  {
    // Matches a key in lib/platform/settings.js. A row whose key is not in
    // that registry is ignored on read — removing a setting from the code
    // must not leave a stale value quietly in force.
    key: { type: String, required: true, unique: true, index: true },

    // Stored as given (number, string, boolean). The registry coerces and
    // validates on the way in, so anything here has already been checked.
    value: { type: mongoose.Schema.Types.Mixed, required: true },

    // Kept so a change can be read as a change, not just a current state.
    // "Grace ceiling is 90" is a fact; "someone dropped it from 180 to 90 on
    // Tuesday" is what you actually need when a purge window looks wrong.
    previousValue: { type: mongoose.Schema.Types.Mixed },

    updatedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedByEmail: { type: String },
    // Required for the settings the registry marks `reasonRequired` — the ones
    // that widen a limit or disable a safety.
    reason: { type: String },
  },
  { timestamps: true },
);

export default mongoose.models.PlatformSetting ||
  mongoose.model("PlatformSetting", PlatformSettingSchema);
