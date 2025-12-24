import AuditLog from "@/models/AuditLog";

export async function logAudit(userId, societyId, action, oldData, newData) {
  try {
    await AuditLog.create({
      userId,
      societyId,
      action,
      oldData,
      newData,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Audit log error:", error);
  }
}

export async function getAuditLogs(societyId, filters = {}) {
  const query = { societyId };

  if (filters.action) {
    query.action = filters.action;
  }

  if (filters.userId) {
    query.userId = filters.userId;
  }

  if (filters.startDate && filters.endDate) {
    query.timestamp = {
      $gte: new Date(filters.startDate),
      $lte: new Date(filters.endDate),
    };
  }

  const logs = await AuditLog.find(query)
    .populate("userId", "name email")
    .sort({ timestamp: -1 })
    .limit(filters.limit || 100)
    .lean();

  return logs;
}

export async function getAuditTrailForEntity(entityType, entityId, societyId) {
  const logs = await AuditLog.find({
    societyId,
    $or: [{ "oldData._id": entityId }, { "newData._id": entityId }],
  })
    .populate("userId", "name email")
    .sort({ timestamp: -1 })
    .lean();

  return logs;
}
