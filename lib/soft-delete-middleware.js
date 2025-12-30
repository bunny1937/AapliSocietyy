import Archive from '@/models/Archive';

/**
 * Export data to Archive before deletion
 * @param {Object} params
 * @param {string} params.collection - Collection name (bills/members/transactions)
 * @param {Array} params.documents - Array of documents to archive
 * @param {string} params.userId - User performing deletion
 * @param {string} params.reason - Reason for deletion
 * @returns {Promise<number>} Number of archived documents
 */
export async function exportBeforeDelete({ collection, documents, userId, reason }) {
  if (!documents || documents.length === 0) {
    throw new Error('No documents provided for archival');
  }

  const archiveEntries = documents.map(doc => ({
    originalCollection: collection,
    originalId: doc._id,
    societyId: doc.societyId,
    data: doc,
    deletedAt: new Date(),
    deletedBy: userId,
    deletionReason: reason || 'No reason provided',
    willExpireAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90 days
  }));

  await Archive.insertMany(archiveEntries);
  
  return archiveEntries.length;
}

/**
 * Restore archived data
 * @param {string} archiveId - Archive document ID
 * @param {string} userId - User performing restoration
 * @returns {Promise<Object>} Restored document
 */
export async function restoreFromArchive(archiveId, userId) {
  const archived = await Archive.findById(archiveId);
  
  if (!archived) {
    throw new Error('Archive not found');
  }

  if (archived.isRestored) {
    throw new Error('Already restored');
  }

  // Get the model
  const modelMap = {
    bills: 'Bill',
    members: 'Member',
    transactions: 'Transaction',
    billingheads: 'BillingHead'
  };

  const Model = require(`@/models/${modelMap[archived.originalCollection]}`).default;

  // Restore the document
  const restored = await Model.create({
    ...archived.data,
    _id: archived.originalId,
    isDeleted: false,
    deletedAt: null,
    deletedBy: null
  });

  // Mark archive as restored
  archived.isRestored = true;
  archived.restoredAt = new Date();
  archived.restoredBy = userId;
  await archived.save();

  return restored;
}

/**
 * Get archived data for a society
 * @param {string} societyId
 * @param {string} collection - Optional: filter by collection
 * @returns {Promise<Array>} Archived documents
 */
export async function getArchivedData(societyId, collection = null) {
  const query = { societyId, isRestored: false };
  
  if (collection) {
    query.originalCollection = collection;
  }

  return await Archive.find(query)
    .sort({ deletedAt: -1 })
    .lean();
}
