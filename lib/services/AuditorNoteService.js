import AuditorNote from "@/models/AuditorNote";
import User from "@/models/User";

export class AuditorNoteServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "AuditorNoteServiceError";
    this.status = status;
  }
}

export async function raiseNote(societyId, { targetType, targetId, targetLabel, note }, userId) {
  if (!AuditorNote.TARGET_TYPES.includes(targetType)) {
    throw new AuditorNoteServiceError(400, `targetType must be one of: ${AuditorNote.TARGET_TYPES.join(", ")}`);
  }
  if (!targetId) throw new AuditorNoteServiceError(400, "targetId is required");
  if (!note || !note.trim()) throw new AuditorNoteServiceError(400, "A note is required");

  return AuditorNote.create({
    societyId, targetType, targetId, targetLabel, note: note.trim(), raisedBy: userId,
  });
}

export async function listNotes(societyId, { status } = {}) {
  const query = { societyId };
  if (status) query.status = status;
  const notes = await AuditorNote.find(query).sort({ status: 1, raisedAt: -1 }).lean();
  const userIds = [...new Set(notes.flatMap((n) => [n.raisedBy, n.resolvedBy]).filter(Boolean).map(String))];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select("name").lean()
    : [];
  const nameById = new Map(users.map((u) => [String(u._id), u.name]));
  return notes.map((n) => ({
    ...n,
    raisedByName: nameById.get(String(n.raisedBy)) || null,
    resolvedByName: n.resolvedBy ? nameById.get(String(n.resolvedBy)) || null : null,
  }));
}

export async function resolveNote(societyId, id, { resolution }, userId) {
  if (!resolution || !resolution.trim()) {
    throw new AuditorNoteServiceError(400, "A resolution is required to close a query");
  }
  const note = await AuditorNote.findOne({ _id: id, societyId });
  if (!note) throw new AuditorNoteServiceError(404, "Query not found");
  if (note.status === "Resolved") throw new AuditorNoteServiceError(409, "Already resolved");
  note.status = "Resolved";
  note.resolution = resolution.trim();
  note.resolvedBy = userId;
  note.resolvedAt = new Date();
  await note.save();
  return note;
}

export async function countOpenNotes(societyId) {
  return AuditorNote.countDocuments({ societyId, status: "Open" });
}
